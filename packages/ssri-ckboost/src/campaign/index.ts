import { ccc } from "@ckb-ccc/core";
import { ssri } from "@ckb-ccc/ssri";
import {
  CampaignData,
  ConnectedTypeID,
  type CampaignDataLike,
} from "../generated";
import { encodeClaimablePoolData } from "ckb-claimable-pool-lock";
import { createScopedLogger } from "../logging/index.js";

const log = createScopedLogger("Campaign");

function normalizeByte32Hex(value: ccc.HexLike, label: string): ccc.Hex {
  const bytes = ccc.bytesFrom(value);
  if (bytes.length !== 32) {
    throw new Error(`${label} must be 32 bytes, received ${bytes.length}`);
  }
  return ccc.hexFrom(bytes);
}

/**
 * Represents a CKBoost Campaign contract for managing campaign operations.
 *
 * This class provides methods for managing campaigns including creating,
 * updating, and managing quest completions.
 *
 * @public
 * @category Campaign
 */
export class Campaign extends ssri.Trait {
  public readonly script: ccc.Script;
  public readonly connectedProtocolCell: ccc.Cell;

  /**
   * Constructs a new Campaign instance.
   *
   * @param code - The script code cell of the Campaign contract.
   * @param script - The type script of the Campaign contract.
   * @param config - Optional configuration with executor.
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
   * Update a campaign with new data
   *
   * @param _signer - The signer for the transaction
   * @param campaignData - The campaign data to update
   * @param tx - Optional existing transaction to build upon
   * @returns The updated transaction
   */
  async updateCampaign(
    signer: ccc.Signer,
    campaignData: CampaignDataLike,
    tx?: ccc.Transaction
  ): Promise<ssri.ExecutorResponse<ccc.Transaction>> {
    if (!this.executor) {
      throw new Error("Executor required for SSRI operations");
    }

    let resTx;

    const txReq = ccc.Transaction.from(tx ?? {});
    let isNewCampaign = false;
    // Ensure at least one input for the transaction
    if (this.script.args.length <= 2) {
      isNewCampaign = true;
    } else {
    const connectedTypeId = ConnectedTypeID.decode(this.script.args);
      isNewCampaign = connectedTypeId.type_id === "0x" + "00".repeat(32);
    }
    if (txReq.inputs.length === 0 && isNewCampaign) {
      await txReq.completeInputsAtLeastOne(signer);
      await txReq.completeInputsByCapacity(signer);
    }

    // Serialize campaign data - just let the mol library handle it
    log.info(
      "Encoding campaign with",
      campaignData.quests?.length || 0,
      "quests"
    );

    // Debug: Log the campaign data structure before encoding
    log.info("Campaign data structure before encoding:", {
      endorserLockHash: !!campaignData.endorser_lock_hash,
      hasMetadata: !!campaignData.metadata,
      questCount: campaignData.quests?.length || 0,
      rulesCount: campaignData.rules?.length || 0,
      categoriesCount: campaignData.metadata?.categories?.length || 0,
    });

    // Debug: Log the first quest if it exists
    if (campaignData.quests && campaignData.quests.length > 0) {
      const firstQuest = campaignData.quests[0];
      log.info("First quest structure:", {
        quest_id: firstQuest.quest_id,
        hasMetadata: !!firstQuest.metadata,
        points: firstQuest.points,
        rewardsCount: firstQuest.rewards_on_completion?.length || 0,
        subTasksCount: firstQuest.sub_tasks?.length || 0,
        acceptedUserTypeIdsCount:
          firstQuest.accepted_submission_user_type_ids?.length || 0,
      });
    }

    let campaignDataHex: string;
    try {
      const campaignDataBytes = CampaignData.encode(campaignData);
      campaignDataHex = ccc.hexFrom(campaignDataBytes);
      log.info(
        "Campaign encoded successfully, hex length:",
        campaignDataHex.length
      );
      log.info("First 100 bytes of hex:", campaignDataHex.slice(0, 100));

      // Try to decode it immediately to verify
      try {
        const decoded = CampaignData.decode(campaignDataHex);
        log.info(
          "Immediate decode verification successful, quest count:",
          decoded.quests?.length || 0
        );
      } catch (decodeErr) {
        log.error("Failed to decode immediately after encoding:", decodeErr);
      }
    } catch (encodeErr) {
      log.error("Failed to encode campaign data:", encodeErr);
      throw encodeErr;
    }

    const txHex = ccc.hexFrom(txReq.toBytes());

    log.info("Calling SSRI executor with:", {
      codeOutpoint: this.code,
      method: "CKBoostCampaign.update_campaign",
      scriptCodeHash: this.script.codeHash,
      scriptHashType: this.script.hashType,
      scriptArgs: this.script.args,
    });

    log.info("txHex", txHex);
    log.info("campaignDataHex", campaignDataHex);

    // Execute SSRI method
    try {
      const methodPath = "CKBoostCampaign.update_campaign";
      const res = await this.executor.runScript(
        this.code,
        methodPath,
        [txHex, campaignDataHex],
        { script: this.script }
      );
      // Parse the returned transaction - the result is a hex string that needs to be parsed
      if (res) {
        resTx = res.map((res) => ccc.Transaction.fromBytes(res));
        // Add the campaign code cell as a dependency
        resTx.res.addCellDeps({
          outPoint: this.code,
          depType: "code",
        });

        // SSRI Method might fail to find the campaign cell by out point, so we need to find it manually for both input and output
        log.info("Finding campaign cell by type:", {
          codeHash: this.script.codeHash,
          hashType: "type",
          args: this.script.args,
        });
        for await (const cell of signer.client.findCellsByType({
          codeHash: this.script.codeHash,
          hashType: "type",
          args: this.script.args, // Empty args to match any args
        })) {
          log.info("Found campaign cell:", cell.outPoint);
          // Check if the cell is in the inputs of the transaction. If none, add it as an input.
          if (
            !resTx.res.inputs.some(
              (input) =>
                input.previousOutput.txHash === cell.outPoint.txHash &&
                input.previousOutput.index === cell.outPoint.index
            )
          ) {
            log.info("Adding campaign cell as input:", cell.outPoint);
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
            log.info("Adding new campaign cell as output:", cell.outPoint);
            const campaignCellOutput = ccc.CellOutput.from({
              lock: cell.cellOutput.lock,
              type: cell.cellOutput.type,
            });
            resTx.res.addOutput(
              campaignCellOutput,
              ccc.hexFrom(CampaignData.encode(campaignData))
            );
          }
        }

        // Find the campaign cell output (should be the first output with the campaign type script)
        const campaignCellOutputIndex = resTx.res.outputs.findIndex(
          (output) => output.type?.codeHash === this.script.codeHash
        );

        if (campaignCellOutputIndex === -1) {
          log.info(
            "Campaign cell output not found in transaction. TxHex:",
            ccc.hexFrom(resTx.res.toBytes())
          );
          throw new Error("Campaign cell output not found in transaction");
        }

        // Get the protocol cell type hash
        const connectedProtocolCellTypeHash =
          this.connectedProtocolCell.cellOutput.type?.hash();
        if (!connectedProtocolCellTypeHash) {
          throw new Error("ConnectedProtocolCellTypeHash is not found");
        }
        // Create ConnectedTypeID with the protocol cell type hash
        let campaignCellTypeArgs =
          resTx.res.outputs[campaignCellOutputIndex].type?.args;
        if (!campaignCellTypeArgs) {
          throw new Error("campaignCellTypeArgs is empty.");
        }

        // Handle different type args formats
        let connectedTypeId;
        const argsBytes = ccc.bytesFrom(campaignCellTypeArgs);

        if (argsBytes.length === 0 || campaignCellTypeArgs === "0x") {
          // Empty args - create new ConnectedTypeID with a generated type_id
          // Generate a unique type_id based on the transaction hash and output index
          const txHash = resTx.res.hash();
          const typeIdBytes = ccc.bytesFrom(txHash).slice(0, 32);

          connectedTypeId = {
            type_id: ccc.hexFrom(typeIdBytes),
            connected_key: connectedProtocolCellTypeHash,
          };
        } else if (argsBytes.length === 32) {
          // Direct protocol reference - wrap in ConnectedTypeID
          // Use the existing 32 bytes as the type_id
          connectedTypeId = {
            type_id: campaignCellTypeArgs,
            connected_key: connectedProtocolCellTypeHash,
          };
        } else if (argsBytes.length === 76) {
          // Already a ConnectedTypeID - decode and update
          connectedTypeId = ConnectedTypeID.decode(campaignCellTypeArgs);
          connectedTypeId.connected_key = connectedProtocolCellTypeHash;
        } else {
          throw new Error(
            `Invalid campaign type args length: ${argsBytes.length}. Expected 0, 32, or 76 bytes.`
          );
        }

        // Encode ConnectedTypeID and set it as the campaign type script args
        const connectedTypeIdBytes = ConnectedTypeID.encode(connectedTypeId);
        const connectedTypeIdHex = ccc.hexFrom(connectedTypeIdBytes);

        // Update the campaign cell's type script args with the ConnectedTypeID
        if (resTx.res.outputs[campaignCellOutputIndex].type) {
          resTx.res.outputs[campaignCellOutputIndex].type.args =
            connectedTypeIdHex;
        }

        // Add the protocol cell as a dependency
        resTx.res.addCellDeps({
          outPoint: this.connectedProtocolCell.outPoint,
          depType: "code",
        });
        return resTx;
      } else {
        throw new Error("Failed to update campaign");
      }
    } catch (error) {
      log.error("SSRI executor error:", error);
      log.error("Error details:", JSON.stringify(error, null, 2));
      throw error;
    }
  }

  /**
   * Find campaign-funded UDT cells for reward distribution by searching by lock script
   *
   * @param signer - The signer for querying cells
   * @param campaignTypeScript - The campaign's type script
   * @param udtScript - The UDT script to find
   * @returns Array of UDT cells locked by campaign
   */
  private async findCampaignUdtCells(
    signer: ccc.Signer,
    campaignTypeScript: ccc.Script,
    udtScript: ccc.ScriptLike
  ): Promise<ccc.Cell[]> {
    log.info(`🔍 Searching for campaign UDT cells by lock script:`, {
      campaignTypeScript: campaignTypeScript.codeHash.slice(0, 10) + "...",
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
    const campaignTypeHash = campaignTypeScript.hash();

    log.info(`🔑 Funding lock details:`, {
      fundingLockCodeHash: fundingLockCodeHash.slice(0, 10) + "...",
      campaignTypeHash: campaignTypeHash.slice(0, 10) + "...",
    });

    // Search by funding lock script directly - much more efficient!
    const fundingLockScript = {
      codeHash: fundingLockCodeHash,
      hashType: "type" as const,
      args: campaignTypeHash,
    };

    const fundingLockedCells = signer.client.findCells({
      script: fundingLockScript,
      scriptType: "lock",
      scriptSearchMode: "exact",
    });

    const campaignUdtCells: ccc.Cell[] = [];
    const targetUdtScript = ccc.Script.from(udtScript);

    for await (const cell of fundingLockedCells) {
      // Filter only cells that have the specific UDT type script
      if (
        cell.cellOutput.type &&
        cell.cellOutput.type.codeHash === targetUdtScript.codeHash &&
        cell.cellOutput.type.args === targetUdtScript.args
      ) {
        campaignUdtCells.push(cell);
        log.info(`✅ Found campaign UDT cell:`, {
          outPoint: cell.outPoint,
          capacity: cell.cellOutput.capacity.toString(),
          udtCodeHash: cell.cellOutput.type.codeHash.slice(0, 10) + "...",
          udtArgs: cell.cellOutput.type.args.slice(0, 10) + "...",
        });
      }
    }

    log.info(`📊 Funding lock UDT search results:`, {
      totalFundingLockCells: "checked all funding-locked cells",
      matchingUdtCells: campaignUdtCells.length,
      targetUdtCodeHash: targetUdtScript.codeHash.slice(0, 10) + "...",
    });

    if (campaignUdtCells.length === 0) {
      log.warn(
        `❌ No funding lock UDT cells found for UDT ${targetUdtScript.codeHash.slice(0, 10)}...`
      );
    }

    return campaignUdtCells;
  }

  /**
   * Calculate total available UDT balance from campaign cells
   *
   * @param campaignUdtCells - Array of campaign UDT cells. Make sure you're using the same type of UDT.
   * @returns Total balance as bigint
   */
  private calculateTotalUdtBalance(campaignUdtCells: ccc.Cell[]): bigint {
    let totalBalance = 0n;

    for (const cell of campaignUdtCells) {
      // UDT amount is stored in the first 16 bytes of output data (Uint128)
      const outputData = cell.outputData;
      if (outputData.length >= 16) {
        const amountBytes = outputData.slice(0, 16);
        const amount = ccc.numFromBytes(amountBytes);
        totalBalance += amount;
      }
    }

    return totalBalance;
  }

  private getQuestPointsAmount(
    campaignData: CampaignDataLike,
    questId: number
  ): bigint {
    const quest = campaignData.quests?.find(
      (q) => Number(q.quest_id) === questId
    );
    if (!quest) {
      throw new Error(`Quest ${questId} not found in campaign data`);
    }

    const pointsAmount = ccc.numFrom(quest.points);
    if (pointsAmount === 0n) {
      throw new Error(`Quest ${questId} has no points reward`);
    }

    return pointsAmount;
  }

  /**
   * Approve quest completions and mint Points
   *
   * @param signer - The signer for the transaction
   * @param campaignData - The current campaign data
   * @param questId - The quest ID to approve completions for
   * @param userTypeIds - Array of user type IDs to approve (as Byte32)
   * @param claimantLockHashes - Array of claimant lock hashes aligned with userTypeIds
   * @param claimablePoolLockCodeHash - Claimable Pool Lock type script hash
   * @param tx - Optional existing transaction to build upon
   * @returns The updated transaction
   */
  async approveCompletion(
    signer: ccc.Signer,
    campaignData: CampaignDataLike,
    questId: number,
    userTypeIds: ccc.HexLike[],
    claimantLockHashes: ccc.HexLike[],
    claimablePoolLockCodeHash: ccc.HexLike,
    tx?: ccc.Transaction
  ): Promise<ssri.ExecutorResponse<ccc.Transaction>> {
    if (!this.executor) {
      throw new Error("Executor required for SSRI operations");
    }

    let resTx: ssri.ExecutorResponse<ccc.Transaction>;

    const txReq = ccc.Transaction.from(tx ?? {});
    // Ensure at least one input for the transaction
    if (txReq.inputs.length === 0 && !this.script.args) {
      await txReq.completeInputsAtLeastOne(signer);
      await txReq.completeInputsByCapacity(signer);
    }

    // Serialize the parameters
    const campaignDataBytes = CampaignData.encode(campaignData);
    const campaignDataHex = ccc.hexFrom(campaignDataBytes);
    const questIdHex = ccc.hexFrom(ccc.numToBytes(questId, 4)); // u32

    // Convert user type IDs to Byte32Vec
    const userTypeIdsList: ccc.HexLike[] = [];
    for (const id of userTypeIds) {
      const bytes = ccc.bytesFrom(id);
      // Ensure exactly 32 bytes
      if (bytes.length !== 32) {
        // If the ID is shorter, pad it; if longer, truncate
        const paddedBytes = new Uint8Array(32);
        paddedBytes.set(bytes.slice(0, 32));
        userTypeIdsList.push(ccc.hexFrom(paddedBytes));
      } else {
        userTypeIdsList.push(ccc.hexFrom(bytes));
      }
    }

    // Create Byte32Vec with proper molecule encoding
    const byte32Vec = ccc.mol.Byte32Vec.encode(userTypeIdsList);
    const userTypeIdsHex = ccc.hexFrom(byte32Vec);

    const txHex = ccc.hexFrom(txReq.toBytes());

    log.info("Calling SSRI executor for approve_completion with:", {
      codeOutpoint: this.code,
      method: "CKBoostCampaign.approve_completion",
      questId,
      userCount: userTypeIds.length,
      userTypeIdsHex: userTypeIdsHex.slice(0, 100) + "...",
    });

    // Execute SSRI method
    try {
      const methodPath = "CKBoostCampaign.approve_completion";
      const res = await this.executor.runScript(
        this.code,
        methodPath,
        [txHex, campaignDataHex, questIdHex, userTypeIdsHex],
        { script: this.script }
      );

      // Parse the returned transaction
      if (res) {
        resTx = res.map((res) => ccc.Transaction.fromBytes(res));
        // NOTE: This is a temporary fix since SSRI method couldn't return the new campaign cell in output.
        const updatedCampaignData =
          resTx.res.outputsData[resTx.res.outputsData.length - 1];
        let sanitizedCampaignDataHex = ccc.hexFrom(updatedCampaignData);
        try {
          const normalizedCampaignData = CampaignData.decode(
            sanitizedCampaignDataHex
          ) as CampaignDataLike;
          const participantSet = new Set<string>();
          for (const quest of normalizedCampaignData.quests || []) {
            for (const participant of quest.accepted_submission_user_type_ids ||
              []) {
              participantSet.add(
                ccc.hexFrom(participant as ccc.HexLike).toLowerCase()
              );
            }
          }
          normalizedCampaignData.participants_count = BigInt(
            participantSet.size
          );
          log.info("normalizedCampaignData", normalizedCampaignData);
          log.info("participantSet", participantSet);
          log.info("participantSet.size", participantSet.size);
          log.info(
            "normalizedCampaignData.participants_count",
            normalizedCampaignData.participants_count
          );
          sanitizedCampaignDataHex = ccc.hexFrom(
            CampaignData.encode(normalizedCampaignData)
          );
        } catch (error) {
          log.warn("Failed to normalize participants count", error);
        }

        // Add the campaign code cell as a dependency
        resTx.res.addCellDeps({
          outPoint: this.code,
          depType: "code",
        });

        // Add the protocol cell as a dependency
        resTx.res.addCellDeps({
          outPoint: this.connectedProtocolCell.outPoint,
          depType: "code",
        });

        // SSRI Method might fail to find the campaign cell by out point, so we need to find it manually for both input and output
        log.info("Finding campaign cell by type:", {
          codeHash: this.script.codeHash,
          hashType: "type",
          args: this.script.args,
        });
        for await (const cell of signer.client.findCellsByType({
          codeHash: this.script.codeHash,
          hashType: "type",
          args: this.script.args, // Empty args to match any args
        })) {
          log.info("Found campaign cell:", cell.outPoint);
          // Check if the cell is in the inputs of the transaction. If none, add it as an input.
          if (
            !resTx.res.inputs.some(
              (input) =>
                input.previousOutput.txHash === cell.outPoint.txHash &&
                input.previousOutput.index === cell.outPoint.index
            )
          ) {
            log.info("Adding campaign cell as input:", cell.outPoint);
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
            log.info("Adding new campaign cell as output:", cell.outPoint);
            const campaignCellOutput = ccc.CellOutput.from({
              lock: cell.cellOutput.lock,
              type: cell.cellOutput.type,
            });
            resTx.res.addOutput(campaignCellOutput, sanitizedCampaignDataHex);
          }
        }

        const campaignCellOutputIndex = resTx.res.outputs.findIndex(
          (output) => output.type?.codeHash === this.script.codeHash
        );
        if (campaignCellOutputIndex === -1) {
          throw new Error("Campaign cell output not found in transaction");
        }

        if (claimantLockHashes.length !== userTypeIds.length) {
          throw new Error("claimantLockHashes must be aligned with userTypeIds");
        }

        // Parse protocol data to get Points UDT code hash
        const { ProtocolData } = await import("../generated");
        const protocolData = ProtocolData.decode(
          this.connectedProtocolCell.outputData
        );
        const pointsUdtCodeHash = ccc.hexFrom(
          protocolData.protocol_config.script_code_hashes
            .ckb_boost_points_udt_type_code_hash
        );
        const protocolTypeHash =
          this.connectedProtocolCell.cellOutput.type?.hash();

        if (!protocolTypeHash) {
          throw new Error("Protocol cell missing type script");
        }

        const quest = campaignData.quests?.find(
          (q) => Number(q.quest_id) === questId
        );
        if (!quest) {
          throw new Error(`Quest ${questId} not found in campaign data`);
        }
        const pointsAmount = this.getQuestPointsAmount(campaignData, questId);

        log.info("Creating claimable Points pool cells:", {
          pointsUdtCodeHash,
          protocolTypeHash,
          pointsAmount: pointsAmount.toString(),
          userCount: userTypeIds.length,
        });

        // Get user type code hash from protocol data to find user cells
        const userTypeCodeHash = ccc.hexFrom(
          protocolData.protocol_config.script_code_hashes
            .ckb_boost_user_type_code_hash
        );

        const normalizedClaimablePoolLockCodeHash = normalizeByte32Hex(
          claimablePoolLockCodeHash,
          "claimablePoolLockCodeHash"
        );

        const entriesByClaimant = new Map<string, bigint>();
        for (const claimantLockHash of claimantLockHashes) {
          const normalizedClaimantLockHash = normalizeByte32Hex(
            claimantLockHash,
            "claimantLockHash"
          ).toLowerCase();
          entriesByClaimant.set(
            normalizedClaimantLockHash,
            (entriesByClaimant.get(normalizedClaimantLockHash) ?? 0n) +
              pointsAmount
          );
        }

        const entries = Array.from(entriesByClaimant.entries()).map(
          ([claimantLockHash, amount]) => ({
            claimantLockHash,
            amount,
          })
        );
        const recyclerLockHash = ccc.hexFrom(
          resTx.res.outputs[campaignCellOutputIndex].lock.hash()
        );
        const poolLock = {
          codeHash: normalizedClaimablePoolLockCodeHash,
          hashType: "type" as const,
          args: recyclerLockHash,
        };
        const pointsType = {
          codeHash: pointsUdtCodeHash,
          hashType: "type" as const,
          args: protocolTypeHash,
        };
        const chunkSize = 100;

        for (let start = 0; start < entries.length; start += chunkSize) {
          const chunk = entries.slice(start, start + chunkSize);
          const poolData = encodeClaimablePoolData(chunk);
          resTx.res.addOutput(
            ccc.CellOutput.from(
              {
                lock: poolLock,
                type: pointsType,
              },
              poolData
            ),
            poolData
          );
        }

        // Handle UDT reward distribution
        log.info(`\n💰 Processing UDT rewards distribution...`);

        // Get UDT rewards from quest
        const udtRewards = quest?.rewards_on_completion?.[0]?.udt_assets || [];
        log.info(
          `Found ${udtRewards.length} UDT reward types for quest ${questId}`
        );

        for (const udtAsset of udtRewards) {
          const udtScript = udtAsset.udt_script;
          const amountPerUser = Number(udtAsset.amount) || 0;

          if (amountPerUser > 0) {
            log.info(`\n🎯 Processing UDT reward:`, {
              udtCodeHash: ccc.hexFrom(udtScript.codeHash).slice(0, 10) + "...",
              amountPerUser,
              userCount: userTypeIds.length,
              totalRequired: amountPerUser * userTypeIds.length,
            });

            // Find campaign-funded UDT cells
            const campaignUdtCells = await this.findCampaignUdtCells(
              signer,
              this.script,
              udtScript
            );

            if (campaignUdtCells.length === 0) {
              log.warn(
                `⚠️ No campaign UDT cells found for reward distribution, skipping UDT ${ccc.hexFrom(udtScript.codeHash).slice(0, 10)}...`
              );
              continue;
            }

            // Calculate total available balance
            const totalAvailable =
              this.calculateTotalUdtBalance(campaignUdtCells);
            const totalRequired = BigInt(amountPerUser * userTypeIds.length);

            log.info(`💰 UDT balance check:`, {
              totalAvailable: totalAvailable.toString(),
              totalRequired: totalRequired.toString(),
              sufficient: totalAvailable >= totalRequired,
            });

            if (totalAvailable < totalRequired) {
              log.error(
                `❌ Insufficient UDT balance for rewards. Required: ${totalRequired}, Available: ${totalAvailable}`
              );
              throw new Error(
                `Insufficient UDT balance for ${ccc.hexFrom(udtScript.codeHash)} rewards`
              );
            }

            // Add campaign UDT cells as inputs
            let remainingToDistribute = totalRequired;
            const inputCells: ccc.Cell[] = [];

            for (const campaignUdtCell of campaignUdtCells) {
              if (remainingToDistribute <= 0) break;

              const cellBalance = this.calculateTotalUdtBalance([
                campaignUdtCell,
              ]);
              if (cellBalance > 0) {
                // Add as input
                resTx.res.addInput({
                  previousOutput: campaignUdtCell.outPoint,
                  since: "0x0",
                });

                inputCells.push(campaignUdtCell);
                remainingToDistribute -= cellBalance;

                log.info(`📥 Added UDT input cell:`, {
                  outPoint: campaignUdtCell.outPoint,
                  balance: cellBalance.toString(),
                  remainingToDistribute: remainingToDistribute.toString(),
                });
              }
            }

            // Create UDT reward outputs for each approved user
            let rewardIndex = 0;
            for (const userTypeId of userTypeIds) {
              const userTypeIdHex = ccc.hexFrom(userTypeId);

              log.info(
                `\n🎁 Creating UDT reward for user ${userTypeIdHex.slice(0, 10)}... (${rewardIndex + 1}/${userTypeIds.length})`
              );

              // Find user cell to get lock script (similar to Points logic)
              const userConnectedTypeId = {
                type_id: userTypeIdHex,
                connected_key: protocolTypeHash,
              };

              const encodedConnectedTypeId =
                ConnectedTypeID.encode(userConnectedTypeId);
              const encodedConnectedTypeIdHex = ccc.hexFrom(
                encodedConnectedTypeId
              );

              const userCells = signer.client.findCells({
                script: {
                  codeHash: userTypeCodeHash,
                  hashType: "type",
                  args: encodedConnectedTypeIdHex,
                },
                scriptType: "type",
                scriptSearchMode: "exact",
              });

              const userCellResult = await userCells.next();
              if (
                !userCellResult ||
                userCellResult.done ||
                !userCellResult.value
              ) {
                log.warn(
                  `❌ User cell not found for UDT reward: ${userTypeIdHex}, skipping`
                );
                continue;
              }

              const userCell = userCellResult.value;
              const userLock = userCell.cellOutput.lock;

              // Create UDT reward cell for user
              const udtRewardCell = {
                capacity: 0, // Will be set by the SDK
                lock: userLock,
                type: ccc.Script.from(udtScript),
              };

              // Add user cell as dependency
              resTx.res.addCellDeps({
                outPoint: userCell.outPoint,
                depType: "code",
              });

              // Add UDT reward output
              resTx.res.addOutput(
                udtRewardCell,
                ccc.numToBytes(amountPerUser, 16)
              );

              log.info(`✅ Created UDT reward cell:`, {
                userTypeId: userTypeIdHex.slice(0, 10) + "...",
                udtCodeHash:
                  ccc.hexFrom(udtScript.codeHash).slice(0, 10) + "...",
                amount: amountPerUser,
                lockCodeHash: userLock.codeHash.slice(0, 10) + "...",
              });

              rewardIndex++;
            }
            const changeAmount = totalAvailable - totalRequired;

            if (changeAmount > 0) {
              // Use first campaign udt cell's lock for change
              const changeLock = inputCells[0].cellOutput.lock;
              const changeCell = {
                capacity: 0, // Will be set by CCC
                lock: changeLock,
                type: ccc.Script.from(udtScript),
              };

              resTx.res.addOutput(changeCell, ccc.numToBytes(changeAmount, 16));
            }

            log.info(
              `✅ Completed UDT reward distribution for ${ccc.hexFrom(udtScript.codeHash).slice(0, 10)}...`
            );
          } else {
            log.info(
              `⏭️ Skipping UDT reward with zero amount: ${ccc.hexFrom(udtScript.codeHash).slice(0, 10)}...`
            );
          }
        }

        // Final transaction logging
        log.info(`🔍 Final transaction before return:`);
        log.info(`  Inputs: ${resTx.res.inputs.length}`);
        log.info(`  Outputs: ${resTx.res.outputs.length}`);
        log.info(`  OutputsData: ${resTx.res.outputsData.length}`);

        resTx.res.outputs.forEach((output, index) => {
          log.info(`  Output ${index}:`, {
            capacity: output.capacity.toString(),
            lockCodeHash: output.lock.codeHash.slice(0, 10) + "...",
            lockArgs: output.lock.args.slice(0, 10) + "...",
            typeCodeHash: output.type?.codeHash?.slice(0, 10) + "..." || "None",
            typeArgs: output.type?.args?.slice(0, 10) + "..." || "None",
            hasOutputData: index < resTx.res.outputsData.length,
            outputDataLength:
              index < resTx.res.outputsData.length
                ? resTx.res.outputsData[index].length
                : 0,
          });
        });

        return resTx;
      } else {
        throw new Error("Failed to approve quest completions");
      }
    } catch (error) {
      log.error("SSRI executor error:", error);
      log.error("Error details:", JSON.stringify(error, null, 2));
      throw error;
    }
  }
}
