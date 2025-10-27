/**
 * Netlify function: returns streak bonus eligibility metadata and unsigned transaction.
 */
import type { Handler, HandlerEvent } from "@netlify/functions";
import { ccc } from "@ckb-ccc/shell";
import { deploymentManager } from "@/lib/ckb/deployment-manager";
import type { StreakBonusQueryResponse } from "@/netlify/lib/streak-bonus";
import { withCache } from "@/netlify/lib/cache";
import {
  STREAK_BONUS_CACHE_NAMESPACE,
  buildStreakBonusCacheKey,
  resolveStreakBonusCacheTtlMs,
} from "@/netlify/lib/streak-bonus-cache";
import {
  createPublicClient,
  loadStreakBonusCalculation,
  resolveProtocolTypeScriptFromEnv,
} from "@/netlify/lib/streak-bonus-loader";
import { createLogger } from "@/netlify/lib/log";

const MAX_RESULTS = 100;
const DEFAULT_RESULTS = 20;
const logger = createLogger("streakBonus-query");

class HttpHandledError extends Error {
  statusCode: number;
  errorCode: string;

  constructor(statusCode: number, errorCode: string, message?: string) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

type RequestPayload = {
  userAddress?: string;
  limit?: number;
  noCache?: boolean | string | number;
};

/**
 * POST /streakBonus-query
 *
 * Body: { userAddress, limit? }
 * Response: streak bonus eligibility details and unsigned transaction metadata.
 */
export const handler: Handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  if (!event.body) {
    return httpError(400, "missing_body", "Missing request body.");
  }

  let payload: RequestPayload;
  try {
    payload = JSON.parse(event.body) as RequestPayload;
  } catch (error) {
    return httpError(
      400,
      "invalid_json",
      `Invalid JSON payload: ${(error as Error).message}`
    );
  }

  const userAddress = payload.userAddress?.trim();
  if (!userAddress) {
    return httpError(400, "missing_user_address", "Expected 'userAddress'.");
  }

  const limit = sanitizeLimit(payload.limit);

  const network = deploymentManager.getCurrentNetwork();
  const rpcUrl =
    process.env.NEXT_PUBLIC_CKB_RPC_URL ||
    process.env.CKB_RPC_URL ||
    (network === "mainnet"
      ? "https://mainnet.ckb.dev"
      : "https://testnet.ckb.dev");

  const client = createPublicClient(network, rpcUrl);
  let addressObj: ccc.Address;
  try {
    addressObj = await ccc.Address.fromString(userAddress, client);
  } catch (error) {
    return httpError(
      400,
      "invalid_address",
      `Invalid CKB address: ${(error as Error).message}`
    );
  }

  const userLockScript = addressObj.script;

  const pointsCodeHash = deploymentManager.getContractCodeHash(
    network,
    "ckboostPointsUdt"
  );

  if (!pointsCodeHash) {
    return httpError(
      500,
      "missing_points_contract",
      "Points UDT contract not configured in deployments.json."
    );
  }

  const userTypeCodeHash = deploymentManager.getContractCodeHash(
    network,
    "ckboostUserType"
  );

  if (!userTypeCodeHash) {
    return httpError(
      500,
      "missing_user_contract",
      "User type contract not configured in deployments.json."
    );
  }

  const protocolTypeScript = resolveProtocolTypeScriptFromEnv();
  if ("error" in protocolTypeScript) {
    return httpError(500, "protocol_config_error", protocolTypeScript.error);
  }

  const pointsTypeScript = ccc.Script.from({
    codeHash: pointsCodeHash,
    hashType: "type" as ccc.HashType,
    args: protocolTypeScript.script.hash(),
  });

  const bypassCache = shouldBypassCache(event, payload);
  const cacheTtlMs = resolveStreakBonusCacheTtlMs();
  const protocolTypeHash = protocolTypeScript.script.hash().toLowerCase();
  const cacheKey = buildStreakBonusCacheKey({
    network,
    protocolTypeHash,
    userAddress,
    limit,
  });

  const cacheBinding =
    (context?.caches as { default?: unknown } | undefined)?.default ??
    context?.caches ??
    null;
  const waitUntil =
    typeof context?.waitUntil === "function"
      ? context.waitUntil.bind(context)
      : null;

  try {
    const { value: calculation, hit, metadata } = await withCache(
      cacheKey,
      async () => {
        try {
          return await loadStreakBonusCalculation({
            client,
            pointsTypeScript,
            userLockScript,
            userTypeCodeHash,
            limit,
            rpcUrl,
            address: userAddress,
            protocolTypeHash,
            network,
          });
        } catch (error) {
          throw new HttpHandledError(
            500,
            "transaction_query_failed",
            (error as Error).message
          );
        }
      },
      {
        namespace: STREAK_BONUS_CACHE_NAMESPACE,
        skipCache: bypassCache,
        ttlMs: cacheTtlMs,
        cacheBinding,
        waitUntil,
      }
    );

    const response: StreakBonusQueryResponse = {
      success: true,
      bonusStreak: calculation,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-CKBoost-Cache": hit ? "HIT" : "MISS",
      "X-CKBoost-Cache-Age": Math.max(metadata.ageMs, 0).toFixed(0),
    };

    if (metadata.ttlMs !== undefined) {
      headers["X-CKBoost-Cache-TTL"] = Math.round(metadata.ttlMs).toString();
    }

    if (bypassCache) {
      headers["X-CKBoost-Cache-Bypass"] = "1";
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response),
    };
  } catch (error) {
    if (error instanceof HttpHandledError) {
      logger.warn(error.errorCode, { message: error.message });
      return httpError(error.statusCode, error.errorCode, error.message);
    }

    const err = error as Error;
    logger.error("streak_bonus_evaluation_failed", err);
    return httpError(500, "streak_bonus_evaluation_failed", err.message);
  }
};

export default handler;

/**
 * Helper for producing a consistent JSON error payload.
 */
const httpError = (
  statusCode: number,
  error: string,
  message?: string
): { statusCode: number; headers: Record<string, string>; body: string } => {
  const payload: StreakBonusQueryResponse = {
    success: false,
    error,
    message,
  };
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
};

const shouldBypassCache = (
  event: HandlerEvent,
  payload: RequestPayload
): boolean => {
  if (isTruthy(event.queryStringParameters?.noCache)) {
    return true;
  }

  if (isTruthy(payload?.noCache)) {
    return true;
  }

  const headers = event.headers ?? {};
  const direct =
    headers["x-no-cache"] ??
    headers["X-No-Cache"] ??
    headers["x-cache-bypass"] ??
    headers["X-Cache-Bypass"];

  if (isTruthy(direct)) {
    return true;
  }

  const cacheControl =
    headers["cache-control"] ?? headers["Cache-Control"] ?? undefined;
  if (
    typeof cacheControl === "string" &&
    hasNoCacheDirective(cacheControl)
  ) {
    return true;
  }

  const pragma = headers["pragma"] ?? headers["Pragma"];
  if (typeof pragma === "string" && hasNoCacheDirective(pragma)) {
    return true;
  }

  return false;
};

const hasNoCacheDirective = (value: string): boolean => {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("no-cache") ||
    normalized.includes("no-store") ||
    /\bmax-age=0\b/.test(normalized)
  );
};

const isTruthy = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return false;
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    if (normalized === "false" || normalized === "0") return false;
    return ["1", "true", "yes", "y", "on"].includes(normalized);
  }
  return false;
};

/** Clamp incoming limit values to reasonable bounds for cell queries. */
const sanitizeLimit = (rawLimit: number | undefined): number => {
  const numeric = Number(rawLimit ?? DEFAULT_RESULTS);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return DEFAULT_RESULTS;
  }
  return Math.min(MAX_RESULTS, Math.floor(numeric));
};
