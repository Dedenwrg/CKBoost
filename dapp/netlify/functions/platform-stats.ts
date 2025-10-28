import type { Handler } from "@netlify/functions";
import { ccc } from "@ckb-ccc/shell";
import { deploymentManager } from "@/lib/ckb/deployment-manager";
import { createLogger } from "@/netlify/lib/log";
import { ckboost } from "ssri-ckboost";
import { readUdtAmount } from "@/netlify/lib/streak-bonus";

type StatsWindowKey = "1d" | "7d" | "30d" | "90d" | "365d" | "total";

type StatsResponse = {
  lastUpdated: string;
  pointsMinted: Record<StatsWindowKey, string>;
  questSubmissions: Record<StatsWindowKey, number>;
  newUsers: Record<StatsWindowKey, number>;
};

type MintRecord = {
  timestamp: number;
  amount: bigint;
};

type TimestampRecord = {
  timestamp: number;
};

const logger = createLogger("platform-stats");

let cachedStats: { expiresAt: number; data: StatsResponse } | null = null;

const WINDOWS: Array<{ key: StatsWindowKey; ms?: number }> = [
  { key: "1d", ms: 24 * 60 * 60 * 1000 },
  { key: "7d", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "30d", ms: 30 * 24 * 60 * 60 * 1000 },
  { key: "90d", ms: 90 * 24 * 60 * 60 * 1000 },
  { key: "365d", ms: 365 * 24 * 60 * 60 * 1000 },
  { key: "total" },
];

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

const resolveProtocolTypeHash = (): string => {
  const codeHash = process.env.NEXT_PUBLIC_PROTOCOL_TYPE_CODE_HASH?.trim();
  const hashType =
    (process.env.NEXT_PUBLIC_PROTOCOL_TYPE_HASH_TYPE?.trim() || "type") as ccc.HashType;
  const args = process.env.NEXT_PUBLIC_PROTOCOL_TYPE_ARGS?.trim();

  if (!codeHash || !args) {
    throw new Error(
      "Protocol type environment variables missing. Ensure NEXT_PUBLIC_PROTOCOL_TYPE_CODE_HASH and NEXT_PUBLIC_PROTOCOL_TYPE_ARGS are set."
    );
  }

  const script = ccc.Script.from({ codeHash, hashType, args });
  return script.hash().toLowerCase();
};

const getBlockTimestamp = async (
  client: ccc.Client,
  cache: Map<string, number>,
  blockNumber: bigint | null
): Promise<number | null> => {
  if (!blockNumber || blockNumber <= 0n) {
    return null;
  }

  const key = blockNumber.toString();
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const header = await client.getHeaderByNumber(blockNumber);
    const timestampHex = header?.timestamp;
    if (!timestampHex) {
      return null;
    }
    const timestamp = Number(BigInt(timestampHex));
    cache.set(key, timestamp);
    return timestamp;
  } catch (error) {
    logger.warn("Failed to load block header", { blockNumber: key, error });
    return null;
  }
};

const aggregateBigIntRecords = (
  records: MintRecord[],
  now: number
): Record<StatsWindowKey, string> => {
  const totals: Record<StatsWindowKey, bigint> = {
    "1d": 0n,
    "7d": 0n,
    "30d": 0n,
    "90d": 0n,
    "365d": 0n,
    total: 0n,
  };

  records.forEach((record) => {
    const diff = now - record.timestamp;
    if (diff < 0) {
      return;
    }
    WINDOWS.forEach((window) => {
      if (!window.ms || diff <= window.ms) {
        totals[window.key] += record.amount;
      }
    });
  });

  return {
    "1d": totals["1d"].toString(),
    "7d": totals["7d"].toString(),
    "30d": totals["30d"].toString(),
    "90d": totals["90d"].toString(),
    "365d": totals["365d"].toString(),
    total: totals.total.toString(),
  };
};

const aggregateCountRecords = (
  records: TimestampRecord[],
  now: number
): Record<StatsWindowKey, number> => {
  const totals: Record<StatsWindowKey, number> = {
    "1d": 0,
    "7d": 0,
    "30d": 0,
    "90d": 0,
    "365d": 0,
    total: 0,
  };

  records.forEach((record) => {
    const diff = now - record.timestamp;
    if (diff < 0) {
      return;
    }
    WINDOWS.forEach((window) => {
      if (!window.ms || diff <= window.ms) {
        totals[window.key] += 1;
      }
    });
  });

  return totals;
};

const collectPlatformStats = async (client: ccc.Client): Promise<StatsResponse> => {
  const network = deploymentManager.getCurrentNetwork();
  const pointsCodeHash = deploymentManager.getContractCodeHash(
    network,
    "ckboostPointsUdt"
  );
  const userTypeCodeHash = deploymentManager.getContractCodeHash(
    network,
    "ckboostUserType"
  );

  if (!pointsCodeHash || !userTypeCodeHash) {
    throw new Error("Required contract code hashes not configured");
  }

  const protocolTypeHash = resolveProtocolTypeHash();
  const pointsTypeScript = ccc.Script.from({
    codeHash: pointsCodeHash,
    hashType: "type" as const,
    args: protocolTypeHash,
  });
  const pointsTypeHash = pointsTypeScript.hash();

  const mintedRecords: MintRecord[] = [];
  const questSubmissionEvents: TimestampRecord[] = [];
  const newUserEvents: TimestampRecord[] = [];
  const timestampCache = new Map<string, number>();

  for await (const match of client.findTransactions(
    {
      script: pointsTypeScript,
      scriptType: "type" as const,
      scriptSearchMode: "exact" as const,
      groupByTransaction: true as const,
    },
    "desc"
  )) {
    try {
      const txInfo = await client.getTransaction(match.txHash);
      if (!txInfo) {
        continue;
      }
      const tx = txInfo.transaction;
      const blockNumber = txInfo.blockNumber
        ? BigInt(txInfo.blockNumber)
        : null;

      let outputTotal = 0n;
      tx.outputs.forEach((output, index) => {
        if (output.type && output.type.hash() === pointsTypeHash) {
          const data = tx.outputsData[index];
          const amount = readUdtAmount(data);
          outputTotal += amount;
        }
      });

      let inputTotal = 0n;
      for (const input of tx.inputs) {
        try {
          const previous = await input.getCell(client);
          if (!previous || !previous.cellOutput.type) {
            continue;
          }
          if (previous.cellOutput.type.hash() !== pointsTypeHash) {
            continue;
          }
          const amount = readUdtAmount(previous.outputData);
          inputTotal += amount;
        } catch (error) {
          logger.warn("Failed to load input cell", { txHash: match.txHash, error });
        }
      }

      const net = outputTotal - inputTotal;
      if (net <= 0n) {
        continue;
      }

      const timestamp = await getBlockTimestamp(client, timestampCache, blockNumber);
      if (!timestamp) {
        continue;
      }

      mintedRecords.push({ timestamp, amount: net });
    } catch (error) {
      logger.warn("Failed to process points transaction", { txHash: match.txHash, error });
    }
  }

  const userSearchKey = {
    script: {
      codeHash: userTypeCodeHash,
      hashType: "type" as const,
      args: "",
    },
    scriptType: "type" as const,
    scriptSearchMode: "prefix" as const,
    withData: true,
  };

  const latestByLock = new Map<
    string,
    { cell: ccc.Cell; latestBlock: bigint | null; firstBlock: bigint | null }
  >();

  for await (const cell of client.findCells(userSearchKey)) {
    if (!cell.outputData || cell.outputData === "0x") {
      continue;
    }

    let blockNumber: bigint | null = null;
    try {
      const txInfo = await client.getTransaction(cell.outPoint.txHash);
      if (txInfo?.blockNumber) {
        blockNumber = BigInt(txInfo.blockNumber);
      }
    } catch (error) {
      logger.warn("Failed to resolve user cell transaction", error);
    }

    const lockHash = cell.cellOutput.lock.hash().toLowerCase();
    const existing = latestByLock.get(lockHash);
    if (!existing) {
      latestByLock.set(lockHash, {
        cell,
        latestBlock: blockNumber,
        firstBlock: blockNumber,
      });
    } else {
      if (
        blockNumber !== null &&
        (existing.firstBlock === null || blockNumber < existing.firstBlock)
      ) {
        existing.firstBlock = blockNumber;
      }
      if (
        blockNumber !== null &&
        (existing.latestBlock === null || blockNumber >= existing.latestBlock)
      ) {
        existing.cell = cell;
        existing.latestBlock = blockNumber;
      }
    }
  }

  for (const entry of latestByLock.values()) {
    try {
      const userData = ckboost.types.UserData.decode(entry.cell.outputData);
      const submissions = userData.submission_records || [];
      submissions.forEach((record) => {
        const timestampRaw = record.submission_timestamp
          ? Number(ccc.numFrom(record.submission_timestamp))
          : 0;
        const timestamp = timestampRaw > 0 ? timestampRaw * 1000 : null;
        if (timestamp) {
          questSubmissionEvents.push({ timestamp });
        }
      });

      if (entry.firstBlock) {
        const firstTimestamp = await getBlockTimestamp(
          client,
          timestampCache,
          entry.firstBlock
        );
        if (firstTimestamp) {
          newUserEvents.push({ timestamp: firstTimestamp });
        }
      }
    } catch (error) {
      logger.warn("Failed to decode user data", error);
    }
  }

  const now = Date.now();
  const mintedTotals = aggregateBigIntRecords(mintedRecords, now);
  const submissionTotals = aggregateCountRecords(questSubmissionEvents, now);
  const newUserTotals = aggregateCountRecords(newUserEvents, now);

  return {
    lastUpdated: new Date(now).toISOString(),
    pointsMinted: mintedTotals,
    questSubmissions: submissionTotals,
    newUsers: newUserTotals,
  };
};

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  const now = Date.now();
  if (cachedStats && cachedStats.expiresAt > now) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cachedStats.data),
    };
  }

  try {
    const client = getClient();
    const data = await collectPlatformStats(client);
    cachedStats = {
      expiresAt: now + 24 * 60 * 60 * 1000,
      data,
    };
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    };
  } catch (error) {
    logger.error("Failed to collect platform stats", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to collect platform statistics",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
