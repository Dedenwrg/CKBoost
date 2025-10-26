/**
 * Netlify function: returns streak bonus eligibility metadata and unsigned transaction.
 */
import type { Handler } from "@netlify/functions";
import { ccc } from "@ckb-ccc/shell";
import { deploymentManager, type Network } from "@/lib/ckb/deployment-manager";
import {
  evaluateStreakBonus,
  readUdtAmount,
  type BonusStreakCalculation,
  type RewardTransaction,
  type StreakBonusQueryResponse,
} from "@/netlify/lib/streak-bonus";
import { UserData } from "ssri-ckboost/types";

const MAX_RESULTS = 100;
const DEFAULT_RESULTS = 20;

type RequestPayload = {
  userAddress?: string;
  limit?: number;
};

/**
 * POST /streakBonus-query
 *
 * Body: { userAddress, limit? }
 * Response: streak bonus eligibility details and unsigned transaction metadata.
 */
export const handler: Handler = async (event) => {
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

  let transactions: RewardTransaction[];
  try {
    transactions = await fetchRewardTransactions({
      client,
      pointsTypeScript,
      userLockScript,
      userTypeCodeHash,
      limit,
    });
  } catch (error) {
    return httpError(500, "transaction_query_failed", (error as Error).message);
  }

  let calculation: BonusStreakCalculation;
  try {
    calculation = await evaluateStreakBonus({
      client,
      rpcUrl,
      address: userAddress,
      protocolTypeHash: protocolTypeScript.script.hash().toLowerCase(),
      network,
      userLockScript,
      transactions,
    });

    const response: StreakBonusQueryResponse = {
      success: true,
      bonusStreak: calculation,
    };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(response),
    };
  } catch (error) {
    return httpError(
      500,
      "streak_bonus_evaluation_failed",
      (error as Error).message
    );
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

const fetchRewardTransactions = async ({
  client,
  pointsTypeScript,
  userLockScript,
  userTypeCodeHash,
  limit,
}: {
  client: ccc.Client;
  pointsTypeScript: ccc.Script;
  userLockScript: ccc.Script;
  userTypeCodeHash: string;
  limit: number;
}): Promise<RewardTransaction[]> => {
  const searchKey = {
    script: pointsTypeScript,
    scriptType: "type" as const,
    scriptSearchMode: "exact" as const,
    filter: {
      script: userLockScript,
    },
    groupByTransaction: true as const,
  };

  const pageSize = Math.min(limit, 50);
  const matches: Array<{
    txHash: string;
    blockNumber: bigint | null;
    txIndex: bigint | null;
    cells: Array<{ isInput: boolean; cellIndex: bigint }>;
  }> = [];

  for await (const tx of client.findTransactions(searchKey, "desc", pageSize)) {
    matches.push(tx);
    if (matches.length >= limit) {
      break;
    }
  }

  const responseTransactions: RewardTransaction[] = [];

  const lowerUserTypeHash = userTypeCodeHash.toLowerCase();
  const expectedUserLockHash = userLockScript.hash().toLowerCase();

  const scriptEquals = (scriptA: ccc.Script | undefined, scriptB: ccc.Script) => {
    if (!scriptA) return false;
    try {
      return scriptA.hash().toLowerCase() === scriptB.hash().toLowerCase();
    } catch {
      return false;
    }
  };

  for (const match of matches) {
    try {
      const txResponse = await client.getTransaction(match.txHash);
      if (!txResponse) {
        continue;
      }
      const tx = txResponse.transaction;

      const outputCells = match.cells.filter((cell) => !cell.isInput);
      const inputCells = match.cells.filter((cell) => cell.isInput);

      let outputTotal = 0n;
      const outputs = outputCells.map((cell) => {
        const index = Number(cell.cellIndex);
        const data = tx.outputsData[index];
        const amount = readUdtAmount(data);
        outputTotal += amount;
        return { index, amount: amount.toString() };
      });

      let inputTotal = 0n;
      const inputs: Array<{ index: number; amount: string }> = [];
      const inputCellCache = new Map<number, ccc.Cell>();

      for (const cell of inputCells) {
        const index = Number(cell.cellIndex);
        const input = tx.inputs[index];
        if (!input) continue;
        try {
          const previous = await input.getCell(client);
          if (!previous) continue;
          inputCellCache.set(index, previous);
          const amount = readUdtAmount(previous.outputData);
          inputTotal += amount;
          inputs.push({ index, amount: amount.toString() });
        } catch (error) {
          console.warn(
            `[streakBonus-query] Failed to load input cell for tx ${match.txHash} index ${index}:`,
            error
          );
        }
      }

      const netPoints = outputTotal - inputTotal;
      if (netPoints <= 0n) {
        continue;
      }

      let isStreakBonus = false;

      for (const cell of outputCells) {
        const index = Number(cell.cellIndex);
        const output = tx.outputs[index];
        if (!output?.type) continue;
        if (output.type.codeHash.toLowerCase() !== lowerUserTypeHash) continue;
        if (!scriptEquals(output.lock, userLockScript)) continue;

        const outputDataHex = tx.outputsData[index];
        if (!outputDataHex) break;

        let previousUserDataHex: ccc.HexLike | undefined;
        for (const [inputIndex, cached] of inputCellCache.entries()) {
          const inputType = cached.cellOutput.type;
          if (!inputType) continue;
          if (inputType.codeHash.toLowerCase() !== lowerUserTypeHash) continue;
          if (cached.cellOutput.lock.hash().toLowerCase() !== expectedUserLockHash)
            continue;
          previousUserDataHex = cached.outputData;
          break;
        }

        if (!previousUserDataHex) {
          break;
        }

        try {
          const previousUserData = UserData.decode(previousUserDataHex);
          const nextUserData = UserData.decode(outputDataHex as ccc.HexLike);
          const prevLast = ccc.numFrom(previousUserData.last_bonus_streak_at ?? 0n);
          const nextLast = ccc.numFrom(nextUserData.last_bonus_streak_at ?? 0n);
          if (nextLast > prevLast) {
            isStreakBonus = true;
            break;
          }
        } catch (error) {
          console.warn(
            `[streakBonus-query] Failed to decode user data for streak detection in tx ${match.txHash}`,
            error
          );
        }
      }

      responseTransactions.push({
        txHash: match.txHash,
        blockNumber: match.blockNumber ? match.blockNumber.toString() : null,
        txIndex: match.txIndex ? match.txIndex.toString() : null,
        netPoints: netPoints.toString(),
        outputs,
        inputs,
        isStreakBonus,
      });
    } catch (error) {
      console.warn(
        `[streakBonus-query] Failed to process transaction ${match.txHash}`,
        error
      );
    }
  }

  return responseTransactions;
};
