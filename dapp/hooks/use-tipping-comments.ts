import { useCallback, useEffect, useMemo, useState } from "react";
import { nip19 } from "nostr-tools";
import { useNostrFetch } from "@/hooks/use-nostr-fetch";
import { useNostrStorage } from "@/hooks/use-nostr-storage";
import { useUser } from "@/lib/providers/user-provider";
import { getLatestDisplayName } from "@/lib/profile/profile-data";
import { createScopedLogger } from "ssri-ckboost";
import { NostrEvent } from "@nostrify/types";
import { Comment } from "@/components/social-interactions";

const log = createScopedLogger("useTippingComments");

interface TippingCommentPayload {
  type: "tipping_comment";
  version: number;
  commentId: string;
  tippingTypeId: string;
  text: string;
  authorLockHash?: string;
  authorTypeId?: string | null;
  displayName?: string;
  createdAt: number;
  neventId?: string;
  eventUrl?: string;
}

const COMMENT_TAG_TYPE = "tipping_comment";
const CKBOOST_SUBMISSION_KIND = 30078;
const COMMENT_FETCH_LIMIT = 200;

const createCommentId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `comment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const shortenHash = (hash?: string | null) => {
  if (!hash) return "Unknown";
  const normalized = hash.startsWith("0x") ? hash.slice(2) : hash;
  return normalized.length <= 12
    ? normalized
    : `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
};

const formatTimestamp = (timestamp: number) =>
  new Date(timestamp).toLocaleString();

const buildNjumpUrlFromEvent = (
  event: NostrEvent,
  payload?: TippingCommentPayload
): string | undefined => {
  if (payload?.eventUrl) {
    return payload.eventUrl;
  }
  if (payload?.neventId) {
    return `https://njump.me/${payload.neventId}`;
  }
  try {
    const note = nip19.noteEncode(event.id);
    return `https://njump.me/${note}`;
  } catch {
    return undefined;
  }
};

const eventHasTag = (
  event: NostrEvent,
  tagName: string,
  expected?: string
) => {
  return event.tags.some((tag) => {
    if (!tag.length) return false;
    if (tag[0] !== tagName) return false;
    if (expected === undefined) return true;
    return tag[1] === expected;
  });
};

export function useTippingComments(tippingTypeId?: string) {
  const { fetchAuthorIndexedEvents } = useNostrFetch();
  const { storeAuthorIndexedEvent } = useNostrStorage();
  const {
    currentUserData,
    currentUserTypeId,
    userRecommendedAddressObj,
  } = useUser();

  const [comments, setComments] = useState<Comment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    () => getLatestDisplayName(currentUserData?.profile_data) ?? shortenHash(currentLockHash),
    [currentUserData?.profile_data, currentLockHash]
  );

  const hydrateComments = useCallback(
    (events: NostrEvent[]) => {
      log.info("Hydrating comment events", { count: events.length });
    const parsed = events
      .map((event) => {
        try {
          if (!eventHasTag(event, "type", COMMENT_TAG_TYPE)) {
            log.info("Skipping event without comment type tag", {
              eventId: event.id,
            });
            return null;
          }

          if (
            tippingTypeId &&
            !eventHasTag(event, "tipping", tippingTypeId)
          ) {
            log.info("Skipping event without matching tipping tag", {
              eventId: event.id,
              expected: tippingTypeId,
            });
            return null;
          }

          const payload = JSON.parse(event.content) as TippingCommentPayload;
          if (payload.type !== COMMENT_TAG_TYPE) {
            return null;
          }
          const createdAt = payload.createdAt || event.created_at * 1000;
          const comment: Comment = {
            id: payload.commentId || event.id,
            author: payload.displayName || shortenHash(payload.authorLockHash),
            content: payload.text,
            timestamp: formatTimestamp(createdAt),
            likes: 0,
            isLiked: false,
            link: buildNjumpUrlFromEvent(event, payload),
          };
          return { createdAt, comment };
        } catch (parseError) {
          log.warn("Failed to parse tipping comment event", parseError);
          return null;
        }
      })
      .filter(
        (entry): entry is { createdAt: number; comment: Comment } =>
          Boolean(entry)
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((entry) => entry.comment);

    log.info("Parsed tipping comments", { count: parsed.length });
    parsed.forEach((comment, index) => {
      log.info("Parsed comment", {
        index,
        id: comment.id,
        author: comment.author,
        link: comment.link,
      });
    });

    setComments(parsed);
    },
    [tippingTypeId]
  );

  const loadComments = useCallback(async () => {
    if (!tippingTypeId) {
      log.info("Skipping comment fetch: missing tippingTypeId");
      setComments([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      log.info("Fetching tipping comments", { tippingTypeId });
      const events = await fetchAuthorIndexedEvents(
        { privateKey: tippingTypeId },
        {
          filter: {
            kinds: [CKBOOST_SUBMISSION_KIND],
            limit: COMMENT_FETCH_LIMIT,
          },
        }
      );
      log.info("Fetched Nostr events", {
        tippingTypeId,
        count: events.length,
      });
      hydrateComments(events);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load comments";
      setError(message);
      log.error("Failed to load tipping comments", {
        error: err instanceof Error ? err.message : String(err),
        tippingTypeId,
      });
    } finally {
      setIsLoading(false);
    }
  }, [fetchAuthorIndexedEvents, hydrateComments, tippingTypeId]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  const postComment = useCallback(
    async (content: string) => {
      if (!tippingTypeId) {
        throw new Error("Missing tipping proposal type ID");
      }

      if (!currentUserTypeId) {
        throw new Error("User profile required before commenting");
      }

      if (!currentLockHash) {
        throw new Error("Unable to determine user lock hash");
      }

      const trimmedContent = content.trim();
      if (!trimmedContent) {
        throw new Error("Comment cannot be empty");
      }

      const createdAt = Date.now();
      const commentId = createCommentId();

      const payload: TippingCommentPayload = {
        type: COMMENT_TAG_TYPE,
        version: 1,
        commentId,
        tippingTypeId,
        text: trimmedContent,
        authorLockHash: currentLockHash,
        authorTypeId: currentUserTypeId,
        displayName: currentDisplayName,
        createdAt,
      };

      const tags: string[][] = [
        ["d", commentId],
        ["type", COMMENT_TAG_TYPE],
        ["tipping", tippingTypeId],
        ["client", "ckboost-dapp"],
        ["timestamp", createdAt.toString()],
        ["user_lock", currentLockHash],
      ];

      if (currentUserTypeId) {
        tags.push(["user_type", currentUserTypeId]);
      }

      const contentString = JSON.stringify(payload);

      setIsPosting(true);
      setError(null);

      try {
        const proposalResult = await storeAuthorIndexedEvent.mutateAsync({
          content: contentString,
          authorIndex: { privateKey: tippingTypeId },
          tags,
        });

        const commentLink = `https://njump.me/${proposalResult.neventId}`;
        console.info("Published tipping comment", {
          neventId: proposalResult.neventId,
          tippingTypeId,
        });
        log.info("Published tipping comment", {
          neventId: proposalResult.neventId,
          tippingTypeId,
        });

        try {
          await storeAuthorIndexedEvent.mutateAsync({
            content: contentString,
            authorIndex: { privateKey: currentLockHash },
            tags,
          });
        } catch (secondaryError) {
          log.warn("Failed to publish user-indexed comment", secondaryError);
        }

        setComments((prev) => [
          {
            id: commentId,
            author: currentDisplayName,
            content: trimmedContent,
            timestamp: formatTimestamp(createdAt),
            likes: 0,
            isLiked: false,
            link: commentLink,
          },
          ...prev,
        ]);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to post comment";
        setError(message);
        log.error("Failed to publish tipping comment", err);
        throw err;
      } finally {
        setIsPosting(false);
      }
    },
    [
      currentDisplayName,
      currentLockHash,
      currentUserTypeId,
      storeAuthorIndexedEvent,
      tippingTypeId,
    ]
  );

  return {
    comments,
    isLoading,
    isPosting,
    error,
    postComment,
    reload: loadComments,
  };
}
