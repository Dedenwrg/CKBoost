import type { NostrEvent } from "@nostrify/types";
import {
  CKBOOST_EVENT_KIND,
  decodeNevent,
  isValidCkboostEvent,
  mergeRelayLists,
} from "./relay-core";

export const NOSTR_EVENT_CACHE_KEY = "ckboost:nostr-event-cache:v1";
const MAX_CACHE_ENTRIES = 50;
const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface CachedNostrEvent {
  event: NostrEvent;
  neventId: string;
  cachedAt: number;
  verifiedRelays: string[];
}

type EventCache = Record<string, CachedNostrEvent>;

const getStorage = (): Storage | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const parseCache = (storage: Storage): EventCache => {
  try {
    const parsed = JSON.parse(
      storage.getItem(NOSTR_EVENT_CACHE_KEY) || "{}",
    ) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as EventCache;
    }
    storage.removeItem(NOSTR_EVENT_CACHE_KEY);
    return {};
  } catch {
    try {
      storage.removeItem(NOSTR_EVENT_CACHE_KEY);
    } catch {
      // Invalid cache cleanup is best effort.
    }
    return {};
  }
};

const writeCache = (storage: Storage, cache: EventCache): boolean => {
  try {
    storage.setItem(NOSTR_EVENT_CACHE_KEY, JSON.stringify(cache));
    return true;
  } catch {
    return false;
  }
};

const isValidEntry = (
  entry: unknown,
  expectedId: string,
  kind: number,
  now: number,
): entry is CachedNostrEvent => {
  if (!entry || typeof entry !== "object") return false;
  const candidate = entry as Partial<CachedNostrEvent>;
  const decoded =
    typeof candidate.neventId === "string"
      ? decodeNevent(candidate.neventId)
      : null;
  return (
    !!decoded &&
    decoded.id === expectedId &&
    typeof candidate.cachedAt === "number" &&
    candidate.cachedAt >= now - MAX_CACHE_AGE_MS &&
    Array.isArray(candidate.verifiedRelays) &&
    candidate.verifiedRelays.every((relay) => typeof relay === "string") &&
    !!candidate.event &&
    isValidCkboostEvent(candidate.event, expectedId, kind)
  );
};

const pruneCache = (cache: EventCache, now: number): EventCache =>
  Object.fromEntries(
    Object.entries(cache)
      .filter(([eventId, entry]) =>
        isValidEntry(
          entry,
          eventId,
          entry?.event?.kind ?? CKBOOST_EVENT_KIND,
          now,
        ),
      )
      .sort(([, left], [, right]) => right.cachedAt - left.cachedAt)
      .slice(0, MAX_CACHE_ENTRIES),
  );

export const getCachedNostrEvent = (
  eventId: string,
  kind = CKBOOST_EVENT_KIND,
): CachedNostrEvent | null => {
  const storage = getStorage();
  if (!storage) return null;
  const cache = parseCache(storage);
  const entry = cache[eventId];
  if (!isValidEntry(entry, eventId, kind, Date.now())) {
    if (eventId in cache) {
      delete cache[eventId];
      writeCache(storage, cache);
    }
    return null;
  }
  return entry;
};

export const cacheNostrEvent = ({
  event,
  neventId,
  verifiedRelays,
}: Omit<CachedNostrEvent, "cachedAt">): boolean => {
  const storage = getStorage();
  const decoded = decodeNevent(neventId);
  if (
    !storage ||
    !decoded ||
    decoded.id !== event.id ||
    !isValidCkboostEvent(event, event.id, event.kind)
  ) {
    return false;
  }

  const now = Date.now();
  const cache = pruneCache(parseCache(storage), now);
  const previous = cache[event.id];
  cache[event.id] = {
    event,
    neventId,
    cachedAt: now,
    verifiedRelays: mergeRelayLists(
      previous?.verifiedRelays || [],
      verifiedRelays,
    ),
  };

  const bounded = pruneCache(cache, now);
  return writeCache(storage, bounded);
};

export const removeCachedNostrEvent = (eventId: string): void => {
  const storage = getStorage();
  if (!storage) return;
  const cache = parseCache(storage);
  if (!(eventId in cache)) return;
  delete cache[eventId];
  writeCache(storage, cache);
};
