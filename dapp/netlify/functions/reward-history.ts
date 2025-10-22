import type { Handler } from "@netlify/functions";
import { ccc } from "@ckb-ccc/shell";
import { deploymentManager } from "@/lib/ckb/deployment-manager";
import { fetchProtocolCell } from "@/lib/ckb/protocol-cells";
import {
  getLatestUserCellByAddress,
  parseUserData,
} from "@/lib/ckb/user-cells";
import { ProtocolData, UserData, type UserDataLike } from "ssri-ckboost/types";

type JsonResponse = {
  address: string;
  protocolTypeHash: string;
  pointsTypeScript: {
    codeHash: string;
    hashType: ccc.HashType;
    args: string;
  };
  transactions: Array<{
    txHash: string;
    blockNumber: string | null;
    txIndex: string | null;
    netPoints: string;
    outputs: Array<{ index: number; amount: string }>;
    inputs: Array<{ index: number; amount: string }>;
  }>;
  bonusStreak?: BonusStreakResponse;
};

type BonusStreakResponse = {
  eligible: boolean;
  intervalsEvaluated: number;
  bonusAmount: string;
  bonusPerInterval: string;
  lastBonusTimestamp: string;
  updatedLastBonusTimestamp?: string;
  reason?: string;
  transaction?: BonusStreakTransaction;
};

type BonusStreakTransaction = {
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

const MAX_RESULTS = 100;
const DEFAULT_RESULTS = 20;

const readUdtAmount = (data: ccc.HexLike | undefined | null): bigint => {
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

const blockTimestampCache = new Map<string, bigint>();

const getBlockTimestamp = async (
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
        `[reward-history] Failed to fetch block ${blockNumber}: HTTP ${response.status}`
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
      `[reward-history] Failed to query block ${blockNumber} timestamp:`,
      error
    );
    return null;
  }
};

const interpretIntervalMs = (raw: bigint): bigint => {
  if (raw <= 0n) return 0n;
  // Heuristic: values larger than ~1e12 are already in ms.
  return raw > 1_000_000_000_000n ? raw : raw * 1000n;
};

const parseFeeFromEnv = (): bigint => {
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
      `[reward-history] Invalid STREAK_BONUS_FEE value (${explicit}), falling back to 1000n`
    );
    return 1_000n;
  }
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

type BonusStreakContext = {
  client: ReturnType<typeof getClient>;
  rpcUrl: string;
  address: string;
  protocolTypeHash: string;
  network: string;
  userLockScript: ccc.Script;
  pointsTypeScript: ccc.Script;
  transactions: JsonResponse["transactions"];
};

const findProxyAuthenticationCell = async (
  client: ReturnType<typeof getClient>
): Promise<ccc.Cell | null> => {
  const proxyAddress =
    process.env.STREAK_BONUS_PROXY_ADDRESS ||
    process.env.NEXT_PUBLIC_API_AUTHENTICATOR_ADDRESS;

  if (!proxyAddress) {
    console.warn(
      "[reward-history] Proxy authenticator address is not configured in environment variables"
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
      "[reward-history] Failed to locate proxy authenticator cell:",
      error
    );
    return null;
  }

  return null;
};

const buildBonusStreakTransaction = async (
  ctx: BonusStreakContext
): Promise<BonusStreakResponse> => {
  const base: BonusStreakResponse = {
    eligible: false,
    intervalsEvaluated: 0,
    bonusAmount: "0",
    bonusPerInterval: "0",
    lastBonusTimestamp: "0",
  };

  let protocolCell: ccc.Cell | null = null;
  try {
    protocolCell = await fetchProtocolCell(ctx.client);
  } catch (error) {
    base.reason = (error as Error).message;
    return base;
  }

  if (!protocolCell) {
    base.reason = "Protocol cell not found";
    return base;
  }

  let protocolData: ReturnType<typeof ProtocolData.decode>;
  try {
    protocolData = ProtocolData.decode(protocolCell.outputData);
  } catch (error) {
    base.reason = "Failed to decode protocol data";
    return base;
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
    return base;
  }

  if (streakBonusPerInterval <= 0n) {
    base.reason = "Streak bonus amount is zero";
    return base;
  }
  const network = deploymentManager.getCurrentNetwork();
  const userTypeCodeHash = deploymentManager.getContractCodeHash(
    network,
    "ckboostUserType"
  );

  if (!userTypeCodeHash) {
    base.reason = "User type contract not configured";
    return base;
  }

  const userCell = await getLatestUserCellByAddress(
    ctx.address,
    ctx.client,
    userTypeCodeHash,
    ccc.hexFrom(ctx.protocolTypeHash)
  );

  if (!userCell) {
    base.reason = "User cell not found";
    return base;
  }

  const userData = parseUserData(userCell);
  if (!userData) {
    base.reason = "Unable to parse user data";
    return base;
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
    return base;
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
    return base;
  }

  const bonusAmount = streakBonusPerInterval * intervalsAccumulated;
  base.bonusAmount = bonusAmount.toString();

  const pointsCellIterator = ctx.client.findCells({
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
    return base;
  }

  const currentPointsBalance = readUdtAmount(pointsCell.outputData);
  const updatedPointsBalance = currentPointsBalance + bonusAmount;

  const fee = parseFeeFromEnv();
  const userInputCapacity = ccc.numFrom(userCell.cellOutput.capacity);
  if (userInputCapacity <= fee) {
    base.reason = "Insufficient capacity to pay transaction fee";
    return base;
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

  const proxyCell = await findProxyAuthenticationCell(ctx.client);
  if (!proxyCell) {
    base.reason = "Proxy authentication cell unavailable";
    return base;
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

  const signingKey =
    process.env.STREAK_BONUS_PRIVATE_KEY ||
    process.env.TELEGRAM_AUTH_PRIVATE_KEY;

  if (!signingKey) {
    base.reason = "Server signing key not configured";
    return base;
  }

  const signer = new ccc.SignerCkbPrivateKey(ctx.client, signingKey as ccc.Hex);
  const signedTx = await signer.signTransaction(tx);
  const txHex = ccc.hexFrom(signedTx.toBytes());

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

  return base;
};

const getClient = () => {
  const network = deploymentManager.getCurrentNetwork();
  const rpcUrl =
    process.env.NEXT_PUBLIC_CKB_RPC_URL ||
    process.env.CKB_RPC_URL ||
    (network === "mainnet"
      ? "https://mainnet.ckb.dev"
      : "https://testnet.ckb.dev");

  if (network === "mainnet") {
    return new ccc.ClientPublicMainnet({ url: rpcUrl });
  }
  return new ccc.ClientPublicTestnet({ url: rpcUrl });
};

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  const address = event.queryStringParameters?.address?.trim();
  if (!address) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing address parameter" }),
    };
  }

  let limit = Number(event.queryStringParameters?.limit ?? DEFAULT_RESULTS);
  if (!Number.isFinite(limit) || limit <= 0) {
    limit = DEFAULT_RESULTS;
  }
  limit = Math.min(Math.floor(limit), MAX_RESULTS);

  const network = deploymentManager.getCurrentNetwork();
  const pointsCodeHash = deploymentManager.getContractCodeHash(
    network,
    "ckboostPointsUdt"
  );

  if (!pointsCodeHash) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Points UDT contract not configured in deployments.json",
      }),
    };
  }

  const client = getClient();

  // Resolve user lock script from address
  let addressObj: ccc.Address;
  try {
    addressObj = await ccc.Address.fromString(address, client);
  } catch (error) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Invalid CKB address",
        details: (error as Error).message,
      }),
    };
  }
  const userLockScript = addressObj.script;

  // Determine protocol type hash (args for points UDT)
  const protocolTypeCodeHash =
    process.env.NEXT_PUBLIC_PROTOCOL_TYPE_CODE_HASH?.trim();
  const protocolTypeHashType =
    (process.env.NEXT_PUBLIC_PROTOCOL_TYPE_HASH_TYPE?.trim() ||
      "type") as ccc.HashType;
  const protocolTypeArgs =
    process.env.NEXT_PUBLIC_PROTOCOL_TYPE_ARGS?.trim() || "";

  if (!protocolTypeCodeHash || !protocolTypeArgs) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error:
          "Protocol type environment variables missing. Ensure NEXT_PUBLIC_PROTOCOL_TYPE_CODE_HASH and NEXT_PUBLIC_PROTOCOL_TYPE_ARGS are set.",
      }),
    };
  }

  let protocolTypeHash: string;
  try {
    const protocolTypeScript = ccc.Script.from({
      codeHash: protocolTypeCodeHash,
      hashType: protocolTypeHashType,
      args: protocolTypeArgs,
    });
    protocolTypeHash = protocolTypeScript.hash().toLowerCase();
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to construct protocol type script from environment",
        details: (error as Error).message,
      }),
    };
  }

  const pointsTypeScript = ccc.Script.from({
    codeHash: pointsCodeHash,
    hashType: "type" as ccc.HashType,
    args: protocolTypeHash,
  });

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
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to query transactions",
        details: (error as Error).message,
      }),
    };
  }

  const responseTransactions: JsonResponse["transactions"] = [];

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
            `[reward-history] Failed to load input cell for tx ${match.txHash} index ${index}:`,
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
        `[reward-history] Failed to process transaction ${match.txHash}`,
        error
      );
    }
  }

  let bonusStreak: BonusStreakResponse | undefined;
  try {
    const rpcUrl =
      process.env.NEXT_PUBLIC_CKB_RPC_URL ||
      process.env.CKB_RPC_URL ||
      (network === "mainnet"
        ? "https://mainnet.ckb.dev"
        : "https://testnet.ckb.dev");
    bonusStreak = await buildBonusStreakTransaction({
      client,
      rpcUrl,
      address,
      protocolTypeHash,
      network,
      userLockScript,
      pointsTypeScript,
      transactions: responseTransactions,
    });
  } catch (error) {
    console.warn("[reward-history] Bonus streak calculation failed:", error);
  }

  const response: JsonResponse = {
    address,
    protocolTypeHash,
    pointsTypeScript: {
      codeHash: pointsTypeScript.codeHash,
      hashType: pointsTypeScript.hashType,
      args: pointsTypeScript.args,
    },
    transactions: responseTransactions,
    bonusStreak,
  };

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(response),
  };
};
