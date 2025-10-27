import type { Network } from "@/lib/ckb/deployment-manager";
import { createLogger } from "@/netlify/lib/log";

const log = createLogger("streak-bonus-cache");

export const STREAK_BONUS_CACHE_NAMESPACE = "streak-bonus";
const CACHE_KEY_VERSION = "v1";
const DEFAULT_CACHE_TTL_MINUTES = 30;

export const resolveStreakBonusCacheTtlMs = (): number => {
  const candidates = [
    process.env.STREAK_BONUS_CACHE_MAX_AGE_MINUTES,
    process.env.STREAK_BONUS_CACHE_TTL_MINUTES,
    process.env.CKBOOST_STREAK_BONUS_CACHE_MINUTES,
  ];

  for (const raw of candidates) {
    if (typeof raw !== "string" || raw.trim() === "") {
      continue;
    }
    const minutes = Number(raw);
    if (!Number.isFinite(minutes)) {
      log.warn("invalid_cache_ttl", { raw });
      continue;
    }
    if (minutes <= 0) {
      return 0;
    }
    return Math.round(minutes * 60_000);
  }

  return DEFAULT_CACHE_TTL_MINUTES * 60_000;
};

export const buildStreakBonusCacheKey = ({
  network,
  protocolTypeHash,
  userAddress,
  limit,
}: {
  network: Network;
  protocolTypeHash: string;
  userAddress: string;
  limit: number;
}): string => {
  return [
    CACHE_KEY_VERSION,
    network,
    protocolTypeHash.toLowerCase(),
    userAddress.trim().toLowerCase(),
    limit,
  ].join(":");
};

