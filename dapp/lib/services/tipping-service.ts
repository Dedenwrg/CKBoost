import { ccc, ssri } from "@ckb-ccc/connector-react";
import {
  ConnectedTypeID,
  TippingData,
  type TippingDataLike,
  type ProtocolDataLike,
} from "ssri-ckboost/types";
import { Tipping, type FundingPoolSummary } from "ssri-ckboost";
import { deploymentManager } from "../ckb/deployment-manager";
import {
  fetchTippingByTypeId,
  fetchTippingsConnectedToProtocol,
  extractTypeIdFromTippingCell,
} from "../ckb/tipping-cells";
import { debug } from "../utils/debug";
import { sendTransactionWithFeeRetry } from "../ckb/transaction-wrapper";
import { TippingInfo } from "../providers/tipping-provider";

export class TippingService {
  private signer?: ccc.Signer;
  private tipping: Tipping | null;
  private readonly protocolCell: ccc.Cell;
  private readonly tippingTypeCodeHash: ccc.Hex;

  constructor(
    signer: ccc.Signer | undefined,
    tipping: Tipping | null,
    protocolCell: ccc.Cell
  ) {
    this.signer = signer;
    this.tipping = tipping;
    this.protocolCell = protocolCell;

    const network = deploymentManager.getCurrentNetwork();
    const codeHash = deploymentManager.getContractCodeHash(
      network,
      "ckboostTippingType"
    );
    if (!codeHash) {
      throw new Error("Tipping type contract not deployed");
    }
    this.tippingTypeCodeHash = codeHash;
  }

  setSigner(signer: ccc.Signer | undefined) {
    this.signer = signer;
  }

  setTipping(tipping: Tipping | null) {
    this.tipping = tipping;
  }

  /**
   * Propose or update a tipping on-chain via SSRI executor
   */
  async updateTipping(
    tippingData: TippingDataLike,
    tx?: ccc.Transaction
  ): Promise<string> {
    if (!this.signer) {
      throw new Error("Wallet connection required to propose tipping");
    }

    const tipping = await this.ensureTippingInstance();
    if (!tipping) {
      throw new Error("Unable to initialise tipping executor context");
    }

    try {
      const updateTippingTx = await tipping.updateTipping(
        this.signer,
        tippingData,
        tx
      );
      const txHash = await sendTransactionWithFeeRetry(
        this.signer,
        updateTippingTx.res
      );
      return txHash;
    } catch (error) {
      debug.error("Failed to propose tipping", error);
      throw error;
    }
  }

  /**
   * Aggregate the shared funding pool locked by the protocol funding lock
   */
  async getFundingSummary(): Promise<FundingPoolSummary | null> {
    if (!this.signer) {
      return null;
    }

    const tipping = await this.ensureTippingInstance();
    if (!tipping) {
      return null;
    }

    try {
      return await tipping.collectFundingPool(this.signer);
    } catch (error) {
      debug.error("Failed to collect funding pool summary", error);
      return null;
    }
  }

  /**
   * Fetch tippings referenced by protocol data (Byte32 identifiers)
   */
  async fetchTippingsByIds(
    typeIds: ccc.HexLike[],
    client: ccc.Client
  ): Promise<TippingInfo[]> {
    const results = await Promise.all(
      typeIds.map(async (typeId) => {
        const cell = await fetchTippingByTypeId(
          typeId as ccc.Hex,
          this.tippingTypeCodeHash,
          client,
          this.protocolCell
        );

        if (!cell) {
          return null;
        }

        try {
          const data = TippingData.decode(cell.outputData);
          const extractedTypeId =
            extractTypeIdFromTippingCell(cell) ?? (typeId as ccc.Hex);

          return {
            typeId: extractedTypeId,
            cell,
            data,
            metadata: data.metadata,
            comments: [],
            additionalTips: [],
          } as TippingInfo;
        } catch (error) {
          debug.warn("Failed to decode tipping cell", error);
          return null;
        }
      })
    );

    return results.filter(
      (tipping): tipping is TippingInfo => tipping !== null
    );
  }

  /**
   * Discover all tippings associated with the protocol by scanning
   */
  async fetchTippingsForProtocol(client: ccc.Client): Promise<TippingInfo[]> {
    if (!client) {
      return [];
    }

    const protocolTypeHash = this.protocolCell.cellOutput.type?.hash();
    if (!protocolTypeHash) {
      return [];
    }

    const cells = await fetchTippingsConnectedToProtocol(
      client,
      this.tippingTypeCodeHash,
      protocolTypeHash
    );

    return cells
      .map((cell) => {
        try {
          const data = TippingData.decode(cell.outputData);
          const typeId = extractTypeIdFromTippingCell(cell);
          if (!typeId) {
            return null;
          }

          return {
            typeId,
            cell,
            data,
            metadata: data.metadata,
            comments: [],
            additionalTips: [],
          } as TippingInfo;
        } catch (error) {
          debug.warn("Failed to decode tipping", error);
          return null;
        }
      })
      .filter((tipping): tipping is TippingInfo => tipping !== null);
  }

  /**
   * Convenience helper to combine protocol data and chain lookups
   */
  async loadApprovedTippings(
    protocolData: ProtocolDataLike | null | undefined,
    client: ccc.Client
  ): Promise<TippingInfo[]> {
    const approved = protocolData?.tippings_approved ?? [];

    if (approved.length > 0) {
      return this.fetchTippingsByIds(approved, client);
    }

    return this.fetchTippingsForProtocol(client);
  }

  private async ensureTippingInstance(): Promise<Tipping | null> {
    if (this.tipping) {
      return this.tipping;
    }

    const network = deploymentManager.getCurrentNetwork();
    const codeOutPoint = deploymentManager.getContractOutPoint(
      network,
      "ckboostTippingType"
    );
    if (!codeOutPoint) {
      debug.warn(
        "Tipping type contract out point not found in deployments.json"
      );
      return null;
    }

    const executorUrl =
      process.env.NEXT_PUBLIC_SSRI_EXECUTOR_URL || "http://localhost:9090";
    const executor = new ssri.ExecutorJsonRpc(executorUrl);

    const protocolTypeHash = this.protocolCell.cellOutput.type?.hash();
    if (!protocolTypeHash) {
      debug.warn(
        "Protocol cell missing type hash; cannot initialise tipping SSRI"
      );
      return null;
    }

    const placeholderArgs = ConnectedTypeID.encode({
      type_id: ("0x" + "00".repeat(32)) as ccc.Hex,
      connected_key: protocolTypeHash,
    });

    const script = ccc.Script.from({
      codeHash: this.tippingTypeCodeHash,
      hashType: "type" as const,
      args: ccc.hexFrom(placeholderArgs),
    });

    this.tipping = new Tipping(codeOutPoint, script, this.protocolCell, {
      executor,
    });
    return this.tipping;
  }
}
