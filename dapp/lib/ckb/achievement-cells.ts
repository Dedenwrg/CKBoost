import { ccc } from "@ckb-ccc/connector-react";
import {
  AchievementDataVec,
  type AchievementDataLike,
  type AchievementRecordLike,
} from "ssri-ckboost/types";
import { deploymentManager } from "./deployment-manager";
import type { Network } from "./deployment-manager";

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
  /** JSON metadata parsed from the molecule string, if decoding succeeds. */
  metadata: Record<string, unknown> | null;
  /** Original metadata payload kept for lossless representation. */
  metadataRaw: string;
  /** Convenience list of receiver records associated with this achievement. */
  records: AchievementRecordLike[];
}

/**
 * Locate the first achievements cell on-chain by querying with the deployed
 * type script. The CKBoost deployment assumes a single achievements cell per
 * protocol, therefore this helper returns the first match.
 *
 * @param client - Initialized CCC client instance.
 * @param network - Target network.
 * @returns The located achievements cell or `null` when none is found.
 */
export async function fetchAchievementCell(
  client: ccc.Client,
  achievementCellTypeCodeHash: ccc.Hex
): Promise<ccc.Cell | null> {
  const iterator = client.findCells({
    script: {
      codeHash: achievementCellTypeCodeHash,
      hashType: "type",
      args: "0x",
    },
    scriptType: "type",
    scriptSearchMode: "prefix",
  });

  const { value } = await iterator.next();
  return value ?? null;
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
 * Parse the JSON metadata stored in an achievement entry. Metadata is expected
 * to be a JSON string, but invalid payloads are tolerated by returning
 * `null`.
 *
 * @param raw - Raw metadata string.
 * @returns Parsed metadata object or `null` if parsing fails.
 */
export function parseAchievementMetadata(
  raw: string
): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    console.warn(
      "[achievement-cells] Failed to parse achievement metadata:",
      (error as Error).message
    );
    return null;
  }
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
    const metadataRaw = decodeMoleculeString(achievement.achievement_metadata);
    const metadata = parseAchievementMetadata(metadataRaw);
    entries.push({
      raw: achievement,
      title,
      metadata,
      metadataRaw,
      records: achievement.receiver_user_record_vec ?? [],
    });
  }

  return entries;
}
