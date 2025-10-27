import type { Handler } from "@netlify/functions";
import { ccc } from "@ckb-ccc/shell";
import { deploymentManager } from "@/lib/ckb/deployment-manager";
import { createLogger } from "@/netlify/lib/log";
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
import { deleteCache, withCache } from "@/netlify/lib/cache";
import type { BonusStreakCalculation } from "@/netlify/lib/streak-bonus";

const logger = createLogger("cache-refresh");
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

type SupportedTarget = "streakBonus";

type RefreshPayload = {
  target?: SupportedTarget;
  action?: string;
  userAddress?: string;
  limit?: number;
};

type RefreshResponse =
  | {
      success: true;
      target: SupportedTarget;
      action: "refresh";
      cacheKey: string;
      namespace: string;
      cache: {
        ttlMs?: number;
        createdAt: number;
        ageMs: number;
      };
      bonusStreak: BonusStreakCalculation;
    }
  | {
      success: true;
      target: SupportedTarget;
      action: "invalidate";
      cacheKey: string;
      namespace: string;
      deleted: boolean;
    }
  | {
      success: false;
      error: string;
      message?: string;
    };

export const handler: Handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  if (!event.body) {
    return jsonError(400, "missing_body", "Expected JSON body.");
  }

  let payload: RefreshPayload;
  try {
    payload = JSON.parse(event.body) as RefreshPayload;
  } catch (error) {
    return jsonError(
      400,
      "invalid_json",
      `Invalid JSON payload: ${(error as Error).message}`
    );
  }

  const target = payload.target ?? "streakBonus";

  if (target !== "streakBonus") {
    return jsonError(
      400,
      "unsupported_target",
      `Unsupported cache target '${payload.target}'.`
    );
  }

  const rawAction = (payload.action ?? "refresh")
    .toString()
    .toLowerCase() as "refresh" | "invalidate" | string;

  if (rawAction !== "refresh" && rawAction !== "invalidate") {
    return jsonError(
      400,
      "unsupported_action",
      `Unsupported action '${payload.action}'.`
    );
  }
  const action = rawAction as "refresh" | "invalidate";

  const userAddress = payload.userAddress?.trim();
  if (!userAddress) {
    return jsonError(
      400,
      "missing_user_address",
      "Expected 'userAddress' for streak bonus cache refresh."
    );
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
    return jsonError(
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
    return jsonError(
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
    return jsonError(
      500,
      "missing_user_contract",
      "User type contract not configured in deployments.json."
    );
  }

  const protocolTypeScript = resolveProtocolTypeScriptFromEnv();
  if ("error" in protocolTypeScript) {
    return jsonError(
      500,
      "protocol_config_error",
      protocolTypeScript.error
    );
  }

  const pointsTypeScript = ccc.Script.from({
    codeHash: pointsCodeHash,
    hashType: "type" as ccc.HashType,
    args: protocolTypeScript.script.hash(),
  });

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

  if (action === "invalidate") {
    const deleted = await deleteCache(cacheKey, {
      namespace: STREAK_BONUS_CACHE_NAMESPACE,
      cacheBinding,
    });

    const response: RefreshResponse = {
      success: true,
      target,
      action: "invalidate",
      cacheKey,
      namespace: STREAK_BONUS_CACHE_NAMESPACE,
      deleted,
    };

    return {
      statusCode: 200,
      headers: buildHeaders(cacheKey, { action }),
      body: JSON.stringify(response),
    };
  }

  const cacheTtlMs = resolveStreakBonusCacheTtlMs();

  try {
    const result = await withCache(
      cacheKey,
      async () =>
        loadStreakBonusCalculation({
          client,
          pointsTypeScript,
          userLockScript,
          userTypeCodeHash,
          limit,
          rpcUrl,
          address: userAddress,
          protocolTypeHash,
          network,
        }),
      {
        namespace: STREAK_BONUS_CACHE_NAMESPACE,
        skipCache: true,
        ttlMs: cacheTtlMs,
        cacheBinding,
        waitUntil,
      }
    );

    const response: RefreshResponse = {
      success: true,
      target,
      action: "refresh",
      cacheKey,
      namespace: STREAK_BONUS_CACHE_NAMESPACE,
      cache: {
        ttlMs: result.metadata.ttlMs,
        createdAt: result.metadata.createdAt,
        ageMs: result.metadata.ageMs,
      },
      bonusStreak: result.value,
    };

    return {
      statusCode: 200,
      headers: buildHeaders(cacheKey, {
        ttlMs: result.metadata.ttlMs,
        action,
      }),
      body: JSON.stringify(response),
    };
  } catch (error) {
    logger.error("cache_refresh_failed", error);
    return jsonError(
      500,
      "cache_refresh_failed",
      (error as Error).message ?? "Failed to refresh cache."
    );
  }
};

const sanitizeLimit = (rawLimit: number | undefined): number => {
  const numeric = Number(rawLimit ?? DEFAULT_LIMIT);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, Math.floor(numeric));
};

const buildHeaders = (
  cacheKey: string,
  extra: { ttlMs?: number; action: "refresh" | "invalidate" }
): Record<string, string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-CKBoost-Cache-Key": cacheKey,
    "X-CKBoost-Cache-Namespace": STREAK_BONUS_CACHE_NAMESPACE,
    "X-CKBoost-Cache-Action": extra.action.toUpperCase(),
  };

  if (typeof extra.ttlMs === "number") {
    headers["X-CKBoost-Cache-TTL"] = Math.round(extra.ttlMs).toString();
  }

  return headers;
};

const jsonError = (
  statusCode: number,
  error: string,
  message?: string
): { statusCode: number; headers: Record<string, string>; body: string } => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ success: false, error, message }),
});

export default handler;
