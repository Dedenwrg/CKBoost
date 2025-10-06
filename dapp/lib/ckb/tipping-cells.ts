// CKB Blockchain Integration - Tipping Proposal Cell Operations
// Utilities for locating tipping cells associated with a protocol

import { ccc } from "@ckb-ccc/connector-react";
import { cccA } from "@ckb-ccc/connector-react/advanced";
import { ConnectedTypeID, type ConnectedTypeIDLike } from "ssri-ckboost/types";
import { debug } from "../utils/debug";

/**
 * Locate a tipping cell by its type ID (ConnectedTypeID.type_id)
 */
export async function fetchTippingByTypeId(
  typeId: ccc.Hex,
  tippingCodeHash: ccc.Hex,
  client: ccc.Client,
  protocolCell: ccc.Cell
): Promise<ccc.Cell | undefined> {
  if (!client) {
    throw new Error("Client required for fetchTippingByTypeId");
  }

  debug.group("fetchTippingByTypeId");
  debug.log("Searching for tipping", { typeId, tippingCodeHash });

  try {
    if (!protocolCell.cellOutput.type) {
      debug.warn("Protocol cell missing type script");
      debug.groupEnd();
      return undefined;
    }

    const protocolTypeHash = protocolCell.cellOutput.type.hash();

    const connectedTypeId: ConnectedTypeIDLike = {
      type_id: typeId,
      connected_key: protocolTypeHash,
    };
    const encodedArgs = ConnectedTypeID.encode(connectedTypeId);

    const searchKey: cccA.ClientCollectableSearchKeyLike = {
      script: {
        codeHash: tippingCodeHash,
        hashType: "type" as const,
        args: ccc.hexFrom(encodedArgs),
      },
      scriptType: "type",
      scriptSearchMode: "exact",
    };

    for await (const cell of client.findCells(searchKey)) {
      debug.log("✅ Found tipping cell", { typeId });
      debug.groupEnd();
      return cell;
    }

    debug.warn("No tipping cell found", { typeId });
    debug.groupEnd();
    return undefined;
  } catch (error) {
    debug.error("Failed to fetch tipping by type ID", error);
    debug.groupEnd();
    return undefined;
  }
}

/**
 * Fetch all tipping cells connected to a protocol via ConnectedTypeID.connected_key
 */
export async function fetchTippingsConnectedToProtocol(
  client: ccc.Client,
  tippingCodeHash: ccc.Hex,
  protocolTypeHash: ccc.Hex
): Promise<ccc.Cell[]> {
  if (!client) {
    throw new Error("Client is required to fetch tippings");
  }

  debug.group("fetchTippingsConnectedToProtocol");
  debug.log("Searching for tippings", {
    tippingCodeHash,
    protocolTypeHash,
  });

  try {
    const searchKey: cccA.ClientCollectableSearchKeyLike = {
      script: {
        codeHash: tippingCodeHash,
        hashType: "type" as const,
        args: "0x",
      },
      scriptType: "type",
      scriptSearchMode: "prefix",
    };

    const proposalCells: ccc.Cell[] = [];

    for await (const cell of client.findCells(searchKey)) {
      if (!cell.cellOutput.type?.args) {
        continue;
      }

      try {
        const argsBytes = ccc.bytesFrom(cell.cellOutput.type.args);
        const connected = ConnectedTypeID.decode(
          argsBytes
        ) as ConnectedTypeIDLike;

        if (connected.connected_key === protocolTypeHash) {
          proposalCells.push(cell);
        }
      } catch (error) {
        debug.warn("Failed to decode ConnectedTypeID for tipping cell", error);
      }

      if (proposalCells.length >= 100) {
        break;
      }
    }

    debug.info(`✨ Found ${proposalCells.length} tippings for protocol`, {
      protocolTypeHash,
    });
    debug.groupEnd();
    return proposalCells;
  } catch (error) {
    debug.error("Failed to fetch tippings", error);
    debug.groupEnd();
    return [];
  }
}

/**
 * Extract ConnectedTypeID.type_id from a tipping cell
 */
export function extractTypeIdFromTippingCell(
  cell: ccc.Cell
): ccc.Hex | undefined {
  try {
    if (!cell.cellOutput.type?.args) {
      return undefined;
    }

    const argsBytes = ccc.bytesFrom(cell.cellOutput.type.args);
    const connected = ConnectedTypeID.decode(argsBytes) as ConnectedTypeIDLike;
    return connected.type_id as ccc.Hex;
  } catch (error) {
    debug.warn("Failed to extract type ID from tipping cell", error);
    return undefined;
  }
}
