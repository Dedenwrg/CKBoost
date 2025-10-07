"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ccc } from "@ckb-ccc/connector-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Navigation } from "@/components/navigation";
import {
  ArrowLeft,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import {
  TippingInfo,
  TippingProvider,
  useTippingContext,
} from "@/lib/providers/tipping-provider";
import { TippingDataLike } from "ssri-ckboost/types";
import { MarkdownEditor } from "@/components/markdown-editor";
import { useNostrStorage } from "@/hooks/use-nostr-storage";
import { useStorageModal } from "@/lib/providers/storage-modal-provider";

export default function ProposeTippingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const signer = ccc.useSigner();
  const { updateTipping } = useTippingContext();
  const { storeSubmission, isConnected: nostrConnected } = useNostrStorage();
  const storageModal = useStorageModal();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [currentUserAllowlisted] = useState(true);
  const [proposerLockHash, setProposerLockHash] = useState<string | null>(null);
  const [proposerAddress, setProposerAddress] = useState<string | null>(null);
  const [tippingTypeId, setTippingTypeId] = useState<string | null>(
    searchParams.get("typeId")
  );
  const [pendingTippingData, setPendingTippingData] =
    useState<TippingDataLike | null>(null);
  const [pendingTippingTypeId, setPendingTippingTypeId] = useState<
    string | null
  >(null);
  const [pendingNeventId, setPendingNeventId] = useState<string | null>(null);
  const typeIdParam = searchParams.get("typeId");

  useEffect(() => {
    if (typeIdParam) {
      setTippingTypeId(typeIdParam);
    }
  }, [typeIdParam]);

  const [formData, setFormData] = useState({
    targetLockHash: "",
    contributionTitle: "",
    contributionType: "analysis",
    typeTags: "analysis",
    shortDescription: "",
    longDescription: "",
    supporterLockHashes: "",
    ckbAmount: "0",
    pointsAmount: "0",
  });

  useEffect(() => {
    let cancelled = false;

    async function resolveProposerLockHash() {
      if (!signer) {
        setProposerLockHash(null);
        setProposerAddress(null);
        return;
      }

      try {
        const recommended = await signer.getRecommendedAddressObj();
        const lockHash = recommended.script.hash();
        if (!cancelled) {
          setProposerLockHash(lockHash);
          setProposerAddress(recommended.toString() ?? null);
        }
      } catch (error) {
        console.error("Failed to derive proposer lock hash", error);
        if (!cancelled) {
          setProposerLockHash(null);
          setProposerAddress(null);
        }
      }
    }

    resolveProposerLockHash();
    return () => {
      cancelled = true;
    };
  }, [signer]);

  const creationTimestamp = useMemo(() => BigInt(Date.now()), []);

  const finalizeTippingSubmission = async (tipping?: TippingInfo) => {
    console.debug("📍 About to finalizeTippingSubmission", {
      pendingTippingData,
      tipping,
    });
    try {
      const finalTippingData = pendingTippingData || tipping?.data;

      if (!finalTippingData) {
        throw new Error("Missing tipping data");
      }

      const finalTipping =
        tipping ||
        ({
          data: pendingTippingData,
          metadata: {
            contribution_title: finalTippingData.metadata.contribution_title,
            contribution_type_tags:
              finalTippingData.metadata.contribution_type_tags,
            short_description: finalTippingData.metadata.short_description,
            long_description: finalTippingData.metadata.long_description,
            creation_timestamp: finalTippingData.metadata.creation_timestamp,
          },
          comments: [],
          additionalTips: [],
        } as TippingInfo);

      console.debug("📍 finalizeTippingSubmission", {
        providedData: tipping,
        hasPendingNevent: !!pendingNeventId,
      });

      const txHash = await updateTipping(finalTipping);

      setPendingTippingData(null);
      setPendingTippingTypeId(null);
      setPendingNeventId(null);

      return txHash;
    } catch (error) {
      console.error("Failed to submit tipping proposal", error);
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Failed to submit tipping proposal"
      );
      throw error;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!currentUserAllowlisted) {
      alert("Only allowlisted community members can create tipping proposals.");
      return;
    }

    if (!proposerLockHash) {
      alert(
        "Unable to determine proposer lock hash. Please ensure your wallet is connected."
      );
      return;
    }

    setSubmitError(null);
    setIsSubmitting(true);

    try {
      let longDescriptionForChain = formData.longDescription;

      if (
        longDescriptionForChain &&
        !longDescriptionForChain.startsWith("nevent1") &&
        nostrConnected
      ) {
        const identifier = formData.targetLockHash || proposerLockHash;
        if (identifier) {
          try {
            const userAddress =
              proposerAddress || proposerLockHash || "unknown";
            const uniqueQuestId = Date.now();
            const serializedContent = JSON.stringify({
              format: "ckboost-tipping-long-description",
              version: "1.0",
              timestamp: Date.now(),
              metadata: {
                targetLockHash: formData.targetLockHash,
                proposerLockHash,
                contributionTitle: formData.contributionTitle,
                shortDescription: formData.shortDescription,
                typeTags: formData.typeTags
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter((tag) => tag.length > 0),
              },
              contentHtml: longDescriptionForChain,
            });
            const neventId = await storeSubmission.mutateAsync({
              campaignTypeId: identifier,
              questId: uniqueQuestId,
              userAddress,
              content: serializedContent,
              timestamp: Date.now(),
            });
            longDescriptionForChain = neventId;
            setPendingNeventId(neventId);
          } catch (nostrError) {
            console.warn(
              "Failed to store long description on Nostr; falling back to on-chain storage",
              nostrError
            );
          }
        }
      }

      const supporterLockHashes = formData.supporterLockHashes
        .split(",")
        .map((hash) => hash.trim())
        .filter((hash) => hash.length > 0);

      const tippingData: TippingDataLike = {
        target_lock_hash: formData.targetLockHash,
        proposer_lock_hash: proposerLockHash,
        supporter_lock_hashes: supporterLockHashes,
        metadata: {
          contribution_title: formData.contributionTitle,
          contribution_type_tags: formData.typeTags
            .split(",")
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0),
          short_description: formData.shortDescription,
          long_description: longDescriptionForChain,
          creation_timestamp: creationTimestamp,
        },
        rewards: {
          points_amount: formData.pointsAmount
            ? BigInt(formData.pointsAmount)
            : 0n,
          ckb_amount: formData.ckbAmount ? BigInt(formData.ckbAmount) : 0n,
          nft_assets: [],
          udt_assets: [],
        },
        status: "created",
        granted_at: 0n,
      };

      setPendingTippingData(tippingData);
      setPendingTippingTypeId(tippingTypeId);

      if (longDescriptionForChain.startsWith("nevent1") && nostrConnected) {
        storageModal.open({
          neventId: longDescriptionForChain,
          mode: "verifying",
          onConfirm: async () =>
            finalizeTippingSubmission({
              data: tippingData,
              comments: [],
              additionalTips: [],
              metadata: tippingData.metadata,
            }),
          onClose: () => {
            setPendingTippingData(null);
            setPendingTippingTypeId(null);
            setPendingNeventId(null);
            setIsSubmitting(false);
          },
        });
        setIsSubmitting(false);
        return;
      }

      await finalizeTippingSubmission({
        data: tippingData,
        comments: [],
        additionalTips: [],
        metadata: tippingData.metadata,
      });
      setPendingTippingData(null);
      setPendingTippingTypeId(null);
      setPendingNeventId(null);
    } catch (error) {
      console.error("Failed to submit tipping proposal", error);
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Failed to submit tipping proposal"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasMeaningfulLongDescription = () => {
    const textContent = formData.longDescription
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, "")
      .trim();
    return textContent.length > 0;
  };

  const isFormValid = () => {
    return (
      formData.targetLockHash &&
      formData.contributionTitle &&
      formData.shortDescription &&
      hasMeaningfulLongDescription()
    );
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "analysis":
        return "bg-blue-100 text-blue-800";
      case "tutorial":
        return "bg-green-100 text-green-800";
      case "proposal":
        return "bg-purple-100 text-purple-800";
      case "comment":
        return "bg-orange-100 text-orange-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const fillTestData = () => {
    const randomSuffix = Math.floor(Math.random() * 1000);
    const mockLockHash = `0x${"ab".repeat(32)}`;

    setFormData({
      targetLockHash: mockLockHash,
      contributionTitle: `Insightful Community Analysis #${randomSuffix}`,
      contributionType: "analysis",
      typeTags: "analysis, community, research",
      shortDescription:
        "Highlighting tangible outcomes from this week's CKBoost collaboration wave.",
      longDescription:
        "<p><strong>Summary:</strong> We delivered three high-impact assets that unblock new builders.</p><ul><li>Published a step-by-step SDK integration tutorial with code samples.</li><li>Drove a 60-person workshop where 70% shipped working demos.</li><li>Coordinated translation of onboarding docs into three new languages.</li></ul><p>Each deliverable includes reproducible references so the next cohort can ramp instantly.</p>",
      supporterLockHashes: `0x${"cd".repeat(32)}, 0x${"ef".repeat(32)}`,
      ckbAmount: "64",
      pointsAmount: "250",
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-green-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <Navigation />

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-3xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <Link
              href="/tipping"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Tipping
            </Link>

            <div className="flex items-center gap-3 mb-4">
              <div className="text-4xl">💰</div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                Propose Community Tipping
              </h1>
            </div>

            <p className="text-lg text-muted-foreground">
              Submit a tipping proposal for a valuable contribution. Approved
              proposals will draw from the shared protocol funding pool.
            </p>
          </div>

          {/* Allowlist Status */}
          <div className="mb-6">
            {currentUserAllowlisted ? (
              <div className="flex items-center gap-2 p-4 bg-green-50 border border-green-200 rounded-lg">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <div>
                  <div className="font-medium text-green-800">
                    You&apos;re authorised to propose tipping
                  </div>
                  <div className="text-sm text-green-600">
                    Your proposal will be published for community approval and
                    execution
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle className="w-5 h-5 text-red-600" />
                <div>
                  <div className="font-medium text-red-800">
                    Authorization required
                  </div>
                  <div className="text-sm text-red-600">
                    Only allowlisted community members can propose tippings
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Propose Tipping Form */}
          <Card>
            <CardHeader>
              <CardTitle>Tipping Details</CardTitle>
              <CardDescription>
                Provide the required metadata and target information for the
                tipping proposal.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="targetLockHash">
                      Recipient Lock Hash *
                    </Label>
                    <Input
                      id="targetLockHash"
                      value={formData.targetLockHash}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          targetLockHash: e.target.value,
                        })
                      }
                      placeholder="0x..."
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contributionType">Type *</Label>
                    <select
                      id="contributionType"
                      value={formData.contributionType}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          contributionType: e.target.value,
                          typeTags: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 border border-input rounded-md bg-background"
                      required
                    >
                      <option value="analysis">Analysis</option>
                      <option value="tutorial">Tutorial</option>
                      <option value="proposal">Proposal</option>
                      <option value="comment">Comment</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Selected type:
                  </span>
                  <Badge className={getTypeColor(formData.contributionType)}>
                    {formData.contributionType}
                  </Badge>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="typeTags">Additional Tags</Label>
                  <Input
                    id="typeTags"
                    value={formData.typeTags}
                    onChange={(e) =>
                      setFormData({ ...formData, typeTags: e.target.value })
                    }
                    placeholder="analysis, education, community"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contributionTitle">
                    Contribution Title *
                  </Label>
                  <Input
                    id="contributionTitle"
                    value={formData.contributionTitle}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        contributionTitle: e.target.value,
                      })
                    }
                    placeholder="Brief title of the contribution"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="shortDescription">Short Description *</Label>
                  <Textarea
                    id="shortDescription"
                    value={formData.shortDescription}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        shortDescription: e.target.value,
                      })
                    }
                    placeholder="One or two sentence summary"
                    rows={2}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="longDescription">Long Description *</Label>
                  <MarkdownEditor
                    id="longDescription"
                    value={formData.longDescription}
                    onChange={(value) =>
                      setFormData({
                        ...formData,
                        longDescription: value,
                      })
                    }
                    placeholder="Detailed explanation of the contribution and justification for tipping"
                    height={300}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="supporterLockHashes">
                    Supporter Lock Hashes
                  </Label>
                  <Textarea
                    id="supporterLockHashes"
                    value={formData.supporterLockHashes}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        supporterLockHashes: e.target.value,
                      })
                    }
                    placeholder="Comma-separated list of lock hashes supporting this proposal"
                    rows={3}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="pointsAmount">Points Reward</Label>
                    <Input
                      id="pointsAmount"
                      type="number"
                      min="0"
                      value={formData.pointsAmount}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          pointsAmount: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ckbAmount">CKB Reward</Label>
                    <Input
                      id="ckbAmount"
                      type="number"
                      min="0"
                      value={formData.ckbAmount}
                      onChange={(e) =>
                        setFormData({ ...formData, ckbAmount: e.target.value })
                      }
                    />
                  </div>
                </div>

                {submitError && (
                  <div className="text-sm text-destructive">{submitError}</div>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="submit"
                    className="flex items-center gap-2"
                    disabled={isSubmitting || !isFormValid()}
                  >
                    {isSubmitting ? "Submitting…" : "Submit Proposal"}
                  </Button>
                  {process.env.NODE_ENV !== "production" && (
                    <Button
                      type="button"
                      variant="outline"
                      className="flex items-center gap-2"
                      onClick={fillTestData}
                      disabled={isSubmitting}
                    >
                      <Sparkles className="w-4 h-4" />
                      Fill Test Data
                    </Button>
                  )}
                  <a
                    href="https://docs.ckboost.xyz/developer-docs"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm inline-flex items-center gap-2 text-muted-foreground hover:text-foreground"
                  >
                    Developer docs
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
