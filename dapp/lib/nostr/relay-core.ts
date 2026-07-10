import type { NostrEvent, NostrFilter } from "@nostrify/types";
import { getEventHash, nip19, verifyEvent } from "nostr-tools";

export const CKBOOST_EVENT_KIND = 30078;
export const DEFAULT_NOSTR_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://relay.nostr.net",
  "wss://nos.lol",
] as const;
export const DEFAULT_RELAY_TIMEOUT_MS = 5_000;
export const DEFAULT_RELAY_QUORUM = 2;
export const DEFAULT_SOCIAL_RELAY_QUORUM = 1;
export const DEFAULT_FETCH_ROUNDS = 2;

export type RelayPublishStatus = "accepted" | "failed" | "timeout";
export type RelayVerificationStatus =
  | "verified"
  | "missing"
  | "invalid"
  | "failed"
  | "timeout"
  | "skipped";

export interface RelayAttemptResult {
  relay: string;
  publish: RelayPublishStatus;
  verification: RelayVerificationStatus;
  elapsedMs: number;
  error?: string;
}

export interface StoredSubmissionEvent {
  neventId: string;
  event: NostrEvent;
  verifiedRelays: string[];
  attempts: RelayAttemptResult[];
}

export interface RelayFetchAttempt {
  relay: string;
  round: number;
  status: "found" | "missing" | "invalid" | "failed" | "timeout";
  elapsedMs: number;
  error?: string;
}

export interface RelayFetchResult {
  event: NostrEvent | null;
  relay?: string;
  attempts: RelayFetchAttempt[];
}

export interface NostrRelayClient {
  event(
    event: NostrEvent,
    opts?: { signal?: AbortSignal; relays?: string[] },
  ): Promise<void>;
  query(
    filters: NostrFilter[],
    opts?: { signal?: AbortSignal; relays?: string[] },
  ): Promise<NostrEvent[]>;
}

export class NostrRelayQuorumError extends Error {
  constructor(
    message: string,
    public readonly attempts: RelayAttemptResult[],
    public readonly requiredCopies: number,
    public readonly verifiedRelays: string[],
  ) {
    super(message);
    this.name = "NostrRelayQuorumError";
  }
}

const relayKey = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "wss:" && url.protocol !== "ws:") ||
      url.username ||
      url.password
    ) {
      return null;
    }
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
};

const unique = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const relays: string[] = [];
  for (const value of values) {
    const relay = value.trim();
    const key = relayKey(relay);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    relays.push(relay);
  }
  return relays;
};

export const parseRelayList = (
  value: string | undefined,
  fallback: readonly string[] = DEFAULT_NOSTR_RELAYS,
): string[] => {
  if (!value?.trim()) return unique(fallback);
  const relays = unique(value.split(","));
  return relays.length ? relays : unique(fallback);
};

export const mergeRelayLists = (...lists: readonly string[][]): string[] =>
  unique(lists.flat());

export const decodeNevent = (
  neventId: string,
): { id: string; relays: string[] } | null => {
  try {
    const decoded = nip19.decode(neventId);
    if (decoded.type !== "nevent") return null;
    return {
      id: decoded.data.id,
      relays: decoded.data.relays || [],
    };
  } catch {
    return null;
  }
};

export const encodeVerifiedNevent = (
  eventId: string,
  verifiedRelays: string[],
): string =>
  nip19.neventEncode({ id: eventId, relays: unique(verifiedRelays) });

export const isValidCkboostEvent = (
  event: NostrEvent,
  expectedId?: string,
  expectedKind = CKBOOST_EVENT_KIND,
): boolean => {
  try {
    if (
      !event ||
      typeof event !== "object" ||
      event.kind !== expectedKind ||
      typeof event.id !== "string" ||
      typeof event.pubkey !== "string" ||
      typeof event.sig !== "string" ||
      typeof event.content !== "string" ||
      typeof event.created_at !== "number" ||
      !Array.isArray(event.tags) ||
      (expectedId && event.id !== expectedId) ||
      !event.tags.some(
        (tag) =>
          Array.isArray(tag) &&
          tag[0] === "client" &&
          tag[1] === "ckboost-dapp",
      )
    ) {
      return false;
    }
    if (getEventHash(event) !== event.id) return false;
    return verifyEvent(event);
  } catch {
    return false;
  }
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isAbortError = (error: unknown, signal: AbortSignal): boolean =>
  signal.aborted ||
  (error instanceof Error &&
    (error.name === "AbortError" || /abort|timeout/i.test(error.message)));

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const publishToRelay = async (
  nostr: NostrRelayClient,
  event: NostrEvent,
  relay: string,
  timeoutMs: number,
): Promise<Pick<RelayAttemptResult, "publish" | "error">> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await nostr.event(event, { relays: [relay], signal: controller.signal });
    return { publish: "accepted" };
  } catch (error) {
    return {
      publish: isAbortError(error, controller.signal) ? "timeout" : "failed",
      error: errorMessage(error),
    };
  } finally {
    clearTimeout(timeout);
  }
};

const queryRelayOnce = async (
  nostr: NostrRelayClient,
  eventId: string,
  relay: string,
  round: number,
  timeoutMs: number,
  kind: number,
): Promise<{ event: NostrEvent | null; attempt: RelayFetchAttempt }> => {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const events = await nostr.query(
      [{ ids: [eventId], kinds: [kind], limit: 1 }],
      { relays: [relay], signal: controller.signal },
    );
    const event = events.find((candidate) => candidate.id === eventId) || null;
    if (!event) {
      return {
        event: null,
        attempt: {
          relay,
          round,
          status: "missing",
          elapsedMs: Date.now() - startedAt,
        },
      };
    }
    if (!isValidCkboostEvent(event, eventId, kind)) {
      return {
        event: null,
        attempt: {
          relay,
          round,
          status: "invalid",
          elapsedMs: Date.now() - startedAt,
          error:
            "Relay returned an event with an invalid id, signature, or kind",
        },
      };
    }
    return {
      event,
      attempt: {
        relay,
        round,
        status: "found",
        elapsedMs: Date.now() - startedAt,
      },
    };
  } catch (error) {
    return {
      event: null,
      attempt: {
        relay,
        round,
        status: isAbortError(error, controller.signal) ? "timeout" : "failed",
        elapsedMs: Date.now() - startedAt,
        error: errorMessage(error),
      },
    };
  } finally {
    clearTimeout(timeout);
  }
};

export const fetchEventFromRelays = async ({
  nostr,
  eventId,
  relays,
  timeoutMs = DEFAULT_RELAY_TIMEOUT_MS,
  rounds = DEFAULT_FETCH_ROUNDS,
  retryDelayMs = 250,
  kind = CKBOOST_EVENT_KIND,
}: {
  nostr: NostrRelayClient;
  eventId: string;
  relays: string[];
  timeoutMs?: number;
  rounds?: number;
  retryDelayMs?: number;
  kind?: number;
}): Promise<RelayFetchResult> => {
  const relayList = unique(relays);
  const attempts: RelayFetchAttempt[] = [];

  for (let round = 1; round <= rounds; round++) {
    const requests = relayList.map((relay) =>
      queryRelayOnce(nostr, eventId, relay, round, timeoutMs, kind),
    );
    const firstValid = Promise.any(
      requests.map(async (request) => {
        const result = await request;
        if (!result.event) throw new Error("No valid event on this relay");
        return result;
      }),
    ).catch(() => null);

    const winner = await firstValid;
    if (winner?.event) {
      attempts.push(winner.attempt);
      return {
        event: winner.event,
        relay: winner.attempt.relay,
        attempts,
      };
    }

    const roundResults = await Promise.all(requests);
    attempts.push(...roundResults.map((result) => result.attempt));
    if (round < rounds) await delay(retryDelayMs);
  }

  return { event: null, attempts };
};

export const publishEventWithQuorum = async ({
  nostr,
  event,
  relays,
  requiredCopies = DEFAULT_RELAY_QUORUM,
  timeoutMs = DEFAULT_RELAY_TIMEOUT_MS,
  verificationRounds = DEFAULT_FETCH_ROUNDS,
  verificationDelayMs = 250,
}: {
  nostr: NostrRelayClient;
  event: NostrEvent;
  relays: string[];
  requiredCopies?: number;
  timeoutMs?: number;
  verificationRounds?: number;
  verificationDelayMs?: number;
}): Promise<{
  verifiedRelays: string[];
  attempts: RelayAttemptResult[];
}> => {
  const { verifiedRelays, attempts } = await publishEventToRelays({
    nostr,
    event,
    relays,
    timeoutMs,
    verificationRounds,
    verificationDelayMs,
  });

  if (attempts.length < requiredCopies) {
    throw new NostrRelayQuorumError(
      `At least ${requiredCopies} relays are required, but only ${attempts.length} are configured`,
      attempts,
      requiredCopies,
      verifiedRelays,
    );
  }

  if (verifiedRelays.length < requiredCopies) {
    throw new NostrRelayQuorumError(
      `Nostr storage quorum not reached: verified ${verifiedRelays.length}/${requiredCopies} relay copies`,
      attempts,
      requiredCopies,
      verifiedRelays,
    );
  }

  return { verifiedRelays, attempts };
};

export const publishEventToRelays = async ({
  nostr,
  event,
  relays,
  timeoutMs = DEFAULT_RELAY_TIMEOUT_MS,
  verificationRounds = DEFAULT_FETCH_ROUNDS,
  verificationDelayMs = 250,
}: {
  nostr: NostrRelayClient;
  event: NostrEvent;
  relays: string[];
  timeoutMs?: number;
  verificationRounds?: number;
  verificationDelayMs?: number;
}): Promise<{
  verifiedRelays: string[];
  attempts: RelayAttemptResult[];
}> => {
  if (!isValidCkboostEvent(event, event.id, event.kind)) {
    throw new Error("Refusing to publish an invalid Nostr event");
  }

  const relayList = unique(relays);
  const settledAttempts = await Promise.allSettled(
    relayList.map(async (relay): Promise<RelayAttemptResult> => {
      const startedAt = Date.now();
      const publish = await publishToRelay(nostr, event, relay, timeoutMs);
      // A relay may reject an exact retry as a duplicate, or the publish ACK
      // may time out after the event was stored. Read back after every publish
      // outcome and use the validated copy as the source of truth.
      const verification = await fetchEventFromRelays({
        nostr,
        eventId: event.id,
        relays: [relay],
        timeoutMs,
        rounds: verificationRounds,
        retryDelayMs: verificationDelayMs,
        kind: event.kind,
      });
      const lastAttempt = verification.attempts.at(-1);
      const verificationStatus: RelayVerificationStatus = verification.event
        ? "verified"
        : lastAttempt?.status === "found"
          ? "invalid"
          : lastAttempt?.status || "missing";
      return {
        relay,
        publish: publish.publish,
        verification: verificationStatus,
        elapsedMs: Date.now() - startedAt,
        error: lastAttempt?.error || publish.error,
      };
    }),
  );
  const attempts = settledAttempts.map(
    (result, index): RelayAttemptResult =>
      result.status === "fulfilled"
        ? result.value
        : {
            relay: relayList[index],
            publish: "failed",
            verification: "skipped",
            elapsedMs: 0,
            error: errorMessage(result.reason),
          },
  );

  const verifiedRelays = attempts
    .filter((attempt) => attempt.verification === "verified")
    .map((attempt) => attempt.relay);

  return { verifiedRelays, attempts };
};
