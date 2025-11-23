import type { Handler } from "@netlify/functions";
import { createLogger } from "../lib/log";
import { SimplePool, Filter, Event } from "nostr-tools";
import { WebSocket } from "ws";
import { getPublicKey } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils.js";

if (!global.WebSocket) {
  // @ts-expect-error WebSocket polyfill
  global.WebSocket = WebSocket;
}

const logger = createLogger("social-interactions");

const CKBOOST_SUBMISSION_KIND = 30078;
const COMMENT_TAG_TYPE = "tipping_comment";
const LIKE_TAG_TYPE = "tipping_like";

const fixedPointFrom = (val: string | number, decimals = 8): bigint => {
  try {
    const str = val.toString();
    const parts = str.split(".");
    const integer = BigInt(parts[0]);
    const fractionStr = parts[1] || "";
    const fraction = BigInt(
      fractionStr.padEnd(decimals, "0").slice(0, decimals)
    );
    let multiplier = BigInt(1);
    for (let i = 0; i < decimals; i++) {
      multiplier = multiplier * BigInt(10);
    }
    return integer * multiplier + fraction;
  } catch {
    return BigInt(0);
  }
};

const ensure32Bytes = (bytes: Uint8Array): Uint8Array => {
  if (bytes.length === 32) return new Uint8Array(bytes);
  if (bytes.length > 32) return bytes.slice(bytes.length - 32);
  const padded = new Uint8Array(32);
  padded.set(bytes, 32 - bytes.length);
  return padded;
};

const derivePubkey = (id: string): string => {
  try {
    const hex = id.startsWith("0x") ? id.slice(2) : id;
    const privateKey = ensure32Bytes(hexToBytes(hex));
    return getPublicKey(privateKey);
  } catch (e) {
    logger.warn(`Failed to derive pubkey for id: ${id}`, e);
    return "";
  }
};

const RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://nos.lol",
  "wss://relay.snort.social",
];

// --- Types ---

type SocialStats = {
  commentsCount: number;
  likesCount: number;
  totalTipAmount: string;
};

type Comment = {
  neventId: string;
  author: string;
  content: string;
  timestamp: string;
  likes: number;
  isLiked: boolean;
  link?: string;
  isTip?: boolean;
  tipAmount?: string;
  tipTxHash?: string;
};

type InteractionType = typeof COMMENT_TAG_TYPE | typeof LIKE_TAG_TYPE;

type InteractionPayload = {
  type: InteractionType;
  version?: number;
  tippingTypeId?: string;
  text?: string;
  authorLockHash?: string;
  authorTypeId?: string | null;
  displayName?: string;
  createdAt?: number;
  isTip?: boolean;
  txHash?: string;
  amount?: string;
  neventId?: string;
  eventUrl?: string;
};

type ParsedInteraction = {
  event: Event;
  payload: InteractionPayload;
  dedupKey: string;
  createdAt: number;
};

type CacheEntry = {
  events: Event[];
  lastFetched: number;
  lastFetchExisting: number;
  lastFetchNew: number;
  lastFetchDropped: number;
};

// --- In-Memory Cache ---
const cache: Record<string, CacheEntry> = {};

// --- Helpers ---

const extractNeventId = (
  payload: Partial<InteractionPayload>
): string | undefined => {
  if (payload.neventId && typeof payload.neventId === "string") {
    return payload.neventId;
  }

  if (payload.eventUrl && typeof payload.eventUrl === "string") {
    const match = payload.eventUrl.match(/nevent1[0-9a-z]+/i);
    if (match?.[0]) {
      return match[0];
    }
  }

  return undefined;
};

const buildDedupKey = (
  payload: InteractionPayload,
  event: Event,
  tippingTypeId: string
): string => {
  // For likes, keep only one per author per tipping id
  if (payload.type === LIKE_TAG_TYPE) {
    const author =
      payload.authorLockHash ||
      payload.authorTypeId ||
      (event.pubkey ? `pub:${event.pubkey}` : "");
    if (author) {
      return `like:${author}:${tippingTypeId}`;
    }
  }

  // Prefer nevent IDs to collapse duplicates returned from multiple relays
  const neventId = extractNeventId(payload);
  if (neventId) return neventId;
  return event.id;
};

const normalizeTimestamp = (
  payloadTimestamp: number | undefined,
  eventTimestamp: number
): number => {
  if (typeof payloadTimestamp === "number") {
    return payloadTimestamp > 1e12
      ? payloadTimestamp
      : Math.floor(payloadTimestamp * 1000);
  }
  return eventTimestamp * 1000;
};

const parseInteraction = (
  event: Event,
  tippingTypeId: string
): ParsedInteraction | null => {
  try {
    const parsed = JSON.parse(event.content) as Partial<InteractionPayload>;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.tippingTypeId !== tippingTypeId ||
      (parsed.type !== COMMENT_TAG_TYPE && parsed.type !== LIKE_TAG_TYPE)
    ) {
      return null;
    }

    const payload: InteractionPayload = { ...parsed, type: parsed.type };
    const dedupKey = buildDedupKey(payload, event, tippingTypeId);
    const createdAt = normalizeTimestamp(payload.createdAt, event.created_at);

    return { event, payload, dedupKey, createdAt };
  } catch {
    return null;
  }
};

const deduplicateInteractions = (
  events: Event[],
  tippingTypeId: string
): ParsedInteraction[] => {
  const parsed = events
    .map((evt) => parseInteraction(evt, tippingTypeId))
    .filter((evt): evt is ParsedInteraction => evt !== null)
    .sort((a, b) => b.createdAt - a.createdAt); // newest first

  const seen = new Set<string>();
  const unique: ParsedInteraction[] = [];

  for (const interaction of parsed) {
    if (seen.has(interaction.dedupKey)) continue;
    seen.add(interaction.dedupKey);
    unique.push(interaction);
  }

  return unique;
};

const fetchEvents = async (
  pubkey: string,
  since?: number
): Promise<Event[]> => {
  const pool = new SimplePool();
  try {
    const filter: Filter = {
      kinds: [CKBOOST_SUBMISSION_KIND],
      authors: [pubkey],
    };
    if (since) {
      filter.since = since;
    }

    const events = await pool.querySync(RELAYS, filter);

    // Deduplicate by ID immediately after fetch
    const uniqueEvents = new Map<string, Event>();
    events.forEach((e) => uniqueEvents.set(e.id, e));

    return Array.from(uniqueEvents.values());
  } catch (error) {
    logger.error(`Failed to fetch events for ${pubkey}`, error);
    return [];
  } finally {
    pool.close(RELAYS);
  }
};

const updateCache = async (id: string) => {
  const pubkey = derivePubkey(id);
  if (!pubkey) return;

  const now = Math.floor(Date.now() / 1000);
  const entry =
    cache[id] || {
      events: [],
      lastFetched: 0,
      lastFetchExisting: 0,
      lastFetchNew: 0,
      lastFetchDropped: 0,
    };

  // Fetch new events since last fetch (minus buffer to be safe)
  const since = entry.lastFetched > 0 ? entry.lastFetched - 60 : undefined;
  const newEvents = await fetchEvents(pubkey, since);

  // Merge and deduplicate
  const eventMap = new Map<string, Event>();
  entry.events.forEach((e) => eventMap.set(e.id, e));
  newEvents.forEach((e) => eventMap.set(e.id, e));

  const mergedEvents = Array.from(eventMap.values());
  const dedupedInteractions = deduplicateInteractions(mergedEvents, id);
  const dedupedEvents = dedupedInteractions.map((interaction) => interaction.event);
  const dedupedComments = dedupedInteractions.filter(
    ({ payload }) => payload.type === COMMENT_TAG_TYPE
  ).length;
  const droppedDuplicates = mergedEvents.length - dedupedEvents.length;

  logger.info(
    `Updated cache for ${id}: ${entry.events.length} existing, ${newEvents.length} new, ${mergedEvents.length} merged, ${dedupedEvents.length} kept (dropped ${droppedDuplicates} dupes by nevent/eventId), ${dedupedComments} comments`
  );

  cache[id] = {
    events: dedupedEvents,
    lastFetched: now,
    lastFetchExisting: entry.events.length,
    lastFetchNew: newEvents.length,
    lastFetchDropped: droppedDuplicates,
  };
};

const parseComment = (
  event: Event,
  payload: InteractionPayload
): Comment => {
  const neventId = extractNeventId(payload);
  const timestamp = normalizeTimestamp(payload.createdAt, event.created_at);

  return {
    neventId: neventId || event.id,
    author: payload.displayName || "Unknown",
    content: payload.text || "",
    timestamp: new Date(timestamp).toLocaleString(),
    likes: 0,
    isLiked: false,
    link:
      payload.eventUrl ||
      (neventId ? `https://njump.me/${neventId}` : `https://njump.me/${event.id}`),
    isTip: payload.isTip,
    tipAmount: payload.amount,
    tipTxHash: payload.txHash,
  };
};

const aggregateStats = (interactions: ParsedInteraction[]): SocialStats => {
  let commentsCount = 0;
  let likesCount = 0;
  let totalTipAmount = BigInt(0);

  for (const { payload } of interactions) {
    if (payload.type === LIKE_TAG_TYPE) {
      likesCount++;
    } else if (payload.type === COMMENT_TAG_TYPE) {
      commentsCount++;
      if (payload.isTip && payload.amount) {
        try {
          totalTipAmount += fixedPointFrom(payload.amount);
        } catch {
          // Ignore malformed amounts but keep counting comments
        }
      }
    }
  }

  return {
    commentsCount,
    likesCount,
    totalTipAmount: totalTipAmount.toString(),
  };
};

const getDetails = (
  id: string,
  page: number,
  limit: number,
  userLockHash?: string
): {
  stats: SocialStats;
  comments: Comment[];
  totalComments: number;
  page: number;
  limit: number;
  isLiked: boolean;
} => {
  const cachedEvents = cache[id]?.events || [];
  const interactions = deduplicateInteractions(cachedEvents, id);
  const stats = aggregateStats(interactions);

  const commentInteractions = interactions.filter(
    ({ payload }) => payload.type === COMMENT_TAG_TYPE
  );

  const totalComments = commentInteractions.length;
  const start = Math.max(0, (page - 1) * limit);
  const end = start + limit;
  const pagedComments = commentInteractions
    .slice(start, end)
    .map(({ event, payload }) => parseComment(event, payload));

  const normalizedUserLock = userLockHash?.toLowerCase();
  const isLiked =
    !!normalizedUserLock &&
    interactions.some(
      ({ payload }) =>
        payload.type === LIKE_TAG_TYPE &&
        payload.authorLockHash?.toLowerCase() === normalizedUserLock
    );

  logger.info(
    `Details for ${id}: cacheEvents(deduped)=${cachedEvents.length}, post-filter=${interactions.length}, totalComments=${totalComments}, lastFetch: existing=${cache[id]?.lastFetchExisting ?? 0}, new=${cache[id]?.lastFetchNew ?? 0}, dropped=${cache[id]?.lastFetchDropped ?? 0}, page=${page}, limit=${limit}, returning=${pagedComments.length}`
  );

  return { stats, comments: pagedComments, totalComments, page, limit, isLiked };
};

// --- Handler ---

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  const query = event.queryStringParameters || {};
  const mode = query.mode || "stats"; // 'stats' | 'details'

  try {
    if (mode === "stats") {
      let ids: string[] = [];
      if (event.multiValueQueryStringParameters?.ids) {
        ids = event.multiValueQueryStringParameters.ids;
      } else if (query.ids) {
        ids = [query.ids];
      }
      ids = ids.filter(Boolean);

      if (ids.length === 0) {
        return { statusCode: 400, body: JSON.stringify({ error: "No ids" }) };
      }

      // Update cache for all requested IDs (parallel)
      await Promise.all(ids.map((id) => updateCache(id)));

      const result: Record<string, SocialStats> = {};
      ids.forEach((id) => {
        const interactions = deduplicateInteractions(
          cache[id]?.events || [],
          id
        );
        result[id] = aggregateStats(interactions);
      });

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      };
    } else if (mode === "details") {
      const id = query.id;
      const page = parseInt(query.page || "1");
      const limit = parseInt(query.limit || "20");
      const userLockHash = query.userLockHash;

      if (!id) {
        return { statusCode: 400, body: JSON.stringify({ error: "No id" }) };
      }

      await updateCache(id);
      const result = getDetails(id, page, limit, userLockHash);

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      };
    } else {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid mode" }),
      };
    }
  } catch (error) {
    logger.error("Handler error", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : "Unknown",
      }),
    };
  }
};
