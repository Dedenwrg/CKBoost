import { ccc } from "@ckb-ccc/shell";
import { deploymentManager } from "@/lib/ckb/deployment-manager";
import { createLogger } from "@/netlify/lib/log";

const log = createLogger("streak-bonus");
import {
  fetchProtocolCell,
  getLatestUserCellByAddressWithClient,
} from "@/netlify/lib/utils";
import { ProtocolData, UserData } from "ssri-ckboost/types";

export type RewardTransaction = {
  txHash: string;
  blockNumber: string | null;
  txIndex: string | null;
  netPoints: string;
  outputs: Array<{ index: number; amount: string }>;
  inputs: Array<{ index: number; amount: string }>;
  isStreakBonus?: boolean;
};

export type StreakInterval = {
  startTimestamp: string;
  endTimestamp: string;
  intervalIndex: number;
};

export type BonusStreakCalculation = {
  eligible: boolean;
  bonusPerInterval: string;
  totalIntervals: number;
  bonusAmount: string;
  lastBonusTimestamp: string;
  updatedLastBonusTimestamp?: string;
  intervals: StreakInterval[];
  reason?: string;
};

export type StreakBonusQueryResponse =
  | {
      success: true;
      bonusStreak: BonusStreakCalculation;
    }
  | {
      success: false;
      error: string;
      message?: string;
    };

export type StreakBonusValidateResponse =
  | {
      success: true;
      txHex: string;
      bonusStreak: BonusStreakCalculation;
    }
  | {
      success: false;
      error: string;
      message?: string;
    };

export type BonusStreakEvaluationContext = {
  client: ccc.Client;
  rpcUrl: string;
  address: string;
  protocolTypeHash: string;
  network: string;
  userLockScript: ccc.Script;
  transactions: RewardTransaction[];
};

const blockTimestampCache = new Map<string, bigint>();

const interpretIntervalMs = (raw: bigint): bigint => {
  if (raw <= 0n) return 0n;
  return raw > 1_000_000_000_000n ? raw : raw * 1000n;
};

export const readUdtAmount = (data: ccc.HexLike | undefined | null): bigint => {
  if (!data) return 0n;
  const hex = ccc.hexFrom(data);
  if (hex === "0x" || hex.length < 34) {
    return 0n;
  }
  const bytes = ccc.bytesFrom(hex);
  if (bytes.length < 16) {
    return 0n;
  }
  const slice = bytes.subarray(0, 16);
  return ccc.numLeFromBytes(slice);
};

export const getBlockTimestamp = async (
  rpcUrl: string,
  blockNumber: string
): Promise<bigint | null> => {
  if (!blockNumber) return null;
  const cached = blockTimestampCache.get(blockNumber);
  if (cached !== undefined) {
    return cached;
  }

  const hexBlockNumber = `0x${BigInt(blockNumber).toString(16)}`;

  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "get_block_by_number",
        params: [hexBlockNumber],
      }),
    });

    if (!response.ok) {
      log.warn(`Failed to fetch block ${blockNumber}: HTTP ${response.status}`);
      return null;
    }

    const payload = (await response.json()) as {
      result?: { header?: { timestamp?: string } };
    };

    const timestampHex = payload.result?.header?.timestamp;
    if (!timestampHex || timestampHex === "0x") {
      return null;
    }

    const timestamp = BigInt(timestampHex);
    blockTimestampCache.set(blockNumber, timestamp);
    return timestamp;
  } catch (error) {
    log.warn(`Failed to query block ${blockNumber} timestamp:`, error);
    return null;
  }
};

export const evaluateStreakBonus = async (
  ctx: BonusStreakEvaluationContext
): Promise<BonusStreakCalculation> => {
  const base: BonusStreakCalculation = {
    eligible: false,
    bonusPerInterval: "0",
    totalIntervals: 0,
    bonusAmount: "0",
    lastBonusTimestamp: "0",
    intervals: [],
  };

  const protocolCell = await fetchProtocolCell(ctx.client);
  if (!protocolCell) {
    return {
      ...base,
      reason: "Protocol cell not found",
    };
  }

  let protocolData: ReturnType<typeof ProtocolData.decode>;
  try {
    protocolData = ProtocolData.decode(protocolCell.outputData);
  } catch (error) {
    return {
      ...base,
      reason: "Failed to decode protocol data",
    };
  }

  const streakIntervalRaw = ccc.numFrom(
    protocolData.protocol_config.streak_bonus_interval ?? 0n
  );
  const streakBonusPerInterval = ccc.numFrom(
    protocolData.protocol_config.streak_bonus_amount ?? 0n
  );

  const intervalMs = interpretIntervalMs(streakIntervalRaw);
  if (intervalMs <= 0n) {
    return {
      ...base,
      bonusPerInterval: streakBonusPerInterval.toString(),
      reason: "Streak bonus interval is not configured",
    };
  }

  if (streakBonusPerInterval <= 0n) {
    return {
      ...base,
      bonusPerInterval: streakBonusPerInterval.toString(),
      reason: "Streak bonus amount is zero",
    };
  }

  const network = deploymentManager.getCurrentNetwork();

  const userTypeCodeHash = deploymentManager.getContractCodeHash(
    network,
    "ckboostUserType"
  );
  if (!userTypeCodeHash) {
    return {
      ...base,
      bonusPerInterval: streakBonusPerInterval.toString(),
      reason: "User type contract not configured",
    };
  }

  const userCell = await getLatestUserCellByAddressWithClient(
    ctx.address,
    ctx.client,
    userTypeCodeHash,
    ccc.hexFrom(ctx.protocolTypeHash)
  );

  if (!userCell) {
    return {
      ...base,
      bonusPerInterval: streakBonusPerInterval.toString(),
      reason: "User cell not found",
    };
  }

  let userData: ReturnType<typeof UserData.decode>;
  try {
    userData = UserData.decode(userCell.outputData);
  } catch (error) {
    return {
      ...base,
      bonusPerInterval: streakBonusPerInterval.toString(),
      reason: "Unable to parse user data",
    };
  }

  const lastBonusAt = ccc.numFrom(userData.last_bonus_streak_at ?? 0n);
  base.lastBonusTimestamp = lastBonusAt.toString();

  const rewardTimestamps: bigint[] = [];

  for (const tx of ctx.transactions) {
    if (tx.isStreakBonus) continue;
    if (!tx.blockNumber) continue;
    const timestamp = await getBlockTimestamp(ctx.rpcUrl, tx.blockNumber);
    if (!timestamp) continue;
    if (timestamp > lastBonusAt) {
      rewardTimestamps.push(timestamp);
    }
  }

  if (rewardTimestamps.length === 0) {
    return {
      ...base,
      bonusPerInterval: streakBonusPerInterval.toString(),
      reason: "No qualifying rewards since last streak bonus",
    };
  }

  rewardTimestamps.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const eligibleIntervals: StreakInterval[] = [];
  let currentSequence: bigint[] = [];
  let sequenceIndex = 0;

  const flushSequence = () => {
    if (currentSequence.length >= 2) {
      for (let i = 1; i < currentSequence.length; i += 1) {
        eligibleIntervals.push({
          startTimestamp: currentSequence[i - 1].toString(),
          endTimestamp: currentSequence[i].toString(),
          intervalIndex: sequenceIndex,
        });
      }
      sequenceIndex += 1;
    }
    currentSequence = [];
  };

  for (const timestamp of rewardTimestamps) {
    if (currentSequence.length === 0) {
      currentSequence.push(timestamp);
      continue;
    }

    const previous = currentSequence[currentSequence.length - 1];
    if (timestamp - previous <= intervalMs) {
      currentSequence.push(timestamp);
    } else {
      flushSequence();
      currentSequence.push(timestamp);
    }
  }
  flushSequence();

  const totalIntervals = eligibleIntervals.length;
  if (totalIntervals < 2) {
    return {
      ...base,
      bonusPerInterval: streakBonusPerInterval.toString(),
      intervals: eligibleIntervals,
      totalIntervals,
      reason: "Bonus streak requires at least two consecutive intervals",
    };
  }

  const bonusAmount = streakBonusPerInterval * BigInt(totalIntervals);
  const updatedLastBonusTimestamp =
    eligibleIntervals[eligibleIntervals.length - 1].endTimestamp;

  return {
    eligible: true,
    bonusPerInterval: streakBonusPerInterval.toString(),
    totalIntervals,
    bonusAmount: bonusAmount.toString(),
    lastBonusTimestamp: lastBonusAt.toString(),
    updatedLastBonusTimestamp,
    intervals: eligibleIntervals,
  };
};

export const decodeUserData = (data: ccc.HexLike) => UserData.decode(data);
