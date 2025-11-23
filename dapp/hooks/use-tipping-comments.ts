import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNostrStorage } from "@/hooks/use-nostr-storage";
import { useUser } from "@/lib/providers/user-provider";
import { getLatestDisplayName } from "@/lib/profile/profile-data";
import { createScopedLogger } from "ssri-ckboost";
import { Comment } from "@/components/social-interactions";

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

type CommentsApiResponse = {
  stats: {
    commentsCount: number;
    likesCount: number;
    totalTipAmount: string;
  };
  comments: Comment[];
  totalComments: number;
  page: number;
  limit: number;
  isLiked?: boolean;
};

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

export function useTippingComments(tippingTypeId?: string) {
  const { storeAuthorIndexedEvent } = useNostrStorage();
  const { currentUserData, currentUserTypeId, userRecommendedAddressObj } =
    useUser();

  const [comments, setComments] = useState<Comment[]>([]);
  const [likesCount, setLikesCount] = useState(0);
  const [isLiked, setIsLiked] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [totalComments, setTotalComments] = useState(0);
  const lastCommentRef = useRef<{ text: string; timestamp: number } | null>(
    null
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

  const fetchComments = useCallback(
    async (pageParam: number, reset: boolean) => {
      if (!tippingTypeId) return;

      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          mode: "details",
          id: tippingTypeId,
          page: String(pageParam),
          limit: "20",
        });
        if (currentLockHash) {
          params.append("userLockHash", currentLockHash);
        }

        const response = await fetch(
          `/api/social-interactions?${params.toString()}`
        );

        if (!response.ok) {
          throw new Error("Failed to fetch comments");
        }

        const data: CommentsApiResponse = await response.json();

        setComments((prev) => {
          const newComments = reset
            ? data.comments
            : [...prev, ...data.comments];
          // Update hasMore based on total count from API
          setHasMore(newComments.length < data.totalComments);
          return newComments;
        });

        setLikesCount(data.stats.likesCount);
        setTotalComments(data.totalComments);
        setIsLiked(Boolean(data.isLiked));

        const nextPage = (data.page || pageParam) + 1;
        setPage(nextPage);
        if (reset) {
          setHasMore(data.comments.length < data.totalComments);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to load comments";
        setError(message);
        log.error("Failed to load tipping comments", err);
      } finally {
        setIsLoading(false);
      }
    },
    [tippingTypeId, currentLockHash]
  );

  const reload = useCallback(() => {
    setComments([]);
    setTotalComments(0);
    setHasMore(true);
    setPage(1);
    fetchComments(1, true);
  }, [fetchComments]);

  const loadMore = useCallback(() => {
    if (!hasMore || isLoading) return;
    fetchComments(page, false);
  }, [fetchComments, hasMore, isLoading, page]);

  useEffect(() => {
    reload();
  }, [reload]);

  const postComment = useCallback(
    async (content: string, tipData?: { txHash: string; amount: string }) => {
      if (!tippingTypeId) throw new Error("Missing tipping proposal type ID");
      if (!currentUserTypeId) throw new Error("User profile required");
      if (!currentLockHash) throw new Error("User lock hash required");

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
        const contentString = JSON.stringify(payload);
        const proposalResult = await storeAuthorIndexedEvent.mutateAsync({
          content: contentString,
          authorIndex: { privateKey: tippingTypeId },
          tags,
        });

        // Optimistic update
        const newComment: Comment = {
          neventId: proposalResult.neventId,
          author: currentDisplayName,
          content: trimmedContent,
          timestamp: formatTimestamp(createdAt),
          likes: 0,
          isLiked: false,
          link: `https://njump.me/${proposalResult.neventId}`,
          isTip: !!tipData,
          tipAmount: tipData?.amount,
          tipTxHash: tipData?.txHash,
        };

        setComments((prev) => [newComment, ...prev]);
        lastCommentRef.current = { text: trimmedContent, timestamp: createdAt };

        // Also try to post to user index (best effort)
        try {
          await storeAuthorIndexedEvent.mutateAsync({
            content: contentString,
            authorIndex: { privateKey: currentLockHash },
            tags,
          });
        } catch (e) {
          log.warn("Failed to post to user index", e);
        }
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
      storeAuthorIndexedEvent,
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
      await storeAuthorIndexedEvent.mutateAsync({
        content: JSON.stringify(payload),
        authorIndex: { privateKey: tippingTypeId },
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
    storeAuthorIndexedEvent,
  ]);

  return {
    comments,
    likesCount,
    isLiked,
    isLoading,
    isPosting,
    error,
    postComment,
    postLike,
    reload,
    loadMore,
    hasMore,
    totalComments,
  };
}
