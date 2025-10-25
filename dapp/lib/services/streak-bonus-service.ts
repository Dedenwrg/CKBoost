import { ccc } from "@ckb-ccc/connector-react";
import type {
  BonusStreakResponse,
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
  }): Promise<BonusStreakResponse> {
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
    txHex: string;
    limit?: number;
  }): Promise<{ txHash: ccc.Hex; bonusStreak: BonusStreakResponse }> {
    const signer = this.requireSigner();

    const body: Record<string, unknown> = {
      userAddress: params.userAddress,
      txHex: params.txHex,
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

    const tx = ccc.Transaction.fromBytes(payload.txHex as ccc.Hex);
    const txHash = await signer.sendTransaction(tx);

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
