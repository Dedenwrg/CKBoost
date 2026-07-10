import type { NPool } from "@nostrify/nostrify";
import type { NostrEvent } from "@nostrify/types";
import { createLogger } from "./log";
import {
  getConfiguredNostrRelays,
  MAX_VERIFICATION_ROUNDS,
  RELAY_TIMEOUT_MS,
  VERIFICATION_DELAY_MS,
} from "../configs/nostr";
import {
  DEFAULT_RELAY_QUORUM,
  isValidCkboostEvent,
  publishEventWithQuorum,
} from "../../lib/nostr/relay-core";

const log = createLogger("NetlifyNostr");
const unique = (values: string[]) => [...new Set(values)];
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export const publishAndVerifyEvent = async (
  nostr: NPool,
  event: NostrEvent,
  failureMessage: string
): Promise<string[]> => {
  try {
    const result = await publishEventWithQuorum({
      nostr,
      event,
      relays: unique(getConfiguredNostrRelays()),
      requiredCopies: DEFAULT_RELAY_QUORUM,
      timeoutMs: Math.min(RELAY_TIMEOUT_MS, 5_000),
      verificationRounds: 2,
    });
    log.info("Published and verified Nostr event", {
      eventId: event.id,
      verifiedRelayCount: result.verifiedRelays.length,
      attempts: result.attempts.map((attempt) => ({
        relay: attempt.relay,
        publish: attempt.publish,
        verification: attempt.verification,
        elapsedMs: attempt.elapsedMs,
      })),
    });
    return result.verifiedRelays;
  } catch (error) {
    log.error("Nostr relay quorum failed", {
      eventId: event.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(failureMessage, { cause: error });
  }
};

const fetchReplaceableFromRelay = async (
  nostr: NPool,
  relay: string,
  author: string,
  dTag: string
): Promise<NostrEvent | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.min(RELAY_TIMEOUT_MS, 5_000)
  );
  try {
    const events = await nostr.query(
      [{ authors: [author], "#d": [dTag], kinds: [30078] }],
      { relays: [relay], signal: controller.signal }
    );
    return (
      events
        .filter(
          (event) =>
            event.pubkey === author &&
            event.tags.some((tag) => tag[0] === "d" && tag[1] === dTag) &&
            isValidCkboostEvent(event, event.id, 30078)
        )
        .sort((a, b) => b.created_at - a.created_at)[0] || null
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

export async function fetchReplaceableEvent(
  nostr: NPool,
  author: string,
  dTag: string
): Promise<NostrEvent | null> {
  const relays = unique(getConfiguredNostrRelays());
  for (let round = 1; round <= MAX_VERIFICATION_ROUNDS; round++) {
    const winner = await Promise.any(
      relays.map(async (relay) => {
        const event = await fetchReplaceableFromRelay(
          nostr,
          relay,
          author,
          dTag
        );
        if (!event) throw new Error("Event not found on relay");
        return event;
      })
    ).catch(() => null);
    if (winner) return winner;
    if (round < MAX_VERIFICATION_ROUNDS) {
      await delay(Math.min(VERIFICATION_DELAY_MS, 1_000));
    }
  }
  return null;
}
