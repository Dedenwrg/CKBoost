import { NSecSigner, type NPool } from "@nostrify/nostrify";
import { NostrEvent } from "@nostrify/types";
import {
  nip19,
  generateSecretKey,
  getPublicKey,
  getEventHash,
} from "nostr-tools";
import { createLogger } from "./log";
import {
  CKBOOST_SUBMISSION_KIND,
  DEFAULT_NOSTR_RELAYS,
  MAX_VERIFICATION_ROUNDS,
  RELAY_TIMEOUT_MS,
  VERIFICATION_DELAY_MS,
} from "../configs/nostr";

const log = createLogger("NetlifyNostr");

type PublishResult = {
  confirmedRelay: string;
  attemptedRelays: string[];
};

const uniqueRelays = (relays: string[]): string[] => [...new Set(relays)];

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  const neventId = nip19.neventEncode({ id: event.id, relays: relays });
  log.info("Publishing neventId:", neventId);

  for (const relayUrl of relays) {
    attemptedRelays.push(relayUrl);
    log.info(`Attempting to publish via ${relayUrl}`);
    log.info("Event tags:", event.tags);
    log.info("Event content:", event.content);
    log.info("Event id:", event.id);
    log.info("Event pubkey:", event.pubkey);
    log.info("Event sig:", event.sig);
    log.info("Event created_at:", event.created_at);
    log.info("Event kind:", event.kind);
    log.info("Event content:", event.content);
    log.info("Event id:", event.id);
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

export const publishAndVerifyEvent = async (
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
    log.info(
      "Nevent ID:",
      nip19.neventEncode({ id: event.id, relays: verificationRelays })
    );
    return verificationRelays;
  }

  throw new Error(failureMessage);
};

export async function fetchReplaceableEvent(
  nostr: NPool,
  author: string,
  dTag: string
): Promise<NostrEvent | null> {
  const relayOrder = uniqueRelays(DEFAULT_NOSTR_RELAYS);

  for (let attempt = 1; attempt <= MAX_VERIFICATION_ROUNDS; attempt++) {
    log.info(
      `Fetching event attempt ${attempt}/${MAX_VERIFICATION_ROUNDS} via ${relayOrder.length} relay(s)`
    );

    const result = await Promise.race(
      relayOrder.map(async (relayUrl) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), RELAY_TIMEOUT_MS);

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

    if (attempt < MAX_VERIFICATION_ROUNDS) {
      log.info(
        `Waiting ${VERIFICATION_DELAY_MS}ms before retrying fetching event...`
      );
      await delay(VERIFICATION_DELAY_MS);
    }
  }

  return null;
}
