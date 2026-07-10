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
    public readonly eventId?: string,
    public readonly relayAttempts: RelayFetchAttempt[] = [],
  ) {
    super(message);
    this.name = "NostrEventFetchError";
  }
}

export interface SafeNostrFetchDiagnostic {
  code: NostrFetchErrorCode;
  eventId?: string;
  attempts: Array<
    Pick<RelayFetchAttempt, "relay" | "round" | "status" | "elapsedMs">
  >;
}

export const toSafeNostrFetchDiagnostic = (
  error: NostrEventFetchError,
): SafeNostrFetchDiagnostic => ({
  code: error.code,
  ...(error.eventId ? { eventId: error.eventId } : {}),
  attempts: error.relayAttempts.map(
    ({ relay, round, status, elapsedMs }) => ({
      relay,
      round,
      status,
      elapsedMs,
    }),
  ),
});

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
      parsed.id,
    );
  }

  const relays = mergeRelayLists(parsed.relays, configuredRelays);
  const relayResult = await fetchEventFromRelays({
    nostr,
    eventId: parsed.id,
    relays,
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
      parsed.id,
      relayResult.attempts,
    );
  }
  const confirmedAbsent =
    relays.length > 0 &&
    relays.every((relay) =>
      relayResult.attempts.some(
        (attempt) => attempt.relay === relay && attempt.status === "missing",
      ),
    );
  if (confirmedAbsent) {
    throw new NostrEventFetchError(
      "event_absent",
      "Event is absent from all queried Nostr relays",
      parsed.id,
      relayResult.attempts,
    );
  }
  throw new NostrEventFetchError(
    "relay_unavailable",
    "The Nostr event could not be confirmed because one or more relays are unavailable",
    parsed.id,
    relayResult.attempts,
  );
};
