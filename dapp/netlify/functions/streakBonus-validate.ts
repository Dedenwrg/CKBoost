/**
 * Netlify function: validates and signs streak bonus transactions server-side.
 */
import type { Handler } from "@netlify/functions";
import { ccc } from "@ckb-ccc/shell";
import { deploymentManager, type Network } from "@/lib/ckb/deployment-manager";
import {
  fetchRewardTransactions,
  prepareBonusStreakTransaction,
  type PreparedBonusStreak,
  type RewardTransaction,
} from "@/netlify/lib/streak-bonus";

const MAX_RESULTS = 100;
const DEFAULT_RESULTS = 20;

type RequestPayload = {
  txHex?: string;
  userAddress?: string;
  limit?: number;
};

type StreakBonusValidateResponse =
  | {
      success: true;
      txHex: string;
      bonusStreak: PreparedBonusStreak["response"];
    }
  | {
      success: false;
      error: string;
      message?: string;
    };

/**
 * POST /streakBonus-validate
 *
 * Body: { userAddress, txHex, limit? }
 * Validates the provided unsigned transaction and returns a signed hex if eligible.
 */
export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const signingKey =
    process.env.STREAK_BONUS_PRIVATE_KEY ||
    process.env.TELEGRAM_AUTH_PRIVATE_KEY;

  if (!signingKey) {
    return httpError(
      500,
      "missing_signing_key",
      "Server signing key not configured."
    );
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

  const txHex = payload.txHex?.trim();
  const userAddress = payload.userAddress?.trim();
  if (!txHex) {
    return httpError(400, "missing_tx_hex", "Expected 'txHex'.");
  }
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
  const client = createClient(network, rpcUrl);

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

  const protocolTypeScript = resolveProtocolTypeScriptFromEnv();
  if ("error" in protocolTypeScript) {
    return httpError(
      500,
      "protocol_config_error",
      protocolTypeScript.error as string
    );
  }

  const pointsTypeScript = ccc.Script.from({
    codeHash: pointsCodeHash,
    hashType: "type" as ccc.HashType,
    args: protocolTypeScript.script.hash(),
  });

  let transactions: RewardTransaction[];
  try {
    transactions = await fetchRewardTransactions({
      client,
      pointsTypeScript,
      userLockScript,
      limit,
      logPrefix: "streakBonus-validate",
    });
  } catch (error) {
    return httpError(500, "transaction_query_failed", (error as Error).message);
  }

  let prepared: PreparedBonusStreak;
  try {
    prepared = await prepareBonusStreakTransaction({
      client,
      rpcUrl,
      address: userAddress,
      protocolTypeHash: protocolTypeScript.script.hash().toLowerCase(),
      network,
      userLockScript,
      pointsTypeScript,
      transactions,
    });
  } catch (error) {
    return httpError(
      500,
      "streak_bonus_preparation_failed",
      (error as Error).message
    );
  }

  if (!prepared.response.eligible) {
    return httpError(
      400,
      "bonus_streak_not_eligible",
      prepared.response.reason ?? "Bonus streak currently not eligible."
    );
  }

  const expectedTxHex = prepared.response.transaction?.txHex?.toLowerCase();
  if (!expectedTxHex || !prepared.transaction) {
    return httpError(
      500,
      "bonus_streak_missing_transaction",
      "Failed to prepare streak bonus transaction."
    );
  }

  if (expectedTxHex !== txHex.toLowerCase()) {
    return httpError(
      400,
      "transaction_mismatch",
      "Provided transaction does not match expected bonus streak transaction."
    );
  }

  let signedTx: ccc.Transaction;
  try {
    const signer = new ccc.SignerCkbPrivateKey(client, signingKey as ccc.Hex);
    signedTx = await signer.signTransaction(prepared.transaction);
  } catch (error) {
    return httpError(
      500,
      "signing_failed",
      `Failed to sign transaction: ${(error as Error).message}`
    );
  }

  const signedHex = ccc.hexFrom(signedTx.toBytes());
  const bonusStreak = {
    ...prepared.response,
    transaction: prepared.response.transaction
      ? {
          ...prepared.response.transaction,
          txHex: signedHex,
        }
      : undefined,
  };

  const response: StreakBonusValidateResponse = {
    success: true,
    txHex: signedHex,
    bonusStreak,
  };

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(response),
  };
};

export default handler;

/** Helper for returning consistent error payloads to the client. */
const httpError = (
  statusCode: number,
  error: string,
  message?: string
): { statusCode: number; headers: Record<string, string>; body: string } => {
  const payload: StreakBonusValidateResponse = {
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

/** Clamp incoming limit values to reasonable bounds for cell queries. */
const sanitizeLimit = (rawLimit: number | undefined): number => {
  const numeric = Number(rawLimit ?? DEFAULT_RESULTS);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return DEFAULT_RESULTS;
  }
  return Math.min(MAX_RESULTS, Math.floor(numeric));
};

/** Wrap public client instantiation so tests can stub this if needed. */
const createClient = (network: Network, url: string): ccc.Client => {
  if (network === "mainnet") {
    return new ccc.ClientPublicMainnet({ url });
  }
  return new ccc.ClientPublicTestnet({ url });
};

/** Build the protocol type script from the same env variables the dapp uses. */
const resolveProtocolTypeScriptFromEnv = ():
  | { script: ccc.Script }
  | { error: string } => {
  const protocolTypeCodeHash =
    process.env.NEXT_PUBLIC_PROTOCOL_TYPE_CODE_HASH?.trim();
  const protocolTypeHashType =
    (process.env.NEXT_PUBLIC_PROTOCOL_TYPE_HASH_TYPE?.trim() ||
      "type") as ccc.HashType;
  const protocolTypeArgs =
    process.env.NEXT_PUBLIC_PROTOCOL_TYPE_ARGS?.trim() || "";

  if (!protocolTypeCodeHash || !protocolTypeArgs) {
    return {
      error:
        "Protocol type environment variables missing. Ensure NEXT_PUBLIC_PROTOCOL_TYPE_CODE_HASH and NEXT_PUBLIC_PROTOCOL_TYPE_ARGS are set.",
    };
  }

  try {
    const script = ccc.Script.from({
      codeHash: protocolTypeCodeHash,
      hashType: protocolTypeHashType,
      args: protocolTypeArgs,
    });
    return { script };
  } catch (error) {
    return {
      error: `Failed to construct protocol type script from environment: ${
        (error as Error).message
      }`,
    };
  }
};
