import { ccc } from "@ckb-ccc/core";
import { ssri } from "@ckb-ccc/ssri";
import { AchievementDataVec, ConnectedTypeID, type AchievementDataLike } from "../generated";

/**
 * Lightweight helper around the CKBoost achievement type contract.
 *
 * The on-chain SSRI method currently focuses on preparing the witness that
 * proves a specific achievement was claimed. Transaction construction (inputs
 * and outputs) is expected to happen in the caller, while this helper handles
 * the serialization details and invocation of the SSRI executor.
 */
export class Achievement extends ssri.Trait {
  public readonly script: ccc.Script;
  public readonly connectedProtocolCell?: ccc.Cell;

  constructor(
    code: ccc.OutPointLike,
    script: ccc.ScriptLike,
    connectedProtocolCell?: ccc.Cell,
    config?: {
      executor?: ssri.Executor | null;
    } | null
  ) {
    super(code, config?.executor);
    this.script = ccc.Script.from(script);
    this.connectedProtocolCell = connectedProtocolCell;
  }

  /**
   * Attach the CKBoost achievement witness for the specified achievement type.
   *
   * @param achievementType - Identifier understood by the contract (e.g. slug/id).
   * @param tx - Optional partially-built transaction to feed into the SSRI executor.
   * @returns Transaction wrapped in an {@link ssri.ExecutorResponse} ready for further composition.
   */
  async claimAchievement(
    tx?: ccc.Transaction
  ): Promise<ssri.ExecutorResponse<ccc.Transaction>> {
    if (!this.executor) {
      throw new Error("Executor required for SSRI operations");
    }

    const txReq = ccc.Transaction.from(tx ?? {});
    const txHex = ccc.hexFrom(txReq.toBytes());

    const response = await this.executor.runScript(
      this.code,
      "CKBoostAchievement.claim_achievement",
      [txHex],
      { script: this.script }
    );

    if (!response) {
      throw new Error("No result returned by SSRI executor");
    }

    const resTx = response.map((value) => ccc.Transaction.fromBytes(value));

    // Ensure the achievement code cell is referenced so downstream callers
    // can submit the transaction without missing dependencies.
    resTx.res.addCellDeps({
      outPoint: this.code,
      depType: "code",
    });

    return resTx;
  }

  async updateAchievement(
    signer: ccc.Signer,
    achievements: AchievementDataLike[],
    tx?: ccc.Transaction
  ): Promise<ssri.ExecutorResponse<ccc.Transaction>> {
    if (!this.executor) {
      throw new Error("Executor required for SSRI operations");
    }

    let txReq = ccc.Transaction.from(tx ?? {});
    let isNewAchievement = false;
    // Ensure at least one input for the transaction
    if (this.script.args.length <= 2) {
      isNewAchievement = true;
    } else {
    const connectedTypeId = ConnectedTypeID.decode(this.script.args);
      isNewAchievement = connectedTypeId.type_id === "0x" + "00".repeat(32);
    }
    if (txReq.inputs.length === 0 && isNewAchievement) {
      await txReq.completeInputsAtLeastOne(signer);
      await txReq.completeInputsByCapacity(signer);
    }

    const achievementsBytes = AchievementDataVec.encode(achievements);
    const achievementsHex = ccc.hexFrom(achievementsBytes);
    const txHex = ccc.hexFrom(txReq.toBytes());

    const response = await this.executor.runScript(
      this.code,
      "CKBoostAchievement.update_achievement",
      [txHex, achievementsHex],
      { script: this.script }
    );

    if (!response) {
      throw new Error("No result returned by SSRI executor");
    }

    const resTx = response.map((value) => ccc.Transaction.fromBytes(value));
    resTx.res.addCellDeps({
      outPoint: this.code,
      depType: "code",
    });

    return resTx;
  }
}
