import { useState, useEffect } from "react";
import { createScopedLogger } from "ssri-ckboost";
import { nip19 } from "nostr-tools";
import { useNostrStorage } from "./use-nostr-storage";
import { CommentListReplaceableKey } from "./use-tipping-comments";
import { useNostrFetch } from "./use-nostr-fetch";

const log = createScopedLogger("useSocialInteractions");

export interface SocialInteractions {
  commentsCount: number;
  likesCount: number;
  totalTipAmount: string;
}

type SocialInput = { id: string; targetEventId?: string | null };

export function useSocialInteractions(inputs: SocialInput[]) {
  const { fetchEventById } = useNostrStorage();
  const { fetchReplaceableEvent } = useNostrFetch();
  const [stats, setStats] = useState<Record<string, SocialInteractions>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idsKey = JSON.stringify(inputs);

  useEffect(() => {
    if (!inputs.length) return;

    const fetchStats = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const results = await Promise.all(
          inputs.map(async ({ id, targetEventId }) => {
            try {
              if (!id || !targetEventId) return null;
              console.log(
                "Attempting to fetch long description event",
                targetEventId
              );
              const longDescEvent = await fetchEventById(targetEventId);
              console.log("longDescEvent", longDescEvent);
              if (!longDescEvent?.content) return null;

              let commentListReplaceableKey:
                | CommentListReplaceableKey
                | undefined = undefined;
              try {
                const parsed = JSON.parse(longDescEvent.content);
                commentListReplaceableKey =
                  parsed.commentListReplaceableKey || undefined;
              } catch {
                commentListReplaceableKey = undefined;
              }

              if (!commentListReplaceableKey) {
                return {
                  id,
                  data: {
                    commentsCount: 0,
                    likesCount: 0,
                    totalTipAmount: "0",
                  },
                };
              }

              const commentListEvent = await fetchReplaceableEvent(
                commentListReplaceableKey.authorPubkey,
                commentListReplaceableKey.dTag
              );
              if (!commentListEvent?.content) {
                return {
                  id,
                  data: {
                    commentsCount: 0,
                    likesCount: 0,
                    totalTipAmount: "0",
                  },
                };
              }

              let commentNeventIds: string[] = [];
              try {
                const parsed = JSON.parse(commentListEvent.content);
                commentNeventIds = parsed.commentNeventIds || [];
              } catch {
                commentNeventIds = [];
              }

              // Fetch comment events
              const commentEvents = await Promise.all(
                commentNeventIds.map(async (neventId) => {
                  try {
                    const dec = nip19.decode(neventId);
                    if (dec.type === "nevent") {
                      return await fetchEventById(dec.data.id);
                    }
                  } catch {
                    return null;
                  }
                  return null;
                })
              );

              let commentsCount = 0;
              let tipCommentsCount = 0;
              let totalTipAmount = BigInt(0);

              for (const evt of commentEvents) {
                if (!evt) continue;
                try {
                  const payload = JSON.parse(evt.content);
                  if (payload.type === "tipping_comment") {
                    commentsCount += 1;
                    if (payload.isTip) {
                      tipCommentsCount += 1;
                      if (payload.amount) {
                        try {
                          totalTipAmount += BigInt(payload.amount);
                        } catch {
                          // ignore parse errors
                        }
                      }
                    }
                  }
                } catch {
                  // ignore
                }
              }

              return {
                id,
                data: {
                  commentsCount: commentsCount + tipCommentsCount,
                  likesCount: 0,
                  totalTipAmount: totalTipAmount.toString(),
                },
              };
            } catch (e) {
              log.error("Failed to fetch stats from nostr", e);
              return null;
            }
          })
        );

        const next: Record<string, SocialInteractions> = {};
        results.forEach((item) => {
          if (item) next[item.id] = item.data;
        });
        setStats(next);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to fetch social interactions";
        log.error(message, err);
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchStats();
  }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return { stats, isLoading, error };
}
