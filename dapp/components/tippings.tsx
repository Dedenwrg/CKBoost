"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TippingCard } from "./tipping-card";
import { TippingFundingPanel } from "./tipping-funding-panel";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  TippingInfo,
  useTippingContext,
  useTippingsData,
} from "../lib/providers/tipping-provider";
import { useProtocol } from "@/lib/providers/protocol-provider";
import { useToast } from "@/components/ui/use-toast";
import { ccc } from "@ckb-ccc/connector-react";
import { InsufficientTippingFundingError } from "@/lib/services/tipping-service";
import { createScopedLogger } from "ssri-ckboost";
import { useSocialInteractions } from "@/hooks/use-social-interactions";
import { nip19 } from "nostr-tools";

const log = createScopedLogger("Tippings");

const parseBigInt = (value: ccc.NumLike | undefined | null): bigint => {
  if (value === undefined || value === null) return 0n;
  try {
    return BigInt(ccc.numFrom(value));
  } catch {
    return 0n;
  }
};

export function Tippings() {
  const { tippings: contextTippings, isLoading, error } = useTippingsData();
  const { updateTipping } = useTippingContext();
  const { isAdmin, isEndorser, protocolData, endorserResolver } = useProtocol();
  const signer = ccc.useSigner();
  const { toast } = useToast();
  const searchParams = useSearchParams();

  const [tippings, setTippings] = useState<TippingInfo[]>(contextTippings);
  const [searchTerm, setSearchTerm] = useState("");
  const [viewerLockHash, setViewerLockHash] = useState<string | null>(null);
  const tippingRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Extract type IDs for social stats
  const tippingSocialInputs = useMemo(() => {
    const decodeEventId = (value?: string | null): string | null => {
      if (!value) return null;
      if (value.startsWith("nevent1")) {
        try {
          const decoded = nip19.decode(value);
          if (decoded.type === "nevent") {
            return (decoded.data as { id: string }).id;
          }
        } catch {
          return null;
        }
      }
      return value;
    };

    return tippings
      .map((t) => {
        const id = t.typeId;
        const targetEventId = decodeEventId(
          (t.metadata as { long_description?: string })?.long_description ??
            t.data.metadata.long_description
        );
        if (!id || !targetEventId) return null;
        return { id, targetEventId };
      })
      .filter((x): x is { id: string; targetEventId: string } => !!x);
  }, [tippings]);

  const { stats: socialStats } = useSocialInteractions(tippingSocialInputs);

  useEffect(() => {
    setTippings(contextTippings);
  }, [contextTippings]);

  useEffect(() => {
    let cancelled = false;

    const loadLockHash = async () => {
      if (!signer) {
        if (!cancelled) {
          setViewerLockHash(null);
        }
        return;
      }

      try {
        const recommended = await signer.getRecommendedAddressObj();
        const hash = recommended.script.hash().toLowerCase();
        if (!cancelled) {
          setViewerLockHash(hash);
        }
      } catch (err) {
        log.error("Failed to derive viewer lock hash", err);
        if (!cancelled) {
          setViewerLockHash(null);
        }
      }
    };

    loadLockHash();
    return () => {
      cancelled = true;
    };
  }, [signer]);

  const approvalThresholds = useMemo(() => {
    if (!protocolData?.tipping_config?.approval_requirement_thresholds) {
      return [];
    }

    try {
      return protocolData.tipping_config.approval_requirement_thresholds.map(
        (threshold) => BigInt(ccc.numFrom(threshold))
      );
    } catch {
      return [];
    }
  }, [protocolData]);

  const getRequiredApprovals = useCallback(
    (ckbAmount: bigint) => {
      const matched = approvalThresholds.filter(
        (threshold) => ckbAmount >= threshold
      );
      return matched.length + 1;
    },
    [approvalThresholds]
  );

  const filteredTippings = useMemo(() => {
    return tippings.filter((tipping) => {
      const proposerLockHash = (() => {
        try {
          return ccc.hexFrom(tipping.data.proposer_lock_hash).toLowerCase();
        } catch {
          try {
            return tipping.data.proposer_lock_hash
              ?.toString()
              ?.toLowerCase?.() as string;
          } catch {
            return "";
          }
        }
      })();

      if (!isAdmin) {
        const status = tipping.data.status?.toLowerCase?.() ?? "";
        if (status === "created") {
          const isOwner =
            viewerLockHash && proposerLockHash === viewerLockHash.toLowerCase();
          if (!isOwner) {
            return false;
          }
        }
      }

      const lowerSearch = searchTerm.toLowerCase();
      const titleMatch = tipping.metadata.contribution_title
        .toLowerCase()
        .includes(lowerSearch);
      const targetMatch = tipping.data.target_lock_hash
        .toString()
        .toLowerCase()
        .includes(lowerSearch);
      const proposerMatch = proposerLockHash.includes(lowerSearch);
      const proposerInfo = endorserResolver.resolve(proposerLockHash);
      const proposerNameMatch = proposerInfo
        ? proposerInfo.name.toLowerCase().includes(lowerSearch)
        : false;
      const proposerDescriptionMatch =
        proposerInfo && proposerInfo.description
          ? proposerInfo.description.toLowerCase().includes(lowerSearch)
          : false;

      return (
        titleMatch ||
        targetMatch ||
        proposerMatch ||
        proposerNameMatch ||
        proposerDescriptionMatch
      );
    });
  }, [endorserResolver, isAdmin, searchTerm, tippings, viewerLockHash]);

  // Auto-scroll to tipping if typeId is in URL params
  useEffect(() => {
    const tippingTypeId = searchParams.get("tipping");
    if (!tippingTypeId || isLoading || filteredTippings.length === 0) {
      return;
    }

    // Wait a bit for DOM to render
    const timer = setTimeout(() => {
      const element = tippingRefs.current.get(tippingTypeId);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        // Highlight the element briefly
        element.style.transition = "box-shadow 0.3s ease";
        element.style.boxShadow = "0 0 0 4px rgba(59, 130, 246, 0.5)";
        setTimeout(() => {
          element.style.boxShadow = "";
        }, 2000);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [searchParams, isLoading, filteredTippings]);

  const handleApprove = useCallback(
    async (tipping: TippingInfo) => {
      if (!isAdmin && !isEndorser) {
        toast({
          title: "Restricted action",
          description:
            "Only admins or authorized endorsers can support tipping proposals.",
          variant: "destructive",
        });
        throw new Error("Approval or endorsement not permitted");
      }

      if (!signer || !viewerLockHash) {
        toast({
          title: "Wallet required",
          description: "Connect your wallet to support this proposal.",
          variant: "destructive",
        });
        throw new Error("Wallet connection required");
      }

      const supporters = tipping.data.supporter_lock_hashes.map((hash) =>
        ccc.hexFrom(hash)
      );
      const supportersLower = supporters.map((hash) => hash.toLowerCase());
      const alreadyApproved = supporters.length > 0;

      if (!isAdmin && isEndorser && !alreadyApproved) {
        toast({
          title: "Awaiting admin approval",
          description:
            "An admin must record the first approval before endorsements are allowed.",
          variant: "destructive",
        });
        throw new Error("Admin approval required before endorsement");
      }

      if (supportersLower.includes(viewerLockHash.toLowerCase())) {
        toast({
          title: "Already recorded",
          description: "Your support has already been recorded for this tip.",
        });
        return;
      }

      const updatedSupporters = [
        ...supporters,
        viewerLockHash as ccc.HexLike,
      ] as ccc.HexLike[];

      const ckbAmount = parseBigInt(tipping.data.rewards.ckb_amount);
      const requiredApprovals = getRequiredApprovals(ckbAmount);
      let status = "created";
      if (updatedSupporters.length > 0) {
        status = "approved";
      }
      if (updatedSupporters.length >= requiredApprovals) {
        status = "granted";
      }

      const updatedTipping: TippingInfo = {
        ...tipping,
        data: {
          ...tipping.data,
          supporter_lock_hashes: updatedSupporters as ccc.HexLike[],
          status: status,
          granted_at:
            status === "granted"
              ? BigInt(Date.now())
              : tipping.data.granted_at ?? 0n,
        },
      };

      try {
        const txHash = await updateTipping(updatedTipping);
        const isEndorserAction = !isAdmin;
        toast({
          title:
            status === "granted"
              ? "Tipping granted"
              : isEndorserAction
              ? "Endorsement recorded"
              : "Approval recorded",
          description:
            status === "granted"
              ? "Required approvals reached. Distribution can proceed."
              : `Transaction ${txHash.slice(0, 10)}…${txHash.slice(
                  -6
                )} submitted.`,
        });
      } catch (error) {
        log.error("Failed to approve tipping", error);
        if (error instanceof InsufficientTippingFundingError) {
          toast({
            title: "Insufficient funding",
            description:
              "Not enough assets in the protocol pool. Please top up before granting.",
            variant: "destructive",
          });
          throw error;
        }
        toast({
          title: "Approval failed",
          description:
            error instanceof Error
              ? error.message
              : "Unable to approve tipping proposal.",
          variant: "destructive",
        });
        throw error;
      }
    },
    [
      getRequiredApprovals,
      isAdmin,
      isEndorser,
      signer,
      toast,
      updateTipping,
      viewerLockHash,
    ]
  );

  const handleLike = (typeId: string) => {
    setTippings((prev) =>
      prev.map((tipping) =>
        tipping.typeId === typeId
          ? {
              ...tipping,
              isLiked: !tipping.comments.some(
                (comment) => comment.author === "CurrentUser"
              ),
              likes: tipping.comments.some(
                (comment) => comment.author === "CurrentUser"
              )
                ? tipping.comments.length - 1
                : tipping.comments.length + 1,
            }
          : tipping
      )
    );
  };

  const handleComment = (typeId: string, comment: string) => {
    const newComment = {
      id: `comment-${Date.now()}`,
      author: "CurrentUser",
      content: comment,
      timestamp: "now",
      likes: 0,
      isLiked: false,
    };

    setTippings((prev) =>
      prev.map((tipping) =>
        tipping.typeId === typeId
          ? {
              ...tipping,
              comments: [newComment, ...tipping.comments],
            }
          : tipping
      )
    );
  };

  const handleAdditionalTip = async (
    typeId: string,
    tipData: { amount: number; message?: string; txHash?: string }
  ) => {
    const newTip = {
      id: `tip-${Date.now()}`,
      from: "CurrentUser",
      amount: tipData.amount,
      message: tipData.message,
      timestamp: "now",
      status: "completed" as const,
    };

    setTippings((prev) =>
      prev.map((tipping) =>
        tipping.typeId === typeId
          ? {
              ...tipping,
              additionalTips: [newTip, ...tipping.additionalTips],
            }
          : tipping
      )
    );

    if (tipData.txHash) {
    }
  };

  return (
    <div className="space-y-6">
      <TippingFundingPanel />

      {/* Header Actions */}
      <div className="flex items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <Input
            placeholder="Search proposals..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 bg-[#1b1b1b] border-[#535353] text-white placeholder:text-gray-400"
          />
        </div>
        <Link href="/tipping/propose-tipping">
          <Button 
            className="flex items-center gap-2 rounded-full text-white font-semibold shadow-lg border-0 hover:opacity-90 transition-opacity"
            style={{ backgroundColor: "#0000FF" }}
          >
            <Plus className="w-4 h-4" />
            Propose Tipping
          </Button>
        </Link>
      </div>

      {isLoading && (
        <div className="text-center text-gray-400 py-6">
          Loading proposals…
        </div>
      )}

      {error && (
        <div className="text-center text-red-400 py-4 text-sm">{error}</div>
      )}

      {/* Proposals List */}
      <div className="space-y-6">
        {filteredTippings.map((tipping) => {
          const tippingKey =
            tipping.typeId ?? ccc.hexFrom(tipping.data.target_lock_hash);
          return (
            <div
              key={tippingKey}
              ref={(el) => {
                if (el && tipping.typeId) {
                  tippingRefs.current.set(tipping.typeId, el);
                }
              }}
            >
              <TippingCard
                tipping={tipping}
                canApprove={isAdmin || isEndorser}
                viewerLockHash={viewerLockHash}
                isViewerAdmin={isAdmin}
                isViewerEndorser={isEndorser}
                onApprove={handleApprove}
                onLike={handleLike}
                onComment={handleComment}
                onAdditionalTip={handleAdditionalTip}
                initialStats={socialStats[tipping.typeId ?? ""]}
              />
            </div>
          );
        })}
      </div>

      {filteredTippings.length === 0 && !isLoading && (
        <div className="text-center py-12">
          <div className="text-6xl mb-4">💰</div>
          <h3 className="text-xl font-semibold mb-2 text-white">No proposals found</h3>
          <p className="text-gray-400">
            {searchTerm
              ? "Try adjusting your search terms"
              : "Be the first to create a tip proposal!"}
          </p>
        </div>
      )}
    </div>
  );
}
