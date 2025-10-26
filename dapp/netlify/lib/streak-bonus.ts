/**
 * Shared helpers for streak bonus evaluation and transaction assembly.
 * The Netlify handlers reuse these utilities to expose query and validation APIs.
 */
import { ccc } from "@ckb-ccc/shell";
import { deploymentManager, Network } from "@/lib/ckb/deployment-manager";
import { fetchProtocolCell } from "@/netlify/lib/utils";
import { getLatestUserCellByLock } from "@/netlify/lib/utils";

import { ProtocolData, UserData, type UserDataLike } from "ssri-ckboost/types";

export type RewardTransaction = {
  txHash: string;
  blockNumber: string | null;
  txIndex: string | null;
  netPoints: string;
  outputs: Array<{ index: number; amount: string }>;
  inputs: Array<{ index: number; amount: string }>;
};

export type BonusStreakResponse = {
  eligible: boolean;
  intervalsEvaluated: number;
  bonusAmount: string;
  bonusPerInterval: string;
  lastBonusTimestamp: string;
  updatedLastBonusTimestamp?: string;
  reason?: string;
  transaction?: BonusStreakTransaction;
};

export type BonusStreakTransaction = {
  txHex: string;
  bonusAmount: string;
  intervals: number;
  inputIndexes: {
    user: number;
    points: number;
    proxy: number;
  };
  outputIndexes: {
    user: number;
    points: number;
    proxy: number;
  };
  metadata: {
    feePaid: string;
    updatedPointsBalance: string;
  };
};

export type BonusStreakContext = {
  signer: ccc.Signer;
  rpcUrl: string;
  address: string;
  protocolTypeHash: string;
  network: string;
  userLockScript: ccc.Script;
  pointsTypeScript: ccc.Script;
  transactions: RewardTransaction[];
};

export type PreparedBonusStreak = {
  response: BonusStreakResponse;
  transaction?: ccc.Transaction;
};

export type StreakBonusQueryResponse =
  | {
      success: true;
      bonusStreak: BonusStreakResponse;
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
      bonusStreak: BonusStreakResponse;
    }
  | {
      success: false;
      error: string;
      message?: string;
    };

/** Memoizes block timestamps while scanning reward history to avoid duplicate RPC calls. */
const blockTimestampCache = new Map<string, bigint>();

const interpretIntervalMs = (raw: bigint): bigint => {
  if (raw <= 0n) return 0n;
  // Heuristic: values larger than ~1e12 are already in ms.
  return raw > 1_000_000_000_000n ? raw : raw * 1000n;
};

const cloneUserData = (
  userData: ReturnType<typeof UserData.decode>
): UserDataLike => {
  return {
    verification_data: {
      telegram_personal_chat_id: ccc.numFrom(
        userData.verification_data.telegram_personal_chat_id
      ),
      identity_verification_data:
        userData.verification_data.identity_verification_data,
    },
    total_points_earned: ccc.numFrom(userData.total_points_earned),
    last_activity_timestamp: ccc.numFrom(userData.last_activity_timestamp),
    submission_records: userData.submission_records.map((record) => ({
      campaign_type_id: ccc.hexFrom(record.campaign_type_id),
      quest_id: ccc.numFrom(record.quest_id),
      submission_timestamp: ccc.numFrom(record.submission_timestamp),
      submission_content: record.submission_content,
    })),
    profile_data: userData.profile_data.map((entry) => ccc.hexFrom(entry)),
    last_bonus_streak_at: ccc.numFrom(userData.last_bonus_streak_at),
  } satisfies UserDataLike;
};

/**
 * Parse the 128-bit little-endian points amount from a UDT data buffer.
 */
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

/**
 * Resolve a block's timestamp, leveraging an in-memory cache for repeat lookups.
 */
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
      console.warn(
        `[streak-bonus] Failed to fetch block ${blockNumber}: HTTP ${response.status}`
      );
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
    console.warn(
      `[streak-bonus] Failed to query block ${blockNumber} timestamp:`,
      error
    );
    return null;
  }
};

/**
 * Read the streak bonus fee from env with conservative defaults and validation.
 */
export const parseFeeFromEnv = (): bigint => {
  const explicit =
    process.env.STREAK_BONUS_FEE || process.env.NEXT_PUBLIC_STREAK_BONUS_FEE;
  if (!explicit) {
    return 1_000n;
  }
  try {
    const parsed = BigInt(explicit);
    return parsed >= 0n ? parsed : 1_000n;
  } catch (error) {
    console.warn(
      `[streak-bonus] Invalid STREAK_BONUS_FEE value (${explicit}), falling back to 1000n`
    );
    return 1_000n;
  }
};

/** Locate the proxy authenticator cell used for server authorization in streak bonus flows. */
const findProxyAuthenticationCell = async (
  client: ccc.Client
): Promise<ccc.Cell | null> => {
  const proxyAddress =
    process.env.STREAK_BONUS_PROXY_ADDRESS ||
    process.env.NEXT_PUBLIC_API_AUTHENTICATOR_ADDRESS;

  if (!proxyAddress) {
    console.warn(
      "[streak-bonus] Proxy authenticator address is not configured in environment variables"
    );
    return null;
  }

  try {
    const addressObj = await ccc.Address.fromString(proxyAddress, client);
    for await (const cell of client.findCellsByLock(
      addressObj.script,
      null,
      false
    )) {
      if (!cell.cellOutput.type) {
        return cell;
      }
    }
  } catch (error) {
    console.warn(
      "[streak-bonus] Failed to locate proxy authenticator cell:",
      error
    );
    return null;
  }

  return null;
};

/**
 * Determine streak bonus eligibility and assemble the unsigned transaction payload.
 * Returns explanatory metadata, and when eligible, the unsigned transaction object.
 */
export const prepareBonusStreakTransaction = async (
  ctx: BonusStreakContext
): Promise<PreparedBonusStreak> => {
  const base: BonusStreakResponse = {
    eligible: false,
    intervalsEvaluated: 0,
    bonusAmount: "0",
    bonusPerInterval: "0",
    lastBonusTimestamp: "0",
  };

  let protocolCell: ccc.Cell | null = null;
  try {
    protocolCell = await fetchProtocolCell(ctx.signer.client);
  } catch (error) {
    base.reason = (error as Error).message;
    return { response: base };
  }

  if (!protocolCell) {
    base.reason = "Protocol cell not found";
    return { response: base };
  }

  let protocolData: ReturnType<typeof ProtocolData.decode>;
  try {
    protocolData = ProtocolData.decode(protocolCell.outputData);
  } catch (error) {
    base.reason = "Failed to decode protocol data";
    return { response: base };
  }

  const streakIntervalRaw = ccc.numFrom(
    protocolData.protocol_config.streak_bonus_interval ?? 0n
  );
  const streakBonusPerInterval = ccc.numFrom(
    protocolData.protocol_config.streak_bonus_amount ?? 0n
  );

  base.bonusPerInterval = streakBonusPerInterval.toString();

  const intervalMs = interpretIntervalMs(streakIntervalRaw);
  if (intervalMs <= 0n) {
    base.reason = "Streak bonus interval is not configured";
    return { response: base };
  }

  if (streakBonusPerInterval <= 0n) {
    base.reason = "Streak bonus amount is zero";
    return { response: base };
  }
  const network = ctx.network as Network;
  const userTypeCodeHash = deploymentManager.getContractCodeHash(
    network,
    "ckboostUserType"
  );

  if (!userTypeCodeHash) {
    base.reason = "User type contract not configured";
    return { response: base };
  }

  const userCell = await getLatestUserCellByLock(
    ctx.userLockScript,
    userTypeCodeHash,
    ctx.signer,
    ccc.hexFrom(ctx.protocolTypeHash)
  );

  if (!userCell) {
    base.reason = "User cell not found";
    return { response: base };
  }

  const userData = UserData.decode(userCell.outputData);
  if (!userData) {
    base.reason = "Unable to parse user data";
    return { response: base };
  }

  const userDataLike = cloneUserData(userData);
  const lastBonusAt = ccc.numFrom(userDataLike.last_bonus_streak_at ?? 0n);
  base.lastBonusTimestamp = lastBonusAt.toString();

  const timestampedRewards: bigint[] = [];

  for (const tx of ctx.transactions) {
    if (!tx.blockNumber) continue;
    const timestamp = await getBlockTimestamp(ctx.rpcUrl, tx.blockNumber);
    if (!timestamp) continue;
    if (timestamp > lastBonusAt) {
      timestampedRewards.push(timestamp);
    }
  }

  if (timestampedRewards.length === 0) {
    base.reason = "No qualifying rewards since last streak bonus";
    return { response: base };
  }

  timestampedRewards.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  let anchor = lastBonusAt;
  let intervalsAccumulated = 0n;

  for (const rewardTimestamp of timestampedRewards) {
    if (rewardTimestamp <= anchor) continue;
    const elapsed = rewardTimestamp - anchor;
    const intervals = elapsed / intervalMs;
    if (intervals > 0n) {
      intervalsAccumulated += intervals;
      anchor += intervals * intervalMs;
    }
  }

  const intervalsEvaluated = Number(intervalsAccumulated);
  base.intervalsEvaluated = intervalsEvaluated;

  if (intervalsAccumulated < 2n) {
    base.reason = "Bonus streak requires at least two intervals";
    return { response: base };
  }

  const bonusAmount = streakBonusPerInterval * intervalsAccumulated;
  base.bonusAmount = bonusAmount.toString();

  const pointsCellIterator = ctx.signer.client.findCells({
    script: ctx.pointsTypeScript,
    scriptType: "type" as const,
    scriptSearchMode: "exact" as const,
    filter: {
      script: ctx.userLockScript,
    },
    withData: true,
  });

  const pointsCellResult = await pointsCellIterator.next();
  const pointsCell = pointsCellResult.value;
  if (!pointsCell) {
    base.reason = "User Points UDT cell not found";
    return { response: base };
  }

  const currentPointsBalance = readUdtAmount(pointsCell.outputData);
  const updatedPointsBalance = currentPointsBalance + bonusAmount;

  const fee = parseFeeFromEnv();
  const userInputCapacity = ccc.numFrom(userCell.cellOutput.capacity);
  if (userInputCapacity <= fee) {
    base.reason = "Insufficient capacity to pay transaction fee";
    return { response: base };
  }

  const userOutputCapacity = userInputCapacity - fee;

  userDataLike.total_points_earned = ccc.numFrom(
    ccc.numFrom(userDataLike.total_points_earned) + bonusAmount
  );
  userDataLike.last_bonus_streak_at = ccc.numFrom(anchor);
  userDataLike.last_activity_timestamp = ccc.numFrom(Date.now());

  const updatedUserDataHex = ccc.hexFrom(UserData.encode(userDataLike));
  const updatedPointsDataHex = ccc.hexFrom(
    ccc.numToBytes(updatedPointsBalance, 16)
  );

  const proxyCell = await findProxyAuthenticationCell(ctx.signer.client);
  if (!proxyCell) {
    base.reason = "Proxy authentication cell unavailable";
    return { response: base };
  }

  const tx = ccc.Transaction.from({});

  await tx.addInput(userCell);
  const userInputIndex = tx.inputs.length - 1;

  await tx.addInput(pointsCell);
  const pointsInputIndex = tx.inputs.length - 1;

  await tx.addInput(proxyCell);
  const proxyInputIndex = tx.inputs.length - 1;

  await tx.addOutput(
    ccc.CellOutput.from({
      capacity: userOutputCapacity,
      lock: userCell.cellOutput.lock,
      type: userCell.cellOutput.type,
    }),
    updatedUserDataHex
  );
  const userOutputIndex = tx.outputs.length - 1;

  await tx.addOutput(
    ccc.CellOutput.from({
      capacity: pointsCell.cellOutput.capacity,
      lock: pointsCell.cellOutput.lock,
      type: pointsCell.cellOutput.type,
    }),
    updatedPointsDataHex
  );
  const pointsOutputIndex = tx.outputs.length - 1;

  await tx.addOutput(
    ccc.CellOutput.from({
      capacity: proxyCell.cellOutput.capacity,
      lock: proxyCell.cellOutput.lock,
    }),
    proxyCell.outputData ?? "0x"
  );
  const proxyOutputIndex = tx.outputs.length - 1;

  const contractNames = [
    "ckboostUserType",
    "ckboostPointsUdt",
    "ckboostProtocolType",
  ] as const;

  for (const name of contractNames) {
    const outPoint = deploymentManager.getContractOutPoint(network, name);
    if (outPoint) {
      tx.addCellDeps({
        outPoint: {
          txHash: outPoint.txHash,
          index: outPoint.index,
        },
        depType: "code",
      });
    }
  }

  while (tx.witnesses.length < tx.inputs.length) {
    tx.witnesses.push("0x");
  }

  const txHex = ccc.hexFrom(tx.toBytes());

  base.eligible = true;
  base.updatedLastBonusTimestamp = anchor.toString();
  base.transaction = {
    txHex,
    bonusAmount: bonusAmount.toString(),
    intervals: intervalsEvaluated,
    inputIndexes: {
      user: userInputIndex,
      points: pointsInputIndex,
      proxy: proxyInputIndex,
    },
    outputIndexes: {
      user: userOutputIndex,
      points: pointsOutputIndex,
      proxy: proxyOutputIndex,
    },
    metadata: {
      feePaid: fee.toString(),
      updatedPointsBalance: updatedPointsBalance.toString(),
    },
  };

  return { response: base, transaction: tx };
};

/**
 * Collect reward transactions grouped by transfer, returning net point deltas for streak calculations.
 */
export const fetchRewardTransactions = async ({
  client,
  pointsTypeScript,
  userLockScript,
  limit,
  logPrefix = "streak-bonus",
}: {
  client: ccc.Client;
  pointsTypeScript: ccc.Script;
  userLockScript: ccc.Script;
  limit: number;
  logPrefix?: string;
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

  try {
    for await (const tx of client.findTransactions(
      searchKey,
      "desc",
      pageSize
    )) {
      matches.push(tx);
      if (matches.length >= limit) {
        break;
      }
    }
  } catch (error) {
    throw new Error(
      `Failed to query transactions: ${(error as Error).message}`
    );
  }

  const responseTransactions: RewardTransaction[] = [];

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

      for (const cell of inputCells) {
        const index = Number(cell.cellIndex);
        const input = tx.inputs[index];
        if (!input) continue;
        try {
          const previous = await input.getCell(client);
          if (!previous) continue;
          const amount = readUdtAmount(previous.outputData);
          inputTotal += amount;
          inputs.push({ index, amount: amount.toString() });
        } catch (error) {
          console.warn(
            `[${logPrefix}] Failed to load input cell for tx ${match.txHash} index ${index}:`,
            error
          );
        }
      }

      const netPoints = outputTotal - inputTotal;
      if (netPoints <= 0n) {
        continue;
      }

      responseTransactions.push({
        txHash: match.txHash,
        blockNumber: match.blockNumber ? match.blockNumber.toString() : null,
        txIndex: match.txIndex ? match.txIndex.toString() : null,
        netPoints: netPoints.toString(),
        outputs,
        inputs,
      });
    } catch (error) {
      console.warn(
        `[${logPrefix}] Failed to process transaction ${match.txHash}`,
        error
      );
    }
  }

  return responseTransactions;
};
