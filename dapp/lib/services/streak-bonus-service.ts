import { ccc } from "@ckb-ccc/connector-react";
import type {
  BonusStreakCalculation,
  StreakBonusQueryResponse,
  StreakBonusValidateResponse,
} from "@/netlify/lib/streak-bonus";

export class StreakBonusService {
  private readonly signer?: ccc.Signer;

  constructor(signer?: ccc.Signer) {
    this.signer = signer;
  }

  async query(params: {
    userAddress: string;
    limit?: number;
  }): Promise<BonusStreakCalculation> {
    const body: Record<string, unknown> = {
      userAddress: params.userAddress,
    };
    if (typeof params.limit === "number") {
      body.limit = params.limit;
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
  }

  async claim(params: {
    userAddress: string;
    tx: ccc.Transaction;
    limit?: number;
  }): Promise<{ txHash: ccc.Hex; bonusStreak: BonusStreakCalculation }> {
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

    return {
      txHash,
      bonusStreak: payload.bonusStreak,
    };
  }

  private requireSigner(): ccc.Signer {
    if (!this.signer) {
      throw new Error("Wallet connection required to submit streak bonus.");
    }
    return this.signer;
  }
}
