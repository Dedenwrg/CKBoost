import { ccc } from "@ckb-ccc/core";
import { ssri } from "@ckb-ccc/ssri";
import {
  TippingProposalData,
  type TippingProposalDataLike,
} from "../generated";

export interface FundingPoolSummary {
  /** Capacity-only cells (CKB funding) locked by the funding lock */
  ckbCells: ccc.Cell[];
  /** Aggregated capacity stored in the funding lock */
  totalCapacity: bigint;
  /** Funding cells grouped by their UDT type hash */
  udtCellsByType: Map<string, ccc.Cell[]>;
  /** Aggregated UDT balances grouped by type hash */
  udtTotalsByType: Map<string, bigint>;
}

/**
 * Represents CKBoost tipping functionality where funding is pooled at the
 * protocol level instead of being isolated per campaign. This class mirrors
 * the Campaign helper but targets the tipping type script, so all proposals
 * operate on the shared protocol funding lock.
 */
export class Tipping extends ssri.Trait {
  public readonly script: ccc.Script;
  public readonly connectedProtocolCell: ccc.Cell;

  /**
   * Constructs a new Tipping instance.
   *
   * @param code - The script code cell of the Tipping contract.
   * @param script - The type script of the Tipping contract.
   * @param connectedProtocolCell - The connected protocol cell.
   */
  constructor(
    code: ccc.OutPointLike,
    script: ccc.ScriptLike,
    connectedProtocolCell: ccc.Cell,
    config?: {
      executor?: ssri.Executor | null;
    } | null
  ) {
    super(code, config?.executor);
    this.script = ccc.Script.from(script);
    this.connectedProtocolCell = connectedProtocolCell;
  }

  /**
   * Submit or update a tipping proposal via the SSRI executor. The proposal is
   * linked to the protocol's type hash so it automatically leverages the shared
   * funding pool managed by the protocol funding lock.
   */
  async updateTippingProposal(
    signer: ccc.Signer,
    proposalData: TippingProposalDataLike,
    tx?: ccc.Transaction
  ): Promise<ssri.ExecutorResponse<ccc.Transaction>> {
    if (!this.executor) {
      throw new Error("Executor required for SSRI operations");
    }

    let resTx;

    const txReq = ccc.Transaction.from(tx ?? {});
    // Ensure at least one input for the transaction
    if (txReq.inputs.length === 0) {
      await txReq.completeInputsAtLeastOne(signer);
      await txReq.completeInputsByCapacity(signer);
    }

    const protocolTypeHash = this.getProtocolTypeHash();
    const proposalBytes = TippingProposalData.encode(proposalData);
    const proposalHex = ccc.hexFrom(proposalBytes);

    const res = await this.executor.runScript(
      this.code,
      "CKBoostTipping.update_tipping_proposal",
      [protocolTypeHash, proposalHex],
      { script: this.script }
    );

    if (!res) {
      throw new Error("update_tipping_proposal did not return a response");
    } else {
      resTx = res.map((res) => ccc.Transaction.fromBytes(res));
      resTx.res.addCellDeps({
        outPoint: this.code,
        depType: "code",
      });
      // Add the protocol cell as a dependency
      resTx.res.addCellDeps({
        outPoint: this.connectedProtocolCell.outPoint,
        depType: "code",
      });
      return resTx;
    }
  }

  /**
   * Fetch all UDT cells locked by the protocol-level funding lock for a given
   * UDT script. Useful when preparing executions that spend from the shared
   * pool.
   */
  async findFundingUdtCells(
    signer: ccc.Signer,
    udtScript: ccc.ScriptLike
  ): Promise<ccc.Cell[]> {
    console.log(`🔍 Searching for tipping UDT cells by lock script:`, {
      tippingTypeScript: this.script.codeHash.slice(0, 10) + "...",
      udtScript: ccc.Script.from(udtScript).codeHash.slice(0, 10) + "...",
    });

    // Parse protocol data to get funding lock code hash
    const { ProtocolData } = await import("../generated");
    const protocolData = ProtocolData.decode(
      this.connectedProtocolCell.outputData
    );
    const fundingLockCodeHash = ccc.hexFrom(
      protocolData.protocol_config.script_code_hashes
        .ckb_boost_funding_lock_code_hash
    );

    console.log(`🔑 Funding lock details:`, {
      fundingLockCodeHash: fundingLockCodeHash.slice(0, 10) + "...",
      protocolTypeHash: this.getProtocolTypeHash().slice(0, 10) + "...",
    });

    // Search by funding lock script directly - much more efficient!
    const fundingLockScript = {
      codeHash: fundingLockCodeHash,
      hashType: "type" as const,
      args: this.getProtocolTypeHash(),
    };

    const fundingLockedCells = signer.client.findCells({
      script: fundingLockScript,
      scriptType: "lock",
      scriptSearchMode: "exact",
    });

    const tippingUdtCells: ccc.Cell[] = [];
    const targetUdtScript = ccc.Script.from(udtScript);

    for await (const cell of fundingLockedCells) {
      // Filter only cells that have the specific UDT type script
      if (
        cell.cellOutput.type &&
        cell.cellOutput.type.codeHash === targetUdtScript.codeHash &&
        cell.cellOutput.type.args === targetUdtScript.args
      ) {
        tippingUdtCells.push(cell);
        console.log(`✅ Found tipping UDT cell:`, {
          outPoint: cell.outPoint,
          capacity: cell.cellOutput.capacity.toString(),
          udtCodeHash: cell.cellOutput.type.codeHash.slice(0, 10) + "...",
          udtArgs: cell.cellOutput.type.args.slice(0, 10) + "...",
        });
      }
    }

    console.log(`📊 Funding lock UDT search results:`, {
      totalFundingLockCells: "checked all funding-locked cells",
      matchingUdtCells: tippingUdtCells.length,
      targetUdtCodeHash: targetUdtScript.codeHash.slice(0, 10) + "...",
    });

    if (tippingUdtCells.length === 0) {
      console.warn(
        `❌ No funding lock UDT cells found for UDT ${targetUdtScript.codeHash.slice(0, 10)}...`
      );
    }

    return tippingUdtCells;
  }

  /**
   * Gather a complete summary of the shared funding pool, including aggregated
   * CKB capacity and UDT balances grouped by their script hash.
   */
  async collectFundingPool(signer: ccc.Signer): Promise<FundingPoolSummary> {
    const chainClient = signer.client;
    const fundingLockScript = await this.getFundingLockScript();

    const collector = chainClient.findCells({
      script: fundingLockScript,
      scriptType: "lock",
      scriptSearchMode: "exact",
    });

    const ckbCells: ccc.Cell[] = [];
    let totalCapacity = 0n;
    const udtCellsByType = new Map<string, ccc.Cell[]>();
    const udtTotalsByType = new Map<string, bigint>();

    for await (const cell of collector) {
      if (cell.cellOutput.type) {
        const typeHash = cell.cellOutput.type.hash();
        const existingCells = udtCellsByType.get(typeHash) ?? [];
        existingCells.push(cell);
        udtCellsByType.set(typeHash, existingCells);

        const amount = this.calculateUdtBalance([cell]);
        const previous = udtTotalsByType.get(typeHash) ?? 0n;
        udtTotalsByType.set(typeHash, previous + amount);
      } else {
        ckbCells.push(cell);
        totalCapacity += ccc.numFrom(cell.cellOutput.capacity);
      }
    }

    return {
      ckbCells,
      totalCapacity,
      udtCellsByType,
      udtTotalsByType,
    };
  }

  private getProtocolTypeHash(): ccc.Hex {
    const protocolType = this.connectedProtocolCell.cellOutput.type;
    if (!protocolType) {
      throw new Error("Connected protocol cell is missing a type script");
    }
    return protocolType.hash();
  }

  private async getFundingLockCodeHash(): Promise<ccc.Hex> {
    const { ProtocolData } = await import("../generated");
    const protocolData = ProtocolData.decode(
      this.connectedProtocolCell.outputData
    );
    const codeHash =
      protocolData.protocol_config?.script_code_hashes
        ?.ckb_boost_funding_lock_code_hash;

    if (!codeHash) {
      throw new Error(
        "Protocol data does not specify a funding lock code hash"
      );
    }

    return ccc.hexFrom(codeHash);
  }

  private async getFundingLockScript(): Promise<ccc.Script> {
    const codeHash = await this.getFundingLockCodeHash();
    const protocolTypeHash = this.getProtocolTypeHash();

    return ccc.Script.from({
      codeHash,
      hashType: "type" as const,
      args: protocolTypeHash,
    });
  }

  private calculateUdtBalance(cells: ccc.Cell[]): bigint {
    let total = 0n;
    for (const cell of cells) {
      const data = cell.outputData;
      if (data && data.length >= 16) {
        total += ccc.numFromBytes(data.slice(0, 16));
      }
    }
    return total;
  }
}
