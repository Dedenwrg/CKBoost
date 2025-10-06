"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TippingCard } from "./tipping-card";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import {
  TippingInfo,
  useTippingsData,
} from "../lib/providers/tipping-provider";
import { Tipping } from "ssri-ckboost";
import { TippingDataLike } from "ssri-ckboost/types";
import { useUser } from "@/lib/providers/user-provider";
import { ccc } from "@ckb-ccc/connector-react";

const MOCK_TIPPINGS: TippingInfo[] = [];

export function Tippings() {
  const { tippings: contextTippings, isLoading, error } = useTippingsData();

  const [tippings, setTippings] = useState<TippingInfo[]>(contextTippings);
  const [searchTerm, setSearchTerm] = useState("");
  const { userRecommendedAddressObj } = useUser();

  useEffect(() => {
    setTippings(contextTippings);
  }, [contextTippings]);

  const filteredTippings = useMemo(() => {
    return tippings.filter(
      (tipping) =>
        tipping.metadata.contribution_title
          .toLowerCase()
          .includes(searchTerm.toLowerCase()) ||
        tipping.data.target_lock_hash
          .toString()
          .toLowerCase()
          .includes(searchTerm.toLowerCase()) ||
        tipping.data.proposer_lock_hash
          .toString()
          .toLowerCase()
          .includes(searchTerm.toLowerCase())
    );
  }, [tippings, searchTerm]);

  const handleApprove = (typeId: string) => {
    setTippings((prev) =>
      prev.map((tipping) =>
        tipping.typeId === typeId
          ? {
              ...tipping,
              data: {
                ...tipping.data,
                approvals: [
                  ...tipping.data.supporter_lock_hashes,
                  ccc.hexFrom(userRecommendedAddressObj?.script.hash() ?? ""),
                ],
              },
            }
          : tipping
      )
    );
  };

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

  const handleAdditionalTip = (
    typeId: string,
    tipData: { amount: number; message?: string }
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
  };

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            placeholder="Search proposals..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <Link href="/tipping/propose-tipping">
          <Button className="flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Propose Tipping
          </Button>
        </Link>
      </div>

      {isLoading && (
        <div className="text-center text-muted-foreground py-6">
          Loading proposals…
        </div>
      )}

      {error && (
        <div className="text-center text-destructive py-4 text-sm">{error}</div>
      )}

      {/* Proposals List */}
      <div className="space-y-6">
        {filteredTippings.map((tipping) => (
          <TippingCard
            key={tipping.typeId}
            tipping={tipping}
            onApprove={handleApprove}
            onLike={handleLike}
            onComment={handleComment}
            onAdditionalTip={handleAdditionalTip}
          />
        ))}
      </div>

      {filteredTippings.length === 0 && !isLoading && (
        <div className="text-center py-12">
          <div className="text-6xl mb-4">💰</div>
          <h3 className="text-xl font-semibold mb-2">No proposals found</h3>
          <p className="text-muted-foreground">
            {searchTerm
              ? "Try adjusting your search terms"
              : "Be the first to create a tip proposal!"}
          </p>
        </div>
      )}
    </div>
  );
}
