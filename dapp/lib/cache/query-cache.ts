import type { BonusStreakCalculation } from "@/netlify/lib/streak-bonus";
import { createScopedLogger } from "ssri-ckboost";
import {
  createLocalStorageCache,
  type CacheLookupResult,
} from "./local-storage-cache";

const ONE_MINUTE_MS = 60_000;

const pointsBalanceCache = createLocalStorageCache({
  namespace: "ckboost:points-balance",
  defaultTtlMs: ONE_MINUTE_MS,
  sessionScoped: true,
});

const streakBonusQueryCache = createLocalStorageCache({
  namespace: "ckboost:streak-bonus-query",
  defaultTtlMs: ONE_MINUTE_MS,
  sessionScoped: true,
});

const pointsLogger = createScopedLogger("PointsBalanceCache");
const streakLogger = createScopedLogger("StreakBonusCache");

type WithCacheOptions = {
  refresh?: boolean;
};

export const buildPointsBalanceCacheKey = (params: {
  network: string;
  protocolTypeHash: string;
  lockScriptHash: string;
}): string => {
  return [
    "v1",
    params.network.toLowerCase(),
    params.protocolTypeHash.trim().toLowerCase(),
    params.lockScriptHash.trim().toLowerCase(),
  ].join(":");
};

export const buildStreakBonusQueryCacheKey = (params: {
  network: string;
  userAddress: string;
  limit?: number;
}): string => {
  const limitPart =
    params.limit === undefined ? "default" : params.limit.toString(10);
  return [
    "v1",
    params.network.toLowerCase(),
    params.userAddress.trim().toLowerCase(),
    limitPart,
  ].join(":");
};

export const withPointsBalanceCache = async (
  key: string,
  loader: () => Promise<bigint>,
  options: WithCacheOptions = {}
): Promise<CacheLookupResult<bigint>> => {
  const { refresh = false } = options;
  const result = await pointsBalanceCache.withLoader<string>(
    key,
    async () => {
      const balance = await loader();
      return balance.toString();
    },
    { refresh }
  );

  try {
    const value = BigInt(result.value);
    const logContext = {
      key,
      storage: result.metadata.storage,
      ageMs: result.metadata.ageMs,
      stale: result.stale,
      ttlMs: result.metadata.ttlMs,
    };
    if (result.hit) {
      pointsLogger.info("points_balance_cache_hit", logContext);
    } else {
      pointsLogger.info("points_balance_cache_miss", logContext);
    }

    return {
      ...result,
      value,
    };
  } catch (error) {
    pointsBalanceCache.delete(key);
    if (!refresh) {
      return withPointsBalanceCache(key, loader, { refresh: true });
    }
    throw error;
  }
};

export const invalidatePointsBalanceCache = (key: string): void => {
  pointsBalanceCache.delete(key);
};

export const seedPointsBalanceCache = (
  key: string,
  balance: bigint
): void => {
  pointsBalanceCache.set(key, balance.toString());
};

export const withStreakBonusQueryCache = async (
  key: string,
  loader: () => Promise<BonusStreakCalculation>,
  options: WithCacheOptions = {}
): Promise<CacheLookupResult<BonusStreakCalculation>> => {
  const { refresh = false } = options;
  const result = await streakBonusQueryCache.withLoader<BonusStreakCalculation>(
    key,
    loader,
    { refresh }
  );

  const logContext = {
    key,
    storage: result.metadata.storage,
    ageMs: result.metadata.ageMs,
    stale: result.stale,
    ttlMs: result.metadata.ttlMs,
  };
  if (result.hit) {
    streakLogger.info("streak_bonus_cache_hit", logContext);
  } else {
    streakLogger.info("streak_bonus_cache_miss", logContext);
  }

  return result;
};

export const invalidateStreakBonusQueryCache = (key: string): void => {
  streakBonusQueryCache.delete(key);
};

export const seedStreakBonusQueryCache = (
  key: string,
  value: BonusStreakCalculation
): void => {
  streakBonusQueryCache.set(key, value);
};

export const CACHE_TTL_MS = ONE_MINUTE_MS;
