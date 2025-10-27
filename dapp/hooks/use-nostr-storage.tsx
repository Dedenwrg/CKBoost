"use client";

import { useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNostr, DEFAULT_NOSTR_RELAYS } from "@/lib/providers/nostr-provider";
import { NSecSigner, type NPool } from "@nostrify/nostrify";
import { NostrEvent } from "@nostrify/types";
import {
  nip19,
  generateSecretKey,
  getPublicKey,
  getEventHash,
} from "nostr-tools";
import { createScopedLogger } from "ssri-ckboost";

const log = createScopedLogger("useNostrStorage");

// Custom kind for CKBoost quest submissions
const CKBOOST_SUBMISSION_KIND = 30078;

const RELAY_TIMEOUT_MS = 5000;
const VERIFICATION_DELAY_MS = 1000;
const MAX_VERIFICATION_ROUNDS = 3;

type PublishResult = {
  confirmedRelay: string;
  attemptedRelays: string[];
};

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const uniqueRelays = (relays: string[]): string[] => [...new Set(relays)];

const getRelayPriority = (nostr?: NPool): string[] => {
  if (!nostr) {
    return [...DEFAULT_NOSTR_RELAYS];
  }

  const activeRelays = Array.from(nostr.relays.keys());
  if (!activeRelays.length) {
    return [...DEFAULT_NOSTR_RELAYS];
  }

  return uniqueRelays([...activeRelays, ...DEFAULT_NOSTR_RELAYS]);
};

const publishEventWithFallback = async (
  nostr: NPool,
  event: NostrEvent,
  relays: string[],
  timeoutMs: number
): Promise<PublishResult> => {
  const attemptedRelays: string[] = [];

  for (const relayUrl of relays) {
    attemptedRelays.push(relayUrl);
    log.info(`Attempting to publish via ${relayUrl}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      await nostr.event(event, {
        relays: [relayUrl],
        signal: controller.signal,
      });
      log.info(`Relay ${relayUrl} accepted the event.`);
      return {
        confirmedRelay: relayUrl,
        attemptedRelays: [...attemptedRelays],
      };
    } catch (error) {
      if (controller.signal.aborted) {
        log.warn(`Publish timeout on ${relayUrl} after ${timeoutMs}ms.`);
      } else {
        log.warn(`Publish failed on ${relayUrl}:`, error);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(
    "Failed to publish event to any configured Nostr relay. Please try again later."
  );
};

const verifyEventWithFallback = async (
  nostr: NPool,
  eventId: string,
  relays: string[],
  timeoutMs: number,
  maxAttempts: number
): Promise<number> => {
  const relayOrder = uniqueRelays(relays);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    for (const relayUrl of relayOrder) {
      log.info(
        `Verification attempt ${attempt}/${maxAttempts} via ${relayUrl}`
      );
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const events = await nostr.query(
          [
            {
              ids: [eventId],
              kinds: [CKBOOST_SUBMISSION_KIND],
            },
          ],
          { relays: [relayUrl], signal: controller.signal }
        );

        if (events.length > 0) {
          log.info(
            `✅ Event verified on ${relayUrl}! Found ${events.length} copy/copies`
          );
          return events.length;
        }

        log.info(`Relay ${relayUrl} reported 0 copies for this event.`);
      } catch (error) {
        if (controller.signal.aborted) {
          log.warn(
            `Verification on ${relayUrl} timed out after ${timeoutMs}ms.`
          );
        } else {
          log.error(`Verification error on ${relayUrl}:`, error);
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    if (attempt < maxAttempts) {
      log.info(
        `Waiting ${VERIFICATION_DELAY_MS}ms before retrying verification...`
      );
      await delay(VERIFICATION_DELAY_MS);
    }
  }

  return 0;
};

const publishAndVerifyEvent = async (
  nostr: NPool,
  event: NostrEvent,
  failureMessage: string
): Promise<string[]> => {
  const relayPriority = getRelayPriority(nostr);
  log.info("Relay priority list:", relayPriority.join(", "));

  const publishResult = await publishEventWithFallback(
    nostr,
    event,
    relayPriority,
    RELAY_TIMEOUT_MS
  );
  log.info("Event sent to relays");
  log.info(`Confirmed relay: ${publishResult.confirmedRelay}`);
  if (publishResult.attemptedRelays.length > 1) {
    log.info(`Publish attempts: ${publishResult.attemptedRelays.join(", ")}`);
  }

  log.info("Verifying event storage...");
  const verificationRelays = uniqueRelays([
    publishResult.confirmedRelay,
    ...relayPriority,
  ]);
  log.info("Verification relay order:", verificationRelays.join(", "));

  const copies = await verifyEventWithFallback(
    nostr,
    event.id,
    verificationRelays,
    RELAY_TIMEOUT_MS,
    MAX_VERIFICATION_ROUNDS
  );

  if (copies > 0) {
    log.info("Event stored successfully with ID:", event.id);
    return verificationRelays;
  }

  throw new Error(failureMessage);
};

/**
 * React hook for Nostr storage operations using @nostrify/react
 * Provides methods to store and retrieve quest submissions on Nostr
 */
export function useNostrStorage() {
  const { nostr } = useNostr();

  /**
   * Store submission on Nostr
   */
  const storeSubmission = useMutation({
    mutationFn: async (submission: {
      campaignTypeId: string;
      questId: number;
      userAddress: string;
      content: string;
      timestamp?: number;
    }) => {
      if (!nostr) {
        throw new Error("Nostr not initialized");
      }

      // Generate ephemeral key for anonymous submission
      const secretKey = generateSecretKey();
      const pubkey = getPublicKey(secretKey);

      // Create the event
      const event: NostrEvent = {
        kind: CKBOOST_SUBMISSION_KIND,
        content: submission.content,
        tags: [
          [
            "d",
            `ckboost-submission-${submission.campaignTypeId}-${submission.questId}`,
          ],
          ["campaign", submission.campaignTypeId],
          ["quest", submission.questId.toString()],
          ["user", submission.userAddress],
          ["client", "ckboost-dapp"],
          ["timestamp", (submission.timestamp || Date.now()).toString()],
        ],
        created_at: Math.floor(Date.now() / 1000),
        pubkey,
        id: "",
        sig: "",
      };

      // Generate event hash - nostr-tools expects a slightly different type
      event.id = getEventHash(event as Parameters<typeof getEventHash>[0]);

      // Sign the event
      const signer = new NSecSigner(secretKey);
      const signedEvent = await signer.signEvent(event);

      // Publish event to relays
      log.info("Publishing event to Nostr relays...");
      log.info("Event ID:", signedEvent.id);
      log.info("Event kind:", signedEvent.kind);

      const verificationRelays = await publishAndVerifyEvent(
        nostr,
        signedEvent,
        "Failed to verify event storage on Nostr. The submission was published but could not be retrieved. Please try again."
      );

      // Return nevent ID for storage on-chain with updated reliable relays
      const recommendedRelays = verificationRelays.length
        ? verificationRelays.slice(0, 3)
        : DEFAULT_NOSTR_RELAYS.slice(0, 3);
      log.info("Recommended relays for nevent:", recommendedRelays.join(", "));

      const neventId = nip19.neventEncode({
        id: signedEvent.id,
        relays: recommendedRelays,
      });

      log.info(`Published and verified submission on Nostr: ${neventId}`);

      return neventId;
    },
  });

  /**
   * Store campaign content on Nostr with verification
   */
  const storeCampaignContent = useMutation({
    mutationFn: async (payload: {
      campaignTypeId: string;
      contentType: "cover_image" | "long_description";
      content: string;
      metadata?: Record<string, string>;
    }) => {
      if (!nostr) {
        throw new Error("Nostr not initialized");
      }

      const secretKey = generateSecretKey();
      const pubkey = getPublicKey(secretKey);
      const timestamp = Date.now();

      const tags: string[][] = [
        [
          "d",
          `ckboost-campaign-${payload.campaignTypeId}-${payload.contentType}-${timestamp}`,
        ],
        ["campaign", payload.campaignTypeId],
        ["type", payload.contentType],
        ["client", "ckboost-dapp"],
        ["timestamp", timestamp.toString()],
      ];

      if (payload.metadata) {
        for (const [key, value] of Object.entries(payload.metadata)) {
          tags.push([`meta-${key}`, value]);
        }
      }

      const event: NostrEvent = {
        kind: CKBOOST_SUBMISSION_KIND,
        content: payload.content,
        tags,
        created_at: Math.floor(Date.now() / 1000),
        pubkey,
        id: "",
        sig: "",
      };

      event.id = getEventHash(event as Parameters<typeof getEventHash>[0]);

      const signer = new NSecSigner(secretKey);
      const signedEvent = await signer.signEvent(event);

      log.info("Publishing event to Nostr relays...");
      log.info("Event ID:", signedEvent.id);
      log.info("Event kind:", signedEvent.kind);

      const verificationRelays = await publishAndVerifyEvent(
        nostr,
        signedEvent,
        "Failed to verify Nostr storage for campaign content. Please try again."
      );

      const recommendedRelays = verificationRelays.length
        ? verificationRelays.slice(0, 3)
        : DEFAULT_NOSTR_RELAYS.slice(0, 3);
      log.info("Recommended relays for nevent:", recommendedRelays.join(", "));

      return nip19.neventEncode({
        id: signedEvent.id,
        relays: recommendedRelays,
      });
    },
  });

  const storeAchievementMetadata = useMutation({
    mutationFn: async (payload: {
      achievementId: string;
      title: string;
      content: string;
      metadata?: Record<string, string>;
    }) => {
      if (!nostr) {
        throw new Error("Nostr not initialized");
      }

      const secretKey = generateSecretKey();
      const pubkey = getPublicKey(secretKey);
      const timestamp = Date.now();

      const tags: string[][] = [
        ["d", `ckboost-achievement-${payload.achievementId}-${timestamp}`],
        ["achievement_id", payload.achievementId],
        ["title", payload.title],
        ["type", "achievement_metadata"],
        ["client", "ckboost-dapp"],
        ["timestamp", timestamp.toString()],
      ];

      if (payload.metadata) {
        for (const [key, value] of Object.entries(payload.metadata)) {
          tags.push([`meta-${key}`, value]);
        }
      }

      const event: NostrEvent = {
        kind: CKBOOST_SUBMISSION_KIND,
        content: payload.content,
        tags,
        created_at: Math.floor(Date.now() / 1000),
        pubkey,
        id: "",
        sig: "",
      };

      event.id = getEventHash(event as Parameters<typeof getEventHash>[0]);

      const signer = new NSecSigner(secretKey);
      const signedEvent = await signer.signEvent(event);

      const verificationRelays = await publishAndVerifyEvent(
        nostr,
        signedEvent,
        "Failed to verify Nostr storage for achievement metadata. Please try again."
      );

      const recommendedRelays = verificationRelays.length
        ? verificationRelays.slice(0, 3)
        : DEFAULT_NOSTR_RELAYS.slice(0, 3);

      return nip19.neventEncode({
        id: signedEvent.id,
        relays: recommendedRelays,
      });
    },
  });

  /**
   * Retrieve submission from Nostr
   */
  const retrieveSubmission = useCallback(
    async (neventId: string) => {
      if (!nostr) {
        throw new Error("Nostr not initialized");
      }

      // Decode nevent to get event ID
      const decoded = nip19.decode(neventId);
      if (decoded.type !== "nevent") {
        throw new Error("Invalid nevent ID");
      }

      // Query for the event
      const events = await nostr.query([
        {
          ids: [decoded.data.id],
          kinds: [CKBOOST_SUBMISSION_KIND],
        },
      ]);

      if (events.length === 0) {
        throw new Error("Submission not found on Nostr");
      }

      const event = events[0];

      // Extract metadata from tags
      const metadata: Record<string, string> = {};
      for (const tag of event.tags) {
        if (tag.length >= 2) {
          metadata[tag[0]] = tag[1];
        }
      }

      return {
        content: event.content,
        metadata,
        event,
      };
    },
    [nostr]
  );

  /**
   * Check if submission exists
   */
  const checkSubmissionExists = useCallback(
    async (neventId: string): Promise<boolean> => {
      try {
        await retrieveSubmission(neventId);
        return true;
      } catch {
        return false;
      }
    },
    [retrieveSubmission]
  );

  /**
   * Use React Query to fetch submission with caching
   */
  const useSubmission = (neventId: string | undefined) => {
    return useQuery({
      queryKey: ["nostr-submission", neventId],
      queryFn: () => retrieveSubmission(neventId!),
      enabled: !!neventId && !!nostr,
      staleTime: 5 * 60 * 1000, // Consider data stale after 5 minutes
      gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
      retry: 3,
    });
  };

  /**
   * Batch retrieve multiple submissions
   */
  const retrieveMultipleSubmissions = useCallback(
    async (neventIds: string[]) => {
      if (!nostr) {
        throw new Error("Nostr not initialized");
      }

      // Decode all nevent IDs to get event IDs
      const eventIds: string[] = [];

      for (const neventId of neventIds) {
        try {
          const decoded = nip19.decode(neventId);
          if (decoded.type === "nevent") {
            eventIds.push(decoded.data.id);
          }
        } catch (error) {
          log.warn(`Invalid nevent ID: ${neventId}`, error);
        }
      }

      if (eventIds.length === 0) {
        return [];
      }

      // Query all events at once
      const events = await nostr.query([
        {
          ids: eventIds,
          kinds: [CKBOOST_SUBMISSION_KIND],
        },
      ]);

      // Map events back to results
      return neventIds.map((neventId) => {
        try {
          const decoded = nip19.decode(neventId);
          if (decoded.type !== "nevent") return null;

          const event = events.find(
            (e: NostrEvent) => e.id === decoded.data.id
          );

          if (!event) return null;

          const metadata: Record<string, string> = {};
          for (const tag of event.tags) {
            if (tag.length >= 2) {
              metadata[tag[0]] = tag[1];
            }
          }

          return {
            neventId,
            content: event.content,
            metadata,
            event,
          };
        } catch {
          return null;
        }
      });
    },
    [nostr]
  );

  return {
    isConnected: !!nostr,
    storeSubmission,
    storeCampaignContent,
    storeAchievementMetadata,
    retrieveSubmission,
    checkSubmissionExists,
    useSubmission,
    retrieveMultipleSubmissions,
  };
}

/**
 * Hook to check if content is a Nostr reference
 */
export function useIsNostrReference() {
  return useCallback((content: string): boolean => {
    return content.startsWith("nevent1");
  }, []);
}
