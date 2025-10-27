import { ccc } from "@ckb-ccc/connector-react";
import {
  AchievementDataVec,
  ConnectedTypeID,
  type AchievementDataLike,
  type AchievementRecordLike,
  type ConnectedTypeIDLike,
} from "ssri-ckboost/types";
import { deploymentManager } from "./deployment-manager";
import type { Network } from "./deployment-manager";
import { createScopedLogger } from "ssri-ckboost";

const log = createScopedLogger("AchievementCells");

/**
 * Structured representation of an achievement entry stored inside the
 * achievements cell. This keeps the raw molecule object for consumers that
 * need to perform additional decoding, while also exposing convenient fields
 * for UI rendering.
 */
export interface AchievementEntry {
  /** Raw molecule object as decoded from the achievements cell. */
  raw: AchievementDataLike;
  /** Human readable title extracted from molecule string data. */
  title: string;
  /** Nostr nevent ID referencing off-chain metadata. */
  metadataNeventId: string;
  /** Convenience list of receiver records associated with this achievement. */
  records: AchievementRecordLike[];
}

export type AchievementDefinitionInput = Omit<
  AchievementDataLike,
  "receiver_user_record_vec"
> & {
  receiver_user_record_vec?: AchievementRecordLike[];
};

export interface AchievementCellDeploymentResult {
  txHash: ccc.Hex;
  typeId: ccc.Hex;
  outputIndex: number;
  connectedTypeId: ConnectedTypeIDLike;
}

const normalizeHex = (value: ccc.HexLike | undefined): ccc.Hex | null =>
  value ? (ccc.hexFrom(value) as ccc.Hex) : null;

const decodeConnectedTypeIdArgs = (
  args: ccc.HexLike | undefined
): ConnectedTypeIDLike | null => {
  if (!args) return null;
  try {
    return ConnectedTypeID.decode(ccc.hexFrom(args)) as ConnectedTypeIDLike;
  } catch (error) {
    log.warn("Failed to decode ConnectedTypeID args:", error);
    return null;
  }
};

const matchesProtocol = (
  cell: ccc.Cell,
  protocolTypeHash?: ccc.HexLike
): boolean => {
  if (!protocolTypeHash) return true;
  const decoded = decodeConnectedTypeIdArgs(cell.cellOutput.type?.args);
  if (!decoded?.connected_key) return false;
  return (
    ccc.hexFrom(decoded.connected_key).toLowerCase() ===
    ccc.hexFrom(protocolTypeHash).toLowerCase()
  );
};

/**
 * Retrieve the achievement type code hash registered for the provided network.
 */
export function getAchievementTypeCodeHash(network: Network): ccc.Hex | null {
  return normalizeHex(
    deploymentManager.getContractCodeHash(network, "ckboostAchievementType") ??
      undefined
  );
}

/**
 * Retrieve the achievement type code cell out-point registered for the network.
 */
export function getAchievementTypeCodeOutPoint(
  network: Network
): { txHash: ccc.Hex; index: ccc.Num } | null {
  const outPoint = deploymentManager.getContractOutPoint(
    network,
    "ckboostAchievementType"
  );
  if (!outPoint) return null;
  return {
    txHash: ccc.hexFrom(outPoint.txHash) as ccc.Hex,
    index: ccc.numFrom(outPoint.index),
  };
}

/**
 * Locate the first achievements cell on-chain by querying with the deployed
 * type script code hash. Optionally filter results by protocol connection.
 */
export async function fetchAchievementCell(
  client: ccc.Client,
  achievementCellTypeCodeHash: ccc.Hex,
  options?: {
    protocolTypeHash?: ccc.HexLike;
    connectedTypeId?: ConnectedTypeIDLike;
  }
): Promise<ccc.Cell | null> {
  const args =
    options?.connectedTypeId !== undefined
      ? ccc.hexFrom(ConnectedTypeID.encode(options.connectedTypeId))
      : "0x";

  const iterator = client.findCells({
    script: {
      codeHash: achievementCellTypeCodeHash,
      hashType: "type",
      args,
    },
    scriptType: "type",
    scriptSearchMode:
      options?.connectedTypeId !== undefined ? "exact" : "prefix",
    withData: true,
  });

  for await (const cell of iterator) {
    if (matchesProtocol(cell, options?.protocolTypeHash)) {
      return cell;
    }
  }

  return null;
}

/**
 * Decode the raw `outputData` field of an achievements cell into a Molecule
 * vector. Consumers can use this to iterate over the stored achievement
 * definitions.
 *
 * @param cell - Achievements cell containing the Molecule payload.
 * @returns Array of decoded Molecule tables.
 */
export function decodeAchievementEntries(
  cell: ccc.Cell
): AchievementDataLike[] {
  const hex = ccc.hexFrom(cell.outputData);
  if (!hex || hex === "0x") {
    return [];
  }
  return AchievementDataVec.decode(hex) as AchievementDataLike[];
}

/**
 * Convert a Molecule string into a UTF-8 string. Some Molecule string readers
 * expose a `raw_data` function, while others require manual byte conversion.
 *
 * @param value - Molecule string-like object or hex string.
 * @returns The decoded UTF-8 string with leading/trailing whitespace trimmed.
 */
export function decodeMoleculeString(value: unknown): string {
  if (!value) return "";

  if (typeof value === "string") {
    return value.trim();
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "raw_data" in value &&
    typeof (value as { raw_data: () => unknown }).raw_data === "function"
  ) {
    const raw = (value as { raw_data: () => unknown }).raw_data();
    if (typeof raw === "string") {
      const bytes = ccc.bytesFrom(raw);
      return Buffer.from(bytes).toString("utf8").trim();
    }
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "raw" in value &&
    typeof (value as { raw: () => unknown }).raw === "function"
  ) {
    const raw = (value as { raw: () => unknown }).raw();
    if (typeof raw === "string") {
      const bytes = ccc.bytesFrom(raw);
      return Buffer.from(bytes).toString("utf8").trim();
    }
  }

  // Fallback: attempt toString and trim.
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toString: () => string }).toString === "function"
  ) {
    const str = (value as { toString: () => string }).toString();
    return typeof str === "string" ? str.trim() : "";
  }

  return "";
}

/**
 * Decode an achievements cell into a convenient {@link AchievementEntry}
 * structure suited for UI consumption.
 *
 * @param cell - Achievements cell.
 * @returns Array of structured achievement entries.
 */
export function toAchievementEntries(cell: ccc.Cell): AchievementEntry[] {
  const entries: AchievementEntry[] = [];
  const decoded = decodeAchievementEntries(cell);

  for (const achievement of decoded) {
    const title = decodeMoleculeString(achievement.achievement_title);
    const metadataNeventId = decodeMoleculeString(
      achievement.achievement_metadata
    );
    entries.push({
      raw: achievement,
      title,
      metadataNeventId,
      records: achievement.receiver_user_record_vec ?? [],
    });
  }

  return entries;
}
