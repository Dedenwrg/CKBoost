import { ccc } from "@ckb-ccc/connector-react";
import type {
  BonusStreakCalculation,
  StreakBonusQueryResponse,
  StreakBonusValidateResponse,
} from "@/netlify/lib/streak-bonus";
import { deploymentManager } from "@/lib/ckb/deployment-manager";
import {
  buildStreakBonusQueryCacheKey,
  seedStreakBonusQueryCache,
  withStreakBonusQueryCache,
} from "@/lib/cache/query-cache";
import { registerPendingTransaction } from "@/lib/pending-transactions";

export type StreakBonusClaimResult = {
  txHash: ccc.Hex;
  bonusStreak: BonusStreakCalculation;
  pointsOutputCell: ccc.Cell | null;
};

export class StreakBonusService {
  private readonly signer?: ccc.Signer;

  constructor(signer?: ccc.Signer) {
    this.signer = signer;
  }

  async query(params: {
    userAddress: string;
    limit?: number;
    refresh?: boolean;
  }): Promise<BonusStreakCalculation> {
    const { userAddress, limit, refresh = false } = params;
    const network = deploymentManager.getCurrentNetwork();
    const cacheKey = buildStreakBonusQueryCacheKey({
      network,
      userAddress,
      limit,
    });

    const result = await withStreakBonusQueryCache(
      cacheKey,
      async () => {
        const body: Record<string, unknown> = {
          userAddress,
        };
        if (typeof limit === "number") {
          body.limit = limit;
        }

        const response = await fetch("/api/streakBonus-query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const payload = (await response.json()) as StreakBonusQueryResponse;
        if (!payload.success) {
          throw new Error(payload.message ?? payload.error);
        }

        return payload.bonusStreak;
      },
      { refresh }
    );

    return result.value;
  }

  async claim(params: {
    userAddress: string;
    tx: ccc.Transaction;
    limit?: number;
  }): Promise<StreakBonusClaimResult> {
    const signer = this.requireSigner();

    const body: Record<string, unknown> = {
      userAddress: params.userAddress,
      txHex: ccc.hexFrom(params.tx.toBytes()),
    };
    if (typeof params.limit === "number") {
      body.limit = params.limit;
    }

    const response = await fetch("/api/streakBonus-validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const payload = (await response.json()) as StreakBonusValidateResponse;
    if (!payload.success) {
      throw new Error(payload.message ?? payload.error);
    }

    const validatedTx = ccc.Transaction.fromBytes(payload.txHex as ccc.Hex);

    for (let i = 0; i < validatedTx.inputs.length; i += 1) {
      const inputCell = await signer.client.getCell(
        validatedTx.inputs[i].previousOutput
      );
      if (!inputCell) {
        throw new Error("Input cell not found while finalising streak bonus transaction.");
      }
      validatedTx.inputs[i] = ccc.CellInput.from({
        previousOutput: inputCell.outPoint,
        since: validatedTx.inputs[i].since ?? "0x0",
        cellOutput: inputCell.cellOutput,
        outputData: inputCell.outputData,
      });
    }

    for (let i = 0; i < validatedTx.outputs.length; i += 1) {
      const out = validatedTx.outputs[i];
      if (out.type) {
        validatedTx.outputs[i] = ccc.CellOutput.from(
          { lock: out.lock, type: out.type },
          validatedTx.outputsData[i] as ccc.HexLike
        );
      }
    }

    const txHash = await signer.sendTransaction(validatedTx);
    registerPendingTransaction(txHash, {
      label: "Streak bonus claim",
      context: "StreakBonusService",
    });
    const submittedPointsOutput = await this.findSubmittedPointsOutputCell(
      validatedTx,
      txHash
    );

    const network = deploymentManager.getCurrentNetwork();
    const cacheKey = buildStreakBonusQueryCacheKey({
      network,
      userAddress: params.userAddress,
      limit: params.limit,
    });
    seedStreakBonusQueryCache(cacheKey, payload.bonusStreak);

    return {
      txHash,
      bonusStreak: payload.bonusStreak,
      pointsOutputCell: submittedPointsOutput,
    };
  }

  private requireSigner(): ccc.Signer {
    if (!this.signer) {
      throw new Error("Wallet connection required to submit streak bonus.");
    }
    return this.signer;
  }

  private async findSubmittedPointsOutputCell(
    tx: ccc.Transaction,
    txHash: ccc.Hex
  ): Promise<ccc.Cell | null> {
    const signer = this.requireSigner();
    const network = deploymentManager.getCurrentNetwork();
    const pointsCodeHash = deploymentManager.getContractCodeHash(
      network,
      "ckboostPointsUdt"
    );
    if (!pointsCodeHash) {
      return null;
    }

    const claimantLock = (await signer.getRecommendedAddressObj()).script;
    const claimantLockHash = claimantLock.hash().toLowerCase();
    const normalizedPointsCodeHash = pointsCodeHash.toLowerCase();

    for (let index = 0; index < tx.outputs.length; index += 1) {
      const output = tx.outputs[index];
      if (!output.type) {
        continue;
      }
      if (output.type.codeHash.toLowerCase() !== normalizedPointsCodeHash) {
        continue;
      }
      if (output.lock.hash().toLowerCase() !== claimantLockHash) {
        continue;
      }

      return ccc.Cell.from({
        previousOutput: {
          txHash,
          index,
        },
        cellOutput: output,
        outputData: tx.outputsData[index] as ccc.HexLike,
      });
    }

    return null;
  }
}
