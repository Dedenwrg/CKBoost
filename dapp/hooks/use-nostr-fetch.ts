"use client";

import { useState, useCallback } from "react";
import { DEFAULT_NOSTR_RELAYS, useNostr } from "@/lib/providers/nostr-provider";
import { NostrEvent, NostrFilter } from "@nostrify/types";
import { nip19 } from "nostr-tools";
import { createScopedLogger } from "ssri-ckboost";
import { Comment } from "@/components/social-interactions";
import { NPool } from "@nostrify/nostrify";
const log = createScopedLogger("useNostrFetch");

// Custom kind for CKBoost quest submissions
const CKBOOST_SUBMISSION_KIND = 30078;
const MAX_FETCH_ROUNDS = 3;
const FETCH_DELAY_MS = 10000;
const RELAY_TIMEOUT_MS = 50000;

export interface ParsedSubmission {
  campaignTypeId: string;
  questId: number;
  userAddress: string;
  content: string;
  timestamp: number;
  eventId: string;
  author: string;
  relays: string[];
  created_at: number;
  metadata: Record<string, string>;
  event?: NostrEvent;
}

interface FetchFilterOptions {
  relays?: string[];
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type NostrComment = {
  neventId: string;
  senderAddress: string;
};

export function useNostrFetch() {
  const { nostr } = useNostr();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parseNeventId = (
    neventId: string
  ): { id: string; relays?: string[] } | null => {
    try {
      const decoded = nip19.decode(neventId);
      if (decoded.type === "nevent") {
        return {
          id: decoded.data.id,
          relays: decoded.data.relays,
        };
      }
      return null;
    } catch (error) {
      log.error("Failed to decode nevent:", error);
      return null;
    }
  };

  const extractMetadata = (event: NostrEvent): Record<string, string> => {
    const metadata: Record<string, string> = {};
    for (const tag of event.tags) {
      if (tag.length >= 2) {
        metadata[tag[0]] = tag[1];
      }
    }
    return metadata;
  };

  const fetchEventsByFilter = useCallback(
    async (
      filter: NostrFilter,
      options: FetchFilterOptions = {}
    ): Promise<NostrEvent[]> => {
      if (!nostr) {
        throw new Error("Nostr pool not initialized");
      }

      const timeoutMs =
        options.timeoutMs === undefined ? 10000 : options.timeoutMs;

      let controller: AbortController | null = null;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      let signal: AbortSignal | undefined = options.signal;

      if (!signal) {
        controller = new AbortController();
        signal = controller.signal;
        if (timeoutMs > 0) {
          timeout = setTimeout(() => controller?.abort(), timeoutMs);
        }
      }

      const streamWithReq = async (): Promise<NostrEvent[]> => {
        log.info("Streaming Nostr events via req", {
          filter,
          relays: options.relays,
        });
        const streamController = new AbortController();
        const streamSignal = streamController.signal;
        let streamTimeout: NodeJS.Timeout | null = null;
        if (timeoutMs > 0) {
          streamTimeout = setTimeout(() => streamController.abort(), timeoutMs);
        }

        const events: NostrEvent[] = [];

        try {
          for await (const msg of nostr.req([filter], {
            relays: options.relays,
            signal: streamSignal,
          })) {
            if (msg[0] === "EVENT" && msg[2]) {
              events.push(msg[2] as NostrEvent);
              if (filter.limit && events.length >= filter.limit) {
                break;
              }
            }
            if (msg[0] === "EOSE") {
              break;
            }
          }
        } catch (streamErr) {
          if (!streamSignal.aborted) {
            log.warn("Streaming fetch failed", streamErr);
          }
        } finally {
          if (streamTimeout) {
            clearTimeout(streamTimeout);
          }
        }

        log.info("Streamed Nostr events", {
          count: events.length,
          filter,
        });

        return events;
      };

      try {
        log.info("Executing Nostr filter", {
          filter,
          relays: options.relays,
          timeoutMs,
        });
        const events = await nostr.query([filter], {
          relays: options.relays,
          signal,
        });
        log.info("Nostr filter returned events", {
          count: events.length,
          filter,
        });

        if (events.length > 0 || filter.limit === 0) {
          return events;
        }

        log.info(
          "Nostr query returned empty result, falling back to streaming",
          {
            filter,
          }
        );
        return await streamWithReq();
      } catch (err) {
        if (signal?.aborted) {
          throw new Error("Nostr filter query aborted or timed out");
        }
        log.warn("Nostr query failed, attempting streaming fallback", err);
        return await streamWithReq();
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }
      }
    },
    [nostr]
  );

  const fetchSubmission = useCallback(
    async (neventId: string): Promise<ParsedSubmission | null> => {
      if (!nostr) {
        setError("Nostr pool not initialized");
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Parse the nevent ID
        const parsed = parseNeventId(neventId);
        if (!parsed) {
          throw new Error("Invalid nevent ID format");
        }

        // Create filter for the specific event
        const filter: NostrFilter = {
          ids: [parsed.id],
          kinds: [CKBOOST_SUBMISSION_KIND],
        };

        // Query the pool for the event
        const events: NostrEvent[] = [];

        // Use the pool to query for events with timeout
        const timeoutPromise = new Promise<void>((_, reject) =>
          setTimeout(
            () => reject(new Error("Request timeout after 10 seconds")),
            10000
          )
        );

        const fetchPromise = (async () => {
          try {
            for await (const msg of nostr.req([filter])) {
              if (msg[0] === "EVENT") {
                const event = msg[2];
                events.push(event);
                break; // We only need one event
              }
              if (msg[0] === "EOSE") {
                break; // End of stored events
              }
            }
          } catch (err) {
            log.error("Error in Nostr query:", err);
            throw err;
          }
        })();

        // Wait for either fetch to complete or timeout
        try {
          await Promise.race([fetchPromise, timeoutPromise]);
        } catch (err) {
          log.error("Failed to fetch from relays:", err);
          // Try without timeout as fallback
          if (err instanceof Error && err.message.includes("timeout")) {
            log.info("Retrying without timeout...");
            // Give it one more try with longer timeout
            await Promise.race([
              fetchPromise,
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Final timeout")), 5000)
              ),
            ]).catch(() => {});
          }
        }

        if (events.length === 0) {
          throw new Error("Event not found on any relay");
        }

        const event = events[0];
        const metadata = extractMetadata(event);

        // Parse the submission data
        let submissionContent;
        try {
          // Check if content is already JSON
          submissionContent = JSON.parse(event.content);
        } catch {
          // If not JSON, use content directly and build from metadata
          submissionContent = {
            campaignTypeId: metadata.campaign || "",
            questId: parseInt(metadata.quest || "0"),
            userAddress: metadata.user || "",
            content: event.content,
            timestamp: parseInt(metadata.timestamp || "0"),
          };
        }

        const submission: ParsedSubmission = {
          campaignTypeId:
            submissionContent.campaignTypeId || metadata.campaign || "",
          questId: submissionContent.questId || parseInt(metadata.quest || "0"),
          userAddress: submissionContent.userAddress || metadata.user || "",
          content: submissionContent.content || event.content,
          timestamp:
            submissionContent.timestamp || parseInt(metadata.timestamp || "0"),
          eventId: event.id,
          author: event.pubkey,
          relays: parsed.relays || [],
          created_at: event.created_at,
          metadata,
          event,
        };

        return submission;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to fetch submission";
        setError(errorMessage);
        log.error("Error fetching submission:", err);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [nostr]
  );

  const fetchEventWithNeventId = useCallback(
    async (neventId: string): Promise<NostrEvent | null> => {
      if (!nostr) {
        setError("Nostr pool not initialized");
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Parse the nevent ID
        const parsed = parseNeventId(neventId);
        if (!parsed) {
          throw new Error("Invalid nevent ID format");
        }

        // Create filter for the specific event
        const filter: NostrFilter = {
          ids: [parsed.id],
          kinds: [CKBOOST_SUBMISSION_KIND],
        };

        // Query the pool for the event
        const events: NostrEvent[] = [];

        // Use the pool to query for events with timeout
        const timeoutPromise = new Promise<void>((_, reject) =>
          setTimeout(
            () => reject(new Error("Request timeout after 10 seconds")),
            10000
          )
        );

        const fetchPromise = (async () => {
          try {
            for await (const msg of nostr.req([filter])) {
              if (msg[0] === "EVENT") {
                const event = msg[2];
                events.push(event);
                break; // We only need one event
              }
              if (msg[0] === "EOSE") {
                break; // End of stored events
              }
            }
          } catch (err) {
            log.error("Error in Nostr query:", err);
            throw err;
          }
        })();

        // Wait for either fetch to complete or timeout
        try {
          await Promise.race([fetchPromise, timeoutPromise]);
        } catch (err) {
          log.error("Failed to fetch from relays:", err);
          // Try without timeout as fallback
          if (err instanceof Error && err.message.includes("timeout")) {
            log.info("Retrying without timeout...");
            // Give it one more try with longer timeout
            await Promise.race([
              fetchPromise,
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Final timeout")), 5000)
              ),
            ]).catch(() => {});
          }
        }

        if (events.length === 0) {
          throw new Error("Event not found on any relay");
        }

        const event = events[0];

        return event;
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : "Failed to fetch event with neventId";
        setError(errorMessage);
        log.error("Error fetching event with neventId:", err);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [nostr]
  );

  const fetchCommentsWithNostrCommentList = useCallback(
    async (nostrCommentList: NostrComment[]): Promise<Comment[] | null> => {
      if (!nostr) {
        setError("Nostr pool not initialized");
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        const comments = await Promise.all(
          nostrCommentList.map(async (nostrComment) => {
            const commentEvent = await fetchEventWithNeventId(
              nostrComment.neventId
            );
            if (!commentEvent) {
              throw new Error("Comment not found");
            }
            const comment: Comment = {
              neventId: nostrComment.neventId,
              eventId: commentEvent.id,
              author: nostrComment.senderAddress,
              content: commentEvent.content,
              timestamp: commentEvent.created_at.toString(),
              likes: 0,
              isLiked: false,
              link: `https://njump.me/${nostrComment.neventId}`,
              isTip: false,
              tipAmount: "0",
              tipTxHash: "",
            };

            return comment;
          })
        );

        return comments;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to fetch submission";
        setError(errorMessage);
        log.error("Error fetching submission:", err);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [nostr]
  );

  const uniqueRelays = (relays: string[]): string[] => [...new Set(relays)];
  const delay = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  async function fetchReplaceableEvent(
    author: string,
    dTag: string
  ): Promise<NostrEvent | null> {
    const relayOrder = uniqueRelays(DEFAULT_NOSTR_RELAYS);

    for (let attempt = 1; attempt <= MAX_FETCH_ROUNDS; attempt++) {
      log.info(
        `Fetching event attempt ${attempt}/${MAX_FETCH_ROUNDS} via ${relayOrder.length} relay(s)`
      );

      const result = await Promise.race(
        relayOrder.map(async (relayUrl) => {
          const controller = new AbortController();
          const timeout = setTimeout(
            () => controller.abort(),
            RELAY_TIMEOUT_MS
          );

          try {
            log.info(`Querying relay ${relayUrl}`);
            const events = await nostr.query(
              [
                {
                  authors: [author],
                  "#d": [dTag],
                  kinds: [CKBOOST_SUBMISSION_KIND],
                },
              ],
              { relays: [relayUrl], signal: controller.signal }
            );

            if (events.length > 0) {
              log.info(
                `✅ Event found on ${relayUrl}! Found ${events.length} copy/copies`
              );
              return { success: true, event: events[0], relayUrl };
            }

            log.info(`Relay ${relayUrl} reported 0 copies for this event.`);
            return { success: false, event: null, relayUrl };
          } catch (error) {
            if (controller.signal.aborted) {
              log.warn(
                `Fetching event on ${relayUrl} timed out after ${RELAY_TIMEOUT_MS}ms.`
              );
            } else {
              log.error(`Fetching event error on ${relayUrl}:`, error);
            }
            return { success: false, event: null, relayUrl };
          } finally {
            clearTimeout(timeout);
          }
        })
      );

      if (result?.success && result?.event) {
        return result.event;
      }

      if (attempt < MAX_FETCH_ROUNDS) {
        log.info(
          `Waiting ${FETCH_DELAY_MS}ms before retrying fetching event...`
        );
        await delay(FETCH_DELAY_MS);
      }
    }

    return null;
  }

  return {
    fetchSubmission,
    fetchEventsByFilter,
    fetchCommentsWithNostrCommentList,
    fetchEventWithNeventId,
    fetchReplaceableEvent,
    isLoading,
    error,
  };
}
