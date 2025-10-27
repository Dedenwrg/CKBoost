import { ccc } from "@ckb-ccc/core";
import { ssri } from "@ckb-ccc/ssri";
import {
  ConnectedTypeID,
  TippingData,
  type TippingDataLike,
} from "../generated";
import { createScopedLogger } from "../logging/index.js";

const log = createScopedLogger("Tipping");

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
 * the Campaign helper but targets the tipping type script, so all tippings
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
   * Submit or update a tipping via the SSRI executor. The tipping is
   * linked to the protocol's type hash so it automatically leverages the shared
   * funding pool managed by the protocol funding lock.
   */
  async updateTipping(
    signer: ccc.Signer,
    tippingData: TippingDataLike,
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

    const tippingDataBytes = TippingData.encode(tippingData);
    const tippingDataHex = ccc.hexFrom(tippingDataBytes);
    const txHex = ccc.hexFrom(txReq.toBytes());

    const res = await this.executor.runScript(
      this.code,
      "CKBoostTipping.update_tipping",
      [txHex, tippingDataHex],
      { script: this.script }
    );

    // Parse the returned transaction - the result is a hex string that needs to be parsed
    if (res) {
      resTx = res.map((res) => ccc.Transaction.fromBytes(res));
      // Add the tipping code cell as a dependency
      resTx.res.addCellDeps({
        outPoint: this.code,
        depType: "code",
      }); // SSRI Method might fail to find the tipping cell by out point, so we need to find it manually for both input and output
      log.info("Finding tipping cell by type:", {
        codeHash: this.script.codeHash,
        hashType: "type",
        args: this.script.args,
      });
      for await (const cell of signer.client.findCellsByType({
        codeHash: this.script.codeHash,
        hashType: "type",
        args: this.script.args, // Empty args to match any args
      })) {
        log.info("Found tipping cell:", cell.outPoint);
        // Check if the cell is in the inputs of the transaction. If none, add it as an input.
        if (
          !resTx.res.inputs.some(
            (input) =>
              input.previousOutput.txHash === cell.outPoint.txHash &&
              input.previousOutput.index === cell.outPoint.index
          )
        ) {
          log.info("Adding tipping cell as input:", cell.outPoint);
          resTx.res.addInput(cell);
        }
        // Check if the cell is in the outputs of the transaction. If none, add it as an output.
        if (
          !resTx.res.outputs.some(
            (output) =>
              output.type?.codeHash === cell.cellOutput.type?.codeHash &&
              output.type?.args === cell.cellOutput.type?.args
          )
        ) {
          log.info("Adding new tipping cell as output:", cell.outPoint);
          const tippingCellOutput = ccc.CellOutput.from({
            lock: cell.cellOutput.lock,
            type: cell.cellOutput.type,
          });
          resTx.res.addOutput(
            tippingCellOutput,
            ccc.hexFrom(TippingData.encode(tippingData))
          );
        }
      }

      // Find the tipping cell output (should be the first output with the tipping type script)
      const tippingCellOutputIndex = resTx.res.outputs.findIndex(
        (output) => output.type?.codeHash === this.script.codeHash
      );

      if (tippingCellOutputIndex === -1) {
        log.info(
          "Tipping cell output not found in transaction. TxHex:",
          ccc.hexFrom(resTx.res.toBytes())
        );
        throw new Error("Tipping cell output not found in transaction");
      }

      // Get the protocol cell type hash
      const connectedProtocolCellTypeHash =
        this.connectedProtocolCell.cellOutput.type?.hash();
      if (!connectedProtocolCellTypeHash) {
        throw new Error("ConnectedProtocolCellTypeHash is not found");
      }
      // Create ConnectedTypeID with the protocol cell type hash
      let tippingCellTypeArgs =
        resTx.res.outputs[tippingCellOutputIndex].type?.args;
      if (!tippingCellTypeArgs) {
        throw new Error("tippingCellTypeArgs is empty.");
      }

      // Handle different type args formats
      let connectedTypeId;
      const argsBytes = ccc.bytesFrom(tippingCellTypeArgs);

      if (argsBytes.length === 0 || tippingCellTypeArgs === "0x") {
        // Empty args - create new ConnectedTypeID with a generated type_id
        // Generate a unique type_id based on the transaction hash and output index
        const txHash = resTx.res.hash();
        const typeIdBytes = ccc.bytesFrom(txHash).slice(0, 32);

        connectedTypeId = {
          type_id: ccc.hexFrom(typeIdBytes),
          connected_key: connectedProtocolCellTypeHash,
        };
        log.info("Connected_Key: ", connectedProtocolCellTypeHash);
      } else if (argsBytes.length === 32) {
        // Direct protocol reference - wrap in ConnectedTypeID
        // Use the existing 32 bytes as the type_id
        connectedTypeId = {
          type_id: tippingCellTypeArgs,
          connected_key: connectedProtocolCellTypeHash,
        };
        log.info("Connected_Key: ", connectedProtocolCellTypeHash);
      } else if (argsBytes.length === 76) {
        // Already a ConnectedTypeID - decode and update
        connectedTypeId = ConnectedTypeID.decode(tippingCellTypeArgs);
        connectedTypeId.connected_key = connectedProtocolCellTypeHash;
        log.info("Connected_Key: ", connectedProtocolCellTypeHash);
      } else {
        throw new Error(
          `Invalid tipping type args length: ${argsBytes.length}. Expected 0, 32, or 76 bytes.`
        );
      }

      // Encode ConnectedTypeID and set it as the tipping type script args
      const connectedTypeIdBytes = ConnectedTypeID.encode(connectedTypeId);
      const connectedTypeIdHex = ccc.hexFrom(connectedTypeIdBytes);
      log.info("ConnectedTypeIDHex: ", connectedTypeIdHex);

      // Update the tipping cell's type script args with the ConnectedTypeID
      if (resTx.res.outputs[tippingCellOutputIndex].type) {
        log.info("Updating tipping cell type args with ConnectedTypeID");
        resTx.res.outputs[tippingCellOutputIndex].type.args =
          connectedTypeIdHex;
        log.info(
          "Updated tipping cell type args: ",
          resTx.res.outputs[tippingCellOutputIndex].type.args
        );
      }

      resTx.res.addCellDeps({
        outPoint: this.connectedProtocolCell.outPoint,
        depType: "code",
      });
      return resTx;
    } else {
      throw new Error("Failed to update tipping");
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
    log.info(`🔍 Searching for tipping UDT cells by lock script:`, {
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

    log.info(`🔑 Funding lock details:`, {
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
        log.info(`✅ Found tipping UDT cell:`, {
          outPoint: cell.outPoint,
          capacity: cell.cellOutput.capacity.toString(),
          udtCodeHash: cell.cellOutput.type.codeHash.slice(0, 10) + "...",
          udtArgs: cell.cellOutput.type.args.slice(0, 10) + "...",
        });
      }
    }

    log.info(`📊 Funding lock UDT search results:`, {
      totalFundingLockCells: "checked all funding-locked cells",
      matchingUdtCells: tippingUdtCells.length,
      targetUdtCodeHash: targetUdtScript.codeHash.slice(0, 10) + "...",
    });

    if (tippingUdtCells.length === 0) {
      log.warn(
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
    log.info(
      "ssri-ckboost: collectFundingPool: fundingLockScript",
      fundingLockScript
    );

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
        log.info("ssri-ckboost: collectFundingPool: pushing ckbCell", cell);
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
