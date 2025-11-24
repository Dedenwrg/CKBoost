"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SocialInteractions } from "./social-interactions";
import { useUser } from "@/lib/providers/user-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ccc } from "@ckb-ccc/connector-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { createScopedLogger } from "ssri-ckboost";
import { Comment } from "./social-interactions";

const log = createScopedLogger("TippingCommentsSection");

export function TippingCommentsSection({
  tippingTypeId,
  comments,
  error,
  postComment,
  postLike,
  likesCount,
  isLiked,
  onLike,
  onComment,
  hasMore,
  loadMore,
  isLoading,
  totalComments,
  isViewerAdmin,
}: {
  tippingTypeId?: string;
  comments: Comment[];
  error: string | null;
  postComment: (
    comment: string,
    tipData?: { txHash: string; amount: string }
  ) => Promise<void>;
  postLike: () => Promise<void>;
  likesCount: number;
  isLiked: boolean;
  onLike?: () => void;
  onComment?: (comment: string) => void;
  hasMore?: boolean;
  loadMore?: () => void;
  isLoading?: boolean;
  totalComments?: number;
  isViewerAdmin?: boolean;
}) {
  const {
    currentUserTypeId,
    createUserProfile,
    refreshUserData,
    userService,
    isLoading: userLoading,
  } = useUser();
  const { open: openWalletModal } = ccc.useCcc();
  const canComment = Boolean(userService);

  const [showProfileDialog, setShowProfileDialog] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);
  const [pendingComment, setPendingComment] = useState<string | null>(null);
  const [awaitingProfileReady, setAwaitingProfileReady] = useState(false);
  const [moduleError, setModuleError] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const postCommentRef = useRef(postComment);

  useEffect(() => {
    postCommentRef.current = postComment;
  }, [postComment]);

  useEffect(() => {
    if (
      awaitingProfileReady &&
      currentUserTypeId &&
      pendingComment &&
      tippingTypeId
    ) {
      (async () => {
        try {
          const post = postCommentRef.current;
          if (!post) {
            return;
          }
          await post(pendingComment);
          setPendingComment(null);
          setModuleError(null);
          setCommentDraft("");
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : "Failed to publish comment after profile creation";
          setModuleError(message);
        } finally {
          setAwaitingProfileReady(false);
        }
      })();
    }
  }, [awaitingProfileReady, currentUserTypeId, pendingComment, tippingTypeId]);

  const resetProfileDialog = () => {
    setProfileName("");
    setProfileError(null);
    setShowProfileDialog(false);
  };

  const handleComment = useCallback(
    async (_tippingId: string, comment: string) => {
      setModuleError(null);
      if (!comment.trim()) {
        return false;
      }

      if (!tippingTypeId) {
        setModuleError("Unable to determine tipping type ID for comments.");
        return false;
      }

      if (!currentUserTypeId) {
        try {
          if (userService) {
            const exists = await userService.userExists();
            if (exists) {
              setPendingComment(comment);
              setAwaitingProfileReady(true);
              setModuleError(
                "Loading your profile data. Comment will post once ready."
              );
              await refreshUserData();
              return false;
            }
          }
        } catch (err) {
          log.warn("Failed to check user profile existence", err);
        }

        setPendingComment(comment);
        setShowProfileDialog(true);
        return false;
      }

      try {
        await postComment(comment);
        onComment?.(comment);
        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to post comment.";
        setModuleError(message);
        throw err;
      }
    },
    [
      currentUserTypeId,
      postComment,
      tippingTypeId,
      refreshUserData,
      userService,
      onComment,
    ]
  );

  const handleProfileSubmit = async () => {
    const trimmed = profileName.trim();
    if (!trimmed) {
      setProfileError("Please enter your name");
      return;
    }

    try {
      setIsCreatingProfile(true);
      setProfileError(null);
      await createUserProfile(trimmed);

      setShowProfileDialog(false);
      setAwaitingProfileReady(true);
      setProfileName("");

      await new Promise((resolve) => setTimeout(resolve, 3500));
      await refreshUserData();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create profile";
      setProfileError(message);
      log.error("Failed to create user profile", err);
    } finally {
      setIsCreatingProfile(false);
    }
  };

  const handleProfileDialogChange = (isOpen: boolean) => {
    setShowProfileDialog(isOpen);
    if (!isOpen) {
      setPendingComment(null);
      resetProfileDialog();
    }
  };

  const handleRequestConnect = useCallback(() => {
    try {
      void openWalletModal();
    } catch (err) {
      log.warn("Failed to open wallet connector", err);
    }
  }, [openWalletModal]);

  return (
    <div className="space-y-3">
      {moduleError && <p className="text-sm text-destructive">{moduleError}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {awaitingProfileReady && (
        <p className="text-sm text-muted-foreground">
          Waiting for your profile to be created on-chain. This can take a few
          seconds...
        </p>
      )}
      <SocialInteractions
        tipping_type_id={tippingTypeId ?? ""}
        initialLikes={likesCount}
        initialComments={comments}
        isLiked={isLiked}
        onLike={async () => {
          try {
            await postLike();
            onLike?.();
          } catch (e) {
            log.error("Failed to like", e);
          }
        }}
        onComment={handleComment}
        onShare={() => {}}
        commentEnabled={canComment}
        commentDisabledLabel="Connect wallet"
        onConnectWallet={handleRequestConnect}
        draftComment={commentDraft}
        onDraftCommentChange={setCommentDraft}
        hasMore={hasMore}
        onLoadMore={loadMore}
        isLoadingMore={isLoading}
        totalComments={totalComments}
        isAdmin={isViewerAdmin}
      />

      <Dialog open={showProfileDialog} onOpenChange={handleProfileDialogChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create your CKBoost profile</DialogTitle>
            <DialogDescription>
              You need a CKBoost user cell before participating in proposal
              discussions. Provide a name to create your profile on-chain.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="profile-name">Display name</Label>
              <Input
                id="profile-name"
                placeholder="e.g. Satoshi"
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
                disabled={isCreatingProfile || userLoading}
              />
              {profileError && (
                <p className="text-sm text-destructive">{profileError}</p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Creating a user cell requires an on-chain transaction and may take
              a few seconds to confirm.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleProfileDialogChange(false)}
              disabled={isCreatingProfile}
            >
              Cancel
            </Button>
            <Button
              onClick={handleProfileSubmit}
              disabled={isCreatingProfile || userLoading}
            >
              {isCreatingProfile ? "Creating..." : "Create profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
