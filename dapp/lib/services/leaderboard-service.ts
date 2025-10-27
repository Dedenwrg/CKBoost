import { ccc } from "@ckb-ccc/connector-react";
// Leaderboard service traces Points minting history and aggregates rankings
import { deploymentManager } from "../ckb/deployment-manager";
import { createScopedLogger } from "ssri-ckboost";
import type {
  LeaderboardCacheSnapshot,
  LeaderboardEntry,
  LeaderboardStats,
  PointsMintRecord,
} from "../types/leaderboard";

const log = createScopedLogger("LeaderboardService");

export interface LeaderboardCacheAdapter {
  load(): Promise<LeaderboardCacheSnapshot | undefined>;
  save(snapshot: LeaderboardCacheSnapshot): Promise<void>;
}

export class InMemoryLeaderboardCache implements LeaderboardCacheAdapter {
  private snapshot?: LeaderboardCacheSnapshot;

  async load(): Promise<LeaderboardCacheSnapshot | undefined> {
    return this.snapshot;
  }

  async save(snapshot: LeaderboardCacheSnapshot): Promise<void> {
    this.snapshot = snapshot;
  }
}

interface LeaderboardServiceOptions {
  client: ccc.Client;
  protocolCell?: ccc.Cell;
  protocolTypeHash?: ccc.Hex;
  pointsCodeHash?: ccc.Hex;
  cache?: LeaderboardCacheAdapter;
}

type MintRecipientInternal = {
  outputIndex: number;
  lock: ccc.ScriptLike;
  lockHash: ccc.Hex;
  mintedAmount: bigint;
  totalOutputAmount: bigint;
  address?: string;
};

type MintRecordInternal = {
  txHash: ccc.Hex;
  blockNumber?: bigint;
  totalMinted: bigint;
  recipients: MintRecipientInternal[];
};

type PointsInput = {
  cell: ccc.Cell;
  amount: bigint;
};

type PointsOutput = {
  index: number;
  lock: ccc.Script;
  amount: bigint;
};

export class LeaderboardService {
  private readonly client: ccc.Client;
  private readonly pointsCodeHash: ccc.Hex;
  private readonly protocolTypeHash: ccc.Hex;
  private readonly cache: LeaderboardCacheAdapter;

  private processedTransactions = new Set<ccc.Hex>();
  private visitedOutpoints = new Set<string>();
  private cellCache = new Map<string, ccc.Cell>();
  private maxSeenBlock: bigint = 0n;

  constructor(options: LeaderboardServiceOptions) {
    this.client = options.client;

    const network = deploymentManager.getCurrentNetwork();
    const pointsCodeHash =
      options.pointsCodeHash ??
      deploymentManager.getContractCodeHash(network, "ckboostPointsUdt");

    if (!pointsCodeHash) {
      throw new Error("Points UDT contract not found in deployments.json");
    }

    const protocolTypeHash =
      options.protocolTypeHash ?? options.protocolCell?.cellOutput.type?.hash();

    if (!protocolTypeHash) {
      throw new Error(
        "Protocol type hash is required to locate Points UDT cells"
      );
    }

    this.pointsCodeHash = pointsCodeHash;
    this.protocolTypeHash = protocolTypeHash;
    this.cache = options.cache ?? new InMemoryLeaderboardCache();
  }

  async collectLeaderboardStats(): Promise<LeaderboardStats> {
    const snapshot = await this.cache.load();
    const { map: mintedRecords, baseline } = this.deserializeSnapshot(snapshot);

    this.processedTransactions = new Set(
      mintedRecords.keys() as unknown as ccc.Hex[]
    );
    this.visitedOutpoints.clear();
    this.cellCache.clear();

    this.maxSeenBlock = baseline;
    mintedRecords.forEach((record) => {
      if (record.blockNumber && record.blockNumber > this.maxSeenBlock) {
        this.maxSeenBlock = record.blockNumber;
      }
    });

    const liveCells = await this.fetchLivePointsCells();
    log.log("LeaderboardService", {
      action: "collectLeaderboardStats",
      liveCells: liveCells.length,
      baseline: baseline.toString(),
    });

    for (const cell of liveCells) {
      await this.traceOutPoint(cell.outPoint, mintedRecords, baseline);
    }

    const serialized = this.serializeSnapshot(mintedRecords);
    await this.cache.save(serialized);

    const totals = this.buildTotals(mintedRecords);

    return {
      lastProcessedBlock: serialized.lastProcessedBlock,
      mintedTransactions: serialized.mintedTransactions,
      totals,
    };
  }

  private async fetchLivePointsCells(): Promise<ccc.Cell[]> {
    const cells: ccc.Cell[] = [];
    const searchKey = {
      script: {
        codeHash: this.pointsCodeHash,
        hashType: "type" as const,
        args: this.protocolTypeHash,
      },
      scriptType: "type" as const,
      scriptSearchMode: "exact" as const,
      withData: true,
    };

    for await (const cell of this.client.findCells(searchKey)) {
      cells.push(cell);
    }

    return cells;
  }

  private async traceOutPoint(
    outPointLike: ccc.OutPointLike,
    mintedRecords: Map<string, MintRecordInternal>,
    baseline: bigint
  ): Promise<void> {
    const outPoint = ccc.OutPoint.from(outPointLike);
    const key = this.outPointKey(outPoint);

    if (this.visitedOutpoints.has(key)) {
      return;
    }
    this.visitedOutpoints.add(key);

    const txResponse = await this.client.getTransaction(outPoint.txHash);
    if (!txResponse) {
      log.warn("LeaderboardService", "Transaction not found", {
        outPoint: key,
      });
      return;
    }

    const txHash = txResponse.transaction.hash();
    const blockNumber = txResponse.blockNumber
      ? BigInt(txResponse.blockNumber)
      : undefined;

    if (blockNumber && blockNumber > this.maxSeenBlock) {
      this.maxSeenBlock = blockNumber;
    }

    const pointsOutputs = this.extractPointsOutputs(txResponse);
    const pointsInputs = await this.extractPointsInputs(txResponse);

    if (!this.processedTransactions.has(txHash)) {
      await this.recordMintIfAny(
        txHash,
        txResponse,
        pointsOutputs,
        pointsInputs,
        mintedRecords
      );
      this.processedTransactions.add(txHash);
    }

    if (blockNumber && blockNumber <= baseline) {
      return;
    }

    for (const input of pointsInputs) {
      await this.traceOutPoint(input.cell.outPoint, mintedRecords, baseline);
    }
  }

  private extractPointsOutputs(
    txResponse: ccc.ClientTransactionResponse
  ): PointsOutput[] {
    const outputs: PointsOutput[] = [];

    txResponse.transaction.outputs.forEach((output, index) => {
      if (!this.isPointsScript(output.type)) {
        return;
      }

      const outputData = txResponse.transaction.outputsData[index];
      const amount = this.readUdtAmount(outputData);

      outputs.push({
        index,
        lock: output.lock,
        amount,
      });
    });

    return outputs;
  }

  private async extractPointsInputs(
    txResponse: ccc.ClientTransactionResponse
  ): Promise<PointsInput[]> {
    const inputs: PointsInput[] = [];

    for (const input of txResponse.transaction.inputs) {
      if (!input.previousOutput) {
        continue;
      }

      const outPoint = ccc.OutPoint.from(input.previousOutput);
      const cell = await this.loadCell(outPoint);
      if (!cell || !this.isPointsScript(cell.cellOutput.type)) {
        continue;
      }

      const amount = this.readUdtAmount(cell.outputData);
      inputs.push({ cell, amount });
    }

    return inputs;
  }

  private async loadCell(
    outPoint: ccc.OutPoint
  ): Promise<ccc.Cell | undefined> {
    const key = this.outPointKey(outPoint);
    const cached = this.cellCache.get(key);
    if (cached) {
      return cached;
    }

    const cell = await this.client.getCell(outPoint);
    if (cell) {
      this.cellCache.set(key, cell);
    }
    return cell;
  }

  private isPointsScript(script?: ccc.Script | null): script is ccc.Script {
    if (!script) {
      return false;
    }

    return (
      script.codeHash === this.pointsCodeHash &&
      script.hashType === "type" &&
      script.args === this.protocolTypeHash
    );
  }

  private readUdtAmount(data: ccc.Hex): bigint {
    if (!data || data === "0x" || data.length < 34) {
      return 0n;
    }

    const amountBytes = ccc.bytesFrom(data.slice(0, 34));
    return ccc.numLeFromBytes(amountBytes);
  }

  private async recordMintIfAny(
    txHash: ccc.Hex,
    txResponse: ccc.ClientTransactionResponse,
    outputs: PointsOutput[],
    inputs: PointsInput[],
    mintedRecords: Map<string, MintRecordInternal>
  ): Promise<void> {
    if (outputs.length === 0) {
      return;
    }

    const totalOutput = outputs.reduce(
      (acc, output) => acc + output.amount,
      0n
    );
    const totalInput = inputs.reduce((acc, input) => acc + input.amount, 0n);

    if (totalOutput <= totalInput) {
      return;
    }

    const mintedDelta = totalOutput - totalInput;
    const { recipients, mintedTotal } = this.calculateMintRecipients(
      outputs,
      inputs
    );

    if (mintedTotal !== mintedDelta) {
      log.warn("LeaderboardService", "Mint total mismatch", {
        txHash,
        mintedDelta: mintedDelta.toString(),
        mintedTotal: mintedTotal.toString(),
      });
    }

    const blockNumber = txResponse.blockNumber
      ? BigInt(txResponse.blockNumber)
      : undefined;

    if (mintedRecords.has(txHash)) {
      const existing = mintedRecords.get(txHash)!;
      if (!existing.blockNumber && blockNumber) {
        existing.blockNumber = blockNumber;
      }
      return;
    }

    mintedRecords.set(txHash, {
      txHash,
      blockNumber,
      totalMinted: mintedTotal,
      recipients,
    });
  }

  private calculateMintRecipients(
    outputs: PointsOutput[],
    inputs: PointsInput[]
  ): { recipients: MintRecipientInternal[]; mintedTotal: bigint } {
    const inputRemainder = new Map<string, bigint>();
    for (const input of inputs) {
      const lock = input.cell.cellOutput.lock;
      const lockHash = lock.hash();
      const current = inputRemainder.get(lockHash) ?? 0n;
      inputRemainder.set(lockHash, current + input.amount);
    }

    const recipients: MintRecipientInternal[] = [];
    let mintedTotal = 0n;

    for (const output of outputs) {
      const lockHash = output.lock.hash();
      const available = inputRemainder.get(lockHash) ?? 0n;
      let mintedAmount = 0n;

      if (available >= output.amount) {
        inputRemainder.set(lockHash, available - output.amount);
      } else {
        mintedAmount = output.amount - available;
        inputRemainder.set(lockHash, 0n);
      }

      if (mintedAmount === 0n) {
        continue;
      }

      mintedTotal += mintedAmount;
      const scriptRef: ccc.ScriptLike = {
        codeHash: output.lock.codeHash,
        hashType: output.lock.hashType,
        args: output.lock.args,
      };

      let address: string | undefined;
      try {
        address = ccc.Address.fromScript(output.lock, this.client).toString();
      } catch (error) {
        log.warn("LeaderboardService", "Failed to derive address", {
          lockHash,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      recipients.push({
        outputIndex: output.index,
        lock: scriptRef,
        lockHash,
        mintedAmount,
        totalOutputAmount: output.amount,
        address,
      });
    }

    return { recipients, mintedTotal };
  }

  private serializeSnapshot(
    mintedRecords: Map<string, MintRecordInternal>
  ): LeaderboardCacheSnapshot {
    const mintedTransactions: PointsMintRecord[] = Array.from(
      mintedRecords.values()
    ).map((record) => ({
      txHash: record.txHash,
      blockNumber: record.blockNumber
        ? record.blockNumber.toString()
        : undefined,
      totalMinted: record.totalMinted.toString(),
      recipients: record.recipients.map((recipient) => ({
        outputIndex: recipient.outputIndex,
        lock: recipient.lock,
        lockHash: recipient.lockHash,
        mintedAmount: recipient.mintedAmount.toString(),
        totalOutputAmount: recipient.totalOutputAmount.toString(),
        address: recipient.address,
      })),
    }));

    mintedTransactions.sort((a, b) => {
      const blockA = a.blockNumber ? BigInt(a.blockNumber) : 0n;
      const blockB = b.blockNumber ? BigInt(b.blockNumber) : 0n;
      if (blockA === blockB) {
        return a.txHash.localeCompare(b.txHash);
      }
      return blockA < blockB ? -1 : 1;
    });

    const lastProcessedBlock = this.maxSeenBlock.toString();

    return {
      lastProcessedBlock,
      mintedTransactions,
    };
  }

  private deserializeSnapshot(snapshot?: LeaderboardCacheSnapshot): {
    map: Map<string, MintRecordInternal>;
    baseline: bigint;
  } {
    if (!snapshot) {
      return { map: new Map(), baseline: 0n };
    }

    const map = new Map<string, MintRecordInternal>();

    snapshot.mintedTransactions.forEach((record) => {
      map.set(record.txHash, {
        txHash: record.txHash,
        blockNumber: record.blockNumber
          ? BigInt(record.blockNumber)
          : undefined,
        totalMinted: BigInt(record.totalMinted),
        recipients: record.recipients.map((recipient) => ({
          outputIndex: recipient.outputIndex,
          lock: recipient.lock,
          lockHash: recipient.lockHash,
          mintedAmount: BigInt(recipient.mintedAmount),
          totalOutputAmount: BigInt(recipient.totalOutputAmount),
          address: recipient.address,
        })),
      });
    });

    const baseline = snapshot.lastProcessedBlock
      ? BigInt(snapshot.lastProcessedBlock)
      : 0n;

    return { map, baseline };
  }

  private buildTotals(
    mintedRecords: Map<string, MintRecordInternal>
  ): LeaderboardEntry[] {
    const totals = new Map<
      string,
      { amount: bigint; lock: ccc.ScriptLike; address?: string }
    >();

    mintedRecords.forEach((record) => {
      record.recipients.forEach((recipient) => {
        if (recipient.mintedAmount === 0n) {
          return;
        }
        const current = totals.get(recipient.lockHash);
        if (current) {
          current.amount += recipient.mintedAmount;
          if (!current.address && recipient.address) {
            current.address = recipient.address;
          }
        } else {
          totals.set(recipient.lockHash, {
            amount: recipient.mintedAmount,
            lock: recipient.lock,
            address: recipient.address,
          });
        }
      });
    });

    const entries: LeaderboardEntry[] = Array.from(totals.entries()).map(
      ([lockHash, data]) => ({
        lockHash: lockHash as `0x${string}`,
        address: data.address,
        totalMinted: data.amount.toString(),
        lock: data.lock,
      })
    );

    entries.sort((a, b) => {
      const totalA = BigInt(a.totalMinted);
      const totalB = BigInt(b.totalMinted);
      if (totalA === totalB) {
        return a.lockHash.localeCompare(b.lockHash);
      }
      return totalA < totalB ? 1 : -1;
    });

    return entries;
  }

  private outPointKey(outPoint: ccc.OutPoint): string {
    return `${outPoint.txHash}:${outPoint.index.toString()}`;
  }
}
