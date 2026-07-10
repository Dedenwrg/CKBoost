import type { NostrEvent } from "@nostrify/types";
import {
  CKBOOST_EVENT_KIND,
  decodeNevent,
  fetchEventFromRelays,
  mergeRelayLists,
  type NostrRelayClient,
  type RelayFetchAttempt,
} from "./relay-core";
import { cacheNostrEvent, getCachedNostrEvent } from "./event-cache";

export type NostrFetchErrorCode =
  | "relay_unavailable"
  | "event_absent"
  | "invalid_event";

export class NostrEventFetchError extends Error {
  constructor(
    public readonly code: NostrFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NostrEventFetchError";
  }
}

export interface BrowserNostrFetchResult {
  event: NostrEvent;
  source: "local" | "relay";
  relay?: string;
  advertisedRelays: string[];
  relayAttempts: RelayFetchAttempt[];
}

export const fetchNeventWithCache = async ({
  nostr,
  neventId,
  configuredRelays,
  kind = CKBOOST_EVENT_KIND,
}: {
  nostr: NostrRelayClient | null | undefined;
  neventId: string;
  configuredRelays: string[];
  kind?: number;
}): Promise<BrowserNostrFetchResult> => {
  const parsed = decodeNevent(neventId);
  if (!parsed) {
    throw new NostrEventFetchError("invalid_event", "Invalid nevent ID format");
  }

  const cached = getCachedNostrEvent(parsed.id, kind);
  if (cached) {
    return {
      event: cached.event,
      source: "local",
      advertisedRelays: parsed.relays,
      relayAttempts: [],
    };
  }
  if (!nostr) {
    throw new NostrEventFetchError(
      "relay_unavailable",
      "Nostr relay pool is unavailable",
    );
  }

  const relayResult = await fetchEventFromRelays({
    nostr,
    eventId: parsed.id,
    relays: mergeRelayLists(parsed.relays, configuredRelays),
    kind,
  });
  if (relayResult.event) {
    cacheNostrEvent({
      event: relayResult.event,
      neventId,
      verifiedRelays: mergeRelayLists(
        parsed.relays,
        relayResult.relay ? [relayResult.relay] : [],
      ),
    });
    return {
      event: relayResult.event,
      source: "relay",
      relay: relayResult.relay,
      advertisedRelays: parsed.relays,
      relayAttempts: relayResult.attempts,
    };
  }

  if (relayResult.attempts.some((attempt) => attempt.status === "invalid")) {
    throw new NostrEventFetchError(
      "invalid_event",
      "A relay returned an invalid Nostr event",
    );
  }
  if (relayResult.attempts.some((attempt) => attempt.status === "missing")) {
    throw new NostrEventFetchError(
      "event_absent",
      "Event is absent from the configured Nostr relays",
    );
  }
  throw new NostrEventFetchError(
    "relay_unavailable",
    "The configured Nostr relays are unavailable",
  );
};
