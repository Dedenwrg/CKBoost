import type { Handler } from "@netlify/functions";
import { createLogger } from "../lib/log";
import { SimplePool, Filter, Event, nip19 } from "nostr-tools";
import { WebSocket } from "ws";
import { getConfiguredNostrRelays } from "../configs/nostr";

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

const parseTargetEventId = (raw?: string | null): string | null => {
  if (!raw) return null;
  if (raw.startsWith("nevent1")) {
    try {
      const decoded = nip19.decode(raw);
      if (decoded.type === "nevent") {
        return (decoded.data as { id: string }).id;
      }
    } catch (e) {
      logger.warn("Failed to decode nevent targetEventId", { raw, error: e });
      return null;
    }
  }
  return raw;
};

// Use the same relay priority as the dapp client to ensure event links resolve
// correctly when opened on njump.me or other viewers.
const RELAYS = getConfiguredNostrRelays();

// --- Types ---

type SocialStats = {
  commentsCount: number;
  likesCount: number;
  totalTipAmount: string;
  tipCommentsCount?: number;
};

type Comment = {
  neventId: string;
  eventId: string;
  pubkey?: string;
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
  authors: string[];
};

// --- In-Memory Cache ---
const commentCache: Record<string, CacheEntry> = {};
const tipLikeCache: Record<string, CacheEntry> = {};

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
  tippingTypeId: string,
  filterFn?: (interaction: ParsedInteraction) => boolean
): ParsedInteraction[] => {
  const parsed = events
    .map((evt) => parseInteraction(evt, tippingTypeId))
    .filter((evt): evt is ParsedInteraction => evt !== null)
    .filter((interaction) => (filterFn ? filterFn(interaction) : true))
    .sort((a, b) => b.createdAt - a.createdAt); // newest first

  const seen = new Map<string, ParsedInteraction>();
  const unique: ParsedInteraction[] = [];
  const duplicatesLogged = new Set<string>();

  for (const interaction of parsed) {
    const key = `${interaction.payload.type}:${interaction.dedupKey}`;
    if (seen.has(key)) {
      if (!duplicatesLogged.has(key)) {
        const first = seen.get(key)!;
        logger.warn("Duplicate interaction detected", {
          tippingTypeId,
          key,
          firstEventId: first.event.id,
          firstPayload: first.payload,
          duplicateEventId: interaction.event.id,
          duplicatePayload: interaction.payload,
        });
        duplicatesLogged.add(key);
      }
      continue;
    }
    seen.set(key, interaction);
    unique.push(interaction);
  }

  return unique;
};

type CacheCategory = "comments" | "tipsLikes";

const shouldKeepInteraction = (
  category: CacheCategory,
  interaction: ParsedInteraction
): boolean => {
  if (category === "comments") {
    return (
      interaction.payload.type === COMMENT_TAG_TYPE &&
      interaction.payload.isTip !== true
    );
  }
  if (interaction.payload.type === LIKE_TAG_TYPE) return true;
  return (
    interaction.payload.type === COMMENT_TAG_TYPE &&
    interaction.payload.isTip === true
  );
};

const fetchEvents = async (
  targetEventId: string,
  since?: number,
  baseId?: string,
  category?: CacheCategory
): Promise<Event[]> => {
  const pool = new SimplePool();
  try {
    const filter: Filter = {
      kinds: [CKBOOST_SUBMISSION_KIND],
      "#e": [targetEventId],
      limit: 2000,
    };
    if (since) {
      filter.since = since;
    }

    logger.info("Fetching events for target", {
      targetEventId,
      baseId,
      category,
      since,
    });

    const events = await pool.querySync(RELAYS, filter);
    return events;
  } catch (error) {
    logger.error(
      `Failed to fetch events for target ${targetEventId}`,
      error
    );
    return [];
  } finally {
    pool.close(RELAYS);
  }
};

const updateCacheForCategory = async (
  id: string,
  category: CacheCategory,
  targetEventId: string
): Promise<void> => {
  if (!targetEventId) return;

  const store = category === "comments" ? commentCache : tipLikeCache;
  const now = Math.floor(Date.now() / 1000);
  const entry = store[targetEventId] || {
    events: [],
    lastFetched: 0,
    lastFetchExisting: 0,
    lastFetchNew: 0,
    lastFetchDropped: 0,
    authors: [],
  };

  // Fetch new events since last fetch (minus buffer to be safe)
  const since =
    entry.lastFetched === 0 ? undefined : entry.lastFetched - 60;

  logger.info("Update cache start", {
    id,
    category,
    targetEventId,
    lastFetched: entry.lastFetched,
    since,
  });

  const newEvents = await fetchEvents(targetEventId, since, id, category);

  // Merge and deduplicate
  // Keep all events; no deduping for now
  const mergedEvents = [...entry.events, ...newEvents];
  const dedupedInteractions = deduplicateInteractions(
    mergedEvents,
    id,
    (interaction) => shouldKeepInteraction(category, interaction)
  );
  const dedupedEvents = dedupedInteractions.map(
    (interaction) => interaction.event
  );
  const droppedDuplicates = mergedEvents.length - dedupedEvents.length;

  logger.info(
    `Updated ${category} cache for ${id}: ${entry.events.length} existing, ${newEvents.length} new, ${mergedEvents.length} merged, ${dedupedEvents.length} kept (dedupe suspended)`
  );

  store[targetEventId] = {
    events: dedupedEvents,
    lastFetched: now,
    lastFetchExisting: entry.events.length,
    lastFetchNew: newEvents.length,
    lastFetchDropped: droppedDuplicates,
    authors: [targetEventId],
  };
};

const parseComment = (event: Event, payload: InteractionPayload): Comment => {
  const explicit = extractNeventId(payload);
  let neventId: string;
  if (explicit && explicit.startsWith("nevent1")) {
    neventId = explicit;
  } else {
    neventId = explicit || event.id;
    try {
      neventId = nip19.neventEncode({ id: event.id, relays: RELAYS });
    } catch (e) {
      try {
        neventId = nip19.noteEncode(event.id);
      } catch {
        logger.warn("Failed to encode nevent/note for event", {
          id: event.id,
          explicit,
          error: e,
        });
      }
    }
  }
  const timestamp = normalizeTimestamp(payload.createdAt, event.created_at);

  return {
    neventId,
    eventId: event.id,
    pubkey: event.pubkey,
    author: payload.displayName || "Unknown",
    content: payload.text || "",
    timestamp: new Date(timestamp).toLocaleString(),
    likes: 0,
    isLiked: false,
    link: `https://njump.me/${neventId}`,
    isTip: payload.isTip,
    tipAmount: payload.amount,
    tipTxHash: payload.txHash,
  };
};

const aggregateStats = (
  commentInteractions: ParsedInteraction[],
  tipLikeInteractions: ParsedInteraction[]
): SocialStats => {
  const tipComments = tipLikeInteractions.filter(
    ({ payload }) => payload.type === COMMENT_TAG_TYPE && payload.isTip === true
  );
  const likesCount = tipLikeInteractions.filter(
    ({ payload }) => payload.type === LIKE_TAG_TYPE
  ).length;
  let totalTipAmount = BigInt(0);

  for (const { payload } of tipComments) {
    if (payload.amount) {
      try {
        totalTipAmount += fixedPointFrom(payload.amount);
      } catch {
        // Ignore malformed amounts but keep counting comments
      }
    }
  }

  return {
    commentsCount: commentInteractions.length + tipComments.length,
    likesCount,
    totalTipAmount: totalTipAmount.toString(),
    tipCommentsCount: tipComments.length,
  };
};

const getDetails = (
  id: string,
  page: number,
  limit: number,
  userLockHash?: string,
  _tipsOnly = false,
  targetEventId?: string
): {
  stats: SocialStats;
  comments: Comment[];
  tipComments: Comment[];
  totalComments: number;
  page: number;
  limit: number;
  isLiked: boolean;
  commonCommentsTotal: number;
} => {
  const cacheKey = targetEventId || id;
  const commentEvents = commentCache[cacheKey]?.events || [];
  const tipLikeEvents = tipLikeCache[cacheKey]?.events || [];

  const commentInteractions = deduplicateInteractions(
    commentEvents,
    id,
    ({ payload }) =>
      payload.type === COMMENT_TAG_TYPE && payload.isTip !== true
  );
  const tipLikeInteractions = deduplicateInteractions(
    tipLikeEvents,
    id,
    ({ payload }) =>
      payload.type === LIKE_TAG_TYPE ||
      (payload.type === COMMENT_TAG_TYPE && payload.isTip === true)
  );

  const tipCommentInteractions = tipLikeInteractions.filter(
    ({ payload }) => payload.type === COMMENT_TAG_TYPE && payload.isTip === true
  );
  const stats = aggregateStats(commentInteractions, tipLikeInteractions);

  const totalComments =
    commentInteractions.length + tipCommentInteractions.length;
  const start = Math.max(0, (page - 1) * limit);
  const end = start + limit;
  const pagedComments = commentInteractions
    .slice(start, end)
    .map(({ event, payload }) => parseComment(event, payload));
  const tipComments = tipCommentInteractions.map(({ event, payload }) =>
    parseComment(event, payload)
  );

  const normalizedUserLock = userLockHash?.toLowerCase();
  const isLiked =
    !!normalizedUserLock &&
    tipLikeInteractions.some(
      ({ payload }) =>
        payload.type === LIKE_TAG_TYPE &&
        payload.authorLockHash?.toLowerCase() === normalizedUserLock
    );

  logger.info(
    `Details for ${id}: commonComments=${commentInteractions.length}, tipComments=${tipComments.length}, likes=${stats.likesCount}, page=${page}, limit=${limit}, returning=${pagedComments.length}`
  );

  return {
    stats,
    comments: pagedComments,
    tipComments,
    totalComments,
    page,
    limit,
    isLiked,
    commonCommentsTotal: commentInteractions.length,
  };
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
      const id = query.id;
      const targetEventId = parseTargetEventId(
        query.targetEventId || query.targetNevent || query.eventId
      );

      if (!id || !targetEventId) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "id and targetEventId are required" }),
        };
      }

      await Promise.all([
        updateCacheForCategory(id, "comments", targetEventId),
        updateCacheForCategory(id, "tipsLikes", targetEventId),
      ]);

      const comments = deduplicateInteractions(
        commentCache[targetEventId]?.events || [],
        id,
        ({ payload }) =>
          payload.type === COMMENT_TAG_TYPE && payload.isTip !== true
      );
      const tipLikes = deduplicateInteractions(
        tipLikeCache[targetEventId]?.events || [],
        id,
        ({ payload }) =>
          payload.type === LIKE_TAG_TYPE ||
          (payload.type === COMMENT_TAG_TYPE && payload.isTip === true)
      );
      const result = aggregateStats(comments, tipLikes);

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
      const tipsOnly = query.tipsOnly === "true";
      const targetEventId = parseTargetEventId(
        query.targetEventId || query.targetNevent || query.eventId
      );

      if (!id || !targetEventId) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "id and targetEventId are required" }),
        };
      }

      await Promise.all([
        updateCacheForCategory(id, "comments", targetEventId),
        updateCacheForCategory(id, "tipsLikes", targetEventId),
      ]);
      const result = getDetails(
        id,
        page,
        limit,
        userLockHash,
        tipsOnly,
        targetEventId
      );

      if (tipsOnly) {
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stats: result.stats,
            comments: result.tipComments,
            totalComments: result.tipComments.length,
            page: 1,
            limit: result.tipComments.length,
            isLiked: result.isLiked,
            commonCommentsTotal: 0,
            tipComments: result.tipComments,
          }),
        };
      }

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
