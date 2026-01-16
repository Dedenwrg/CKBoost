import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNostrStorage } from "@/hooks/use-nostr-storage";
import { useUser } from "@/lib/providers/user-provider";
import { getLatestDisplayName } from "@/lib/profile/profile-data";
import { createScopedLogger } from "ssri-ckboost";
import { Comment } from "@/components/social-interactions";
import { nip19 } from "nostr-tools";
import { ccc } from "@ckb-ccc/connector-react";
import { NostrComment, useNostrFetch } from "./use-nostr-fetch";

const log = createScopedLogger("useTippingComments");

interface TippingCommentPayload {
  type: "tipping_comment" | "tipping_like";
  version: number;
  tippingTypeId: string;
  text: string;
  authorLockHash?: string;
  authorTypeId?: string | null;
  displayName?: string;
  createdAt: number;
  isTip?: boolean;
  txHash?: string;
  amount?: string;
}

export interface CommentListReplaceableKey {
  authorPubkey: string;
  dTag: string;
}

const COMMENT_TAG_TYPE = "tipping_comment";
const LIKE_TAG_TYPE = "tipping_like";

const shortenHash = (hash?: string | null) => {
  if (!hash) return "Unknown";
  const normalized = hash.startsWith("0x") ? hash.slice(2) : hash;
  return normalized.length <= 12
    ? normalized
    : `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
};

const formatTimestamp = (timestamp: number) =>
  new Date(timestamp).toLocaleString();

export function useTippingComments(
  tippingTypeId?: string,
  commentListReplaceableKey?: CommentListReplaceableKey,
  isAdmin?: boolean
) {
  const { storeEvent, fetchEventById } = useNostrStorage();
  const {
    fetchCommentsWithNostrCommentList,
    fetchEventWithNeventId,
    fetchReplaceableEvent,
  } = useNostrFetch();
  const { currentUserData, currentUserTypeId, userRecommendedAddressObj } =
    useUser();
  const signer = ccc.useSigner();
  const [commentList, setCommentList] = useState<NostrComment[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [tipComments, setTipComments] = useState<Comment[]>([]);
  const [likesCount, setLikesCount] = useState(0);
  const [isLiked, setIsLiked] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [totalComments, setTotalComments] = useState(0);
  const [totalTipAmountCkb, setTotalTipAmountCkb] = useState(0);
  const [tipPage, setTipPage] = useState(1);
  const lastCommentRef = useRef<{ text: string; timestamp: number } | null>(
    null
  );
  const TIP_PAGE_SIZE = 5;

  const toCkbAmount = useCallback(
    (fixedPoint: string | undefined | null): number => {
      if (!fixedPoint) return 0;
      try {
        const raw = BigInt(fixedPoint);
        return Number(raw) / 10 ** 8;
      } catch {
        return 0;
      }
    },
    []
  );

  const currentLockHash = useMemo(() => {
    try {
      return userRecommendedAddressObj
        ? userRecommendedAddressObj.script.hash()
        : null;
    } catch {
      return null;
    }
  }, [userRecommendedAddressObj]);

  const currentDisplayName = useMemo(
    () =>
      getLatestDisplayName(currentUserData?.profile_data) ??
      shortenHash(currentLockHash),
    [currentUserData?.profile_data, currentLockHash]
  );

  const fetchCommentList = useCallback(async () => {
    if (!commentListReplaceableKey) return;
    const commentListEvent = await fetchReplaceableEvent(
      commentListReplaceableKey.authorPubkey,
      commentListReplaceableKey.dTag
    );
    if (!commentListEvent?.content) return;
    const commentListData = JSON.parse(commentListEvent.content) as {
      comments: NostrComment[];
      blacklistedSenders: string[];
    };
    setCommentList(commentListData.comments);
  }, [commentListReplaceableKey]);

  const fetchComments = useCallback(
    async (pageParam: number, reset: boolean) => {
      if (!tippingTypeId) return;
      if (!commentList || commentList.length === 0) return;
      if (!commentListReplaceableKey) return;

      setIsLoading(true);
      setError(null);

      try {
        // Try to get comments list neventId from long description

        try {
          const commentListSlice = commentList.slice(
            (pageParam - 1) * 20,
            Math.min(commentList.length, pageParam * 20)
          );

          // Fetch each comment event by neventId
          const fetchedComments = await fetchCommentsWithNostrCommentList(
            commentListSlice
          );
          if (!fetchedComments) return;
          // Separate tip comments from regular comments
          const tipComments = fetchedComments.filter((c) => c.isTip);
          const regularComments = fetchedComments.filter((c) => !c.isTip);

          setComments((prev) => {
            const existing = reset
              ? new Map<string, Comment>()
              : new Map(prev.map((c) => [c.neventId, c]));

            [...tipComments, ...regularComments].forEach((c) => {
              existing.set(c.neventId, c);
            });

            return Array.from(existing.values()).sort(
              (a, b) =>
                new Date(b.timestamp).getTime() -
                new Date(a.timestamp).getTime()
            );
          });

          setTipComments(tipComments);
          setTotalComments(regularComments.length + tipComments.length);
          // likes currently not tracked via nostr list
          setLikesCount(0);
          const totalTipAmount = tipComments.reduce(
            (acc, c) => acc + toCkbAmount(c.tipAmount),
            0
          );
          setTotalTipAmountCkb(totalTipAmount);
          setHasMore(commentList.length > pageParam * 20);
          setPage(pageParam + 1);
          setIsLoading(false);
          return;
        } catch {
          // If parsing fails, fall through to empty state below
        }

        // If no comments list reference, return empty without error
        if (reset) {
          setComments([]);
          setTipComments([]);
        }
        setTotalComments(0);
        setLikesCount(0);
        setTotalTipAmountCkb(0);
        setHasMore(false);
        setPage(reset ? 1 : pageParam + 1);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to load comments";
        setError(message);
        log.error("Failed to load tipping comments", err);
      } finally {
        setIsLoading(false);
      }
    },
    [tippingTypeId, toCkbAmount, commentList]
  );

  const reload = useCallback(() => {
    setComments([]);
    setTipComments([]);
    setTipPage(1);
    setTotalComments(0);
    setHasMore(true);
    setPage(1);
    fetchCommentList();
    fetchComments(1, true);
  }, [fetchCommentList, fetchComments]);

  const loadMore = useCallback(() => {
    if (!hasMore || isLoading) return;
    fetchComments(page, false);
  }, [fetchComments, hasMore, isLoading, page]);

  const visibleTipComments = useMemo(
    () => tipComments.slice(0, tipPage * TIP_PAGE_SIZE),
    [tipComments, tipPage]
  );

  const hasMoreTipComments = useMemo(
    () => tipComments.length > tipPage * TIP_PAGE_SIZE,
    [tipComments, tipPage]
  );

  const loadMoreTipComments = useCallback(() => {
    if (!hasMoreTipComments) return;
    setTipPage((prev) => prev + 1);
  }, [hasMoreTipComments]);

  useEffect(() => {
    reload();
  }, [reload]);

  const postComment = useCallback(
    async (content: string, tipData?: { txHash: string; amount: string }) => {
      if (!tippingTypeId) throw new Error("Missing tipping proposal type ID");
      if (!currentUserTypeId) throw new Error("User profile required");
      if (!currentLockHash) throw new Error("User lock hash required");
      if (!commentListReplaceableKey)
        throw new Error("Missing comments list neventId");

      const trimmedContent = content.trim();
      if (!trimmedContent) throw new Error("Comment cannot be empty");

      const createdAt = Date.now();
      const last = lastCommentRef.current;
      if (last && createdAt - last.timestamp < 60_000) {
        if (last.text === trimmedContent) {
          throw new Error(
            "Please wait a bit before posting the same comment again."
          );
        }
      }

      const payload: TippingCommentPayload = {
        type: COMMENT_TAG_TYPE,
        version: 1,
        tippingTypeId,
        text: trimmedContent,
        authorLockHash: currentLockHash,
        authorTypeId: currentUserTypeId,
        displayName: currentDisplayName,
        createdAt,
        isTip: !!tipData,
        txHash: tipData?.txHash,
        amount: tipData?.amount,
      };

      const tags: string[][] = [
        ["type", COMMENT_TAG_TYPE],
        ["tipping", tippingTypeId],
        ["client", "ckboost-dapp"],
        ["timestamp", createdAt.toString()],
        ["user_lock", currentLockHash],
      ];

      if (tipData) tags.push(["is_tip", "true"]);
      if (currentUserTypeId) tags.push(["user_type", currentUserTypeId]);

      setIsPosting(true);
      try {
        // Step 1: Post the comment as a regular event first
        const contentString = JSON.stringify(payload);
        const storeCommentResult = await storeEvent.mutateAsync({
          content: contentString,
          tags,
        });

        // Step 2: Use neventId directly (no need to decode)
        const commentNeventId = storeCommentResult.neventId;

        // Step 3: Call Netlify function to update the comments list event
        // The server-side function will derive the correct private key and update the separate comments list event
        if (!tippingTypeId) {
          throw new Error("Missing tipping type ID for updating comments");
        }

        if (!signer) {
          throw new Error("Signer required for message signing");
        }

        // Create message to sign
        const message = JSON.stringify({
          action: "add",
          commentNeventId,
          tippingTypeId,
          timestamp: Date.now(),
        });

        // Sign the message
        const signature = await signer.signMessage(message);
        const addRequestBody = {
          action: "add",
          commentNeventId,
          commentListAuthor: commentListReplaceableKey.authorPubkey,
          dTag: commentListReplaceableKey.dTag,
          message,
          signatureString: signature.signature,
          signatureIdentity: signature.identity,
          signatureSignType: signature.signType,
        };
        console.log("addRequestBody", addRequestBody);
        const response = await fetch("/api/update-tipping-comments", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(addRequestBody),
        });

        if (!response.ok) {
          const error = await response
            .json()
            .catch(() => ({ error: "Failed to add comment" }));
          throw new Error(
            error.message || error.error || "Failed to add comment"
          );
        }

        const result = await response.json();
        log.info("Successfully added comment to comments list", {
          commentNeventId,
          commentListAuthor: commentListReplaceableKey.authorPubkey,
          dTag: commentListReplaceableKey.dTag,
        });

        // Optimistic update

        const newComment: Comment = {
          neventId: storeCommentResult.neventId,
          eventId: storeCommentResult.neventId, // eventId can be either neventId or raw eventId for backward compatibility
          author: currentDisplayName,
          content: trimmedContent,
          timestamp: formatTimestamp(createdAt),
          likes: 0,
          isLiked: false,
          link: `https://njump.me/${storeCommentResult.neventId}`,
          isTip: !!tipData,
          tipAmount: tipData?.amount,
          tipTxHash: tipData?.txHash,
        };

        setComments((prev) => {
          const existing = new Map(prev.map((c) => [c.neventId, c]));
          existing.delete(newComment.neventId);
          return [newComment, ...existing.values()];
        });
        if (tipData) {
          setTipComments((prev) => [newComment, ...prev]);
          setTipPage(1);
        }
        lastCommentRef.current = { text: trimmedContent, timestamp: createdAt };
      } catch (err) {
        log.error("Failed to post comment", err);
        throw err;
      } finally {
        setIsPosting(false);
      }
    },
    [
      tippingTypeId,
      currentUserTypeId,
      currentLockHash,
      currentDisplayName,
      storeEvent,
      tippingTypeId,
      commentListReplaceableKey,
    ]
  );

  const postLike = useCallback(async () => {
    if (!tippingTypeId) throw new Error("Missing tipping ID");
    if (!currentUserTypeId) throw new Error("User profile required");
    if (!currentLockHash) throw new Error("User lock hash required");

    const createdAt = Date.now();

    const payload: TippingCommentPayload = {
      type: LIKE_TAG_TYPE,
      version: 1,
      tippingTypeId,
      text: "",
      authorLockHash: currentLockHash,
      authorTypeId: currentUserTypeId,
      displayName: currentDisplayName,
      createdAt,
    };

    const tags: string[][] = [
      ["type", LIKE_TAG_TYPE],
      ["tipping", tippingTypeId],
      ["client", "ckboost-dapp"],
      ["timestamp", createdAt.toString()],
      ["user_lock", currentLockHash],
      ["user_type", currentUserTypeId],
    ];

    setIsPosting(true);
    try {
      await storeEvent.mutateAsync({
        content: JSON.stringify(payload),
        tags,
      });

      setLikesCount((prev) => prev + 1);
      setIsLiked(true);
    } catch (err) {
      log.error("Failed to post like", err);
      throw err;
    } finally {
      setIsPosting(false);
    }
  }, [
    tippingTypeId,
    currentUserTypeId,
    currentLockHash,
    currentDisplayName,
    storeEvent,
    commentListReplaceableKey,
  ]);

  const deleteComment = useCallback(
    async (commentNeventId: string) => {
      if (!isAdmin) {
        throw new Error("Admin privileges required to delete comments");
      }
      if (!tippingTypeId) {
        throw new Error("Missing tipping type ID");
      }
      if (!signer) {
        throw new Error("Signer required");
      }
      if (!commentListReplaceableKey) {
        throw new Error("Missing comments list neventId");
      }

      setIsPosting(true);
      try {
        const userAddress = await signer.getRecommendedAddress();

        // Create message to sign
        const message = JSON.stringify({
          action: "delete",
          commentNeventId,
          tippingTypeId,
          timestamp: Date.now(),
        });

        // Sign the message
        const signature = await signer.signMessage(message);

        const response = await fetch("/api/update-tipping-comments", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "delete",
            commentNeventId,
            commentListAuthor: commentListReplaceableKey.authorPubkey,
            dTag: commentListReplaceableKey.dTag,
            message,
            signatureString: signature.signature,
            signatureIdentity: signature.identity,
            signatureSignType: signature.signType,
          }),
        });

        if (!response.ok) {
          const error = await response
            .json()
            .catch(() => ({ error: "Failed to delete comment" }));
          throw new Error(
            error.message || error.error || "Failed to delete comment"
          );
        }

        const result = await response.json();
        log.info("Successfully deleted comment", {
          commentNeventId,
          commentListAuthor: commentListReplaceableKey.authorPubkey,
          dTag: commentListReplaceableKey.dTag,
        });

        // Optimistic update - remove comment from state
        setComments((prev) =>
          prev.filter((c) => c.neventId !== commentNeventId)
        );
        setTipComments((prev) =>
          prev.filter((c) => c.neventId !== commentNeventId)
        );
        setTotalComments((prev) => Math.max(0, prev - 1));

        return result;
      } catch (err) {
        log.error("Failed to delete comment", err);
        throw err;
      } finally {
        setIsPosting(false);
      }
    },
    [isAdmin, tippingTypeId, signer, commentListReplaceableKey]
  );

  const blacklistSender = useCallback(
    async (senderAddress: string) => {
      if (!isAdmin) {
        throw new Error("Admin privileges required to blacklist senders");
      }
      if (!tippingTypeId) {
        throw new Error("Missing tipping type ID");
      }
      if (!signer) {
        throw new Error("Signer required");
      }
      if (!commentListReplaceableKey) {
        throw new Error("Missing comments list replaceable key");
      }

      setIsPosting(true);
      try {
        // Create message to sign
        const message = JSON.stringify({
          action: "blacklist",
          targetSenderAddress: senderAddress,
          timestamp: Date.now(),
        });

        // Sign the message
        const signature = await signer.signMessage(message);

        const response = await fetch("/api/update-tipping-comments", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "blacklist",
            commentListAuthor: commentListReplaceableKey.authorPubkey,
            dTag: commentListReplaceableKey.dTag,
            message,
            signatureString: signature.signature,
            signatureIdentity: signature.identity,
            signatureSignType: signature.signType,
            targetSenderAddress: senderAddress,
          }),
        });

        if (!response.ok) {
          const error = await response
            .json()
            .catch(() => ({ error: "Failed to blacklist sender" }));
          throw new Error(
            error.message || error.error || "Failed to blacklist sender"
          );
        }

        const result = await response.json();
        log.info("Successfully blacklisted sender", {
          senderAddress,
          commentListAuthor: commentListReplaceableKey.authorPubkey,
          dTag: commentListReplaceableKey.dTag,
        });

        // Reload comments to reflect blacklist changes
        reload();

        return result;
      } catch (err) {
        log.error("Failed to blacklist sender", err);
        throw err;
      } finally {
        setIsPosting(false);
      }
    },
    [isAdmin, tippingTypeId, signer, reload, commentListReplaceableKey]
  );

  return {
    comments,
    tipComments,
    visibleTipComments,
    hasMoreTipComments,
    likesCount,
    isLiked,
    isLoading,
    isPosting,
    error,
    postComment,
    postLike,
    deleteComment,
    blacklistSender,
    reload,
    loadMore,
    hasMore,
    totalComments,
    totalTipAmountCkb,
    loadMoreTipComments,
  };
}
