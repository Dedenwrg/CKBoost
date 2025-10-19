import { ccc } from "@ckb-ccc/connector-react";
import {
  fetchAchievementCell,
  toAchievementEntries,
  decodeMoleculeString,
  type AchievementEntry,
} from "../ckb/achievement-cells";
import { getLatestUserCellByAddress } from "../ckb/user-cells";
import { deploymentManager, type Network } from "../ckb/deployment-manager";
import type {
  AchievementRecordLike,
  AchievementDataLike,
  ProtocolDataLike,
} from "ssri-ckboost/types";
import type { AchievementQueryResponse } from "@/netlify/lib/achievement/types";

/**
 * Shape of an achievement enriched with completion status for a particular
 * user.
 */
export interface UserAchievement {
  /** Canonical achievement identifier, sourced from metadata. */
  id: string;
  /** Human readable title. */
  title: string;
  /** Raw metadata string stored on-chain. */
  metadataRaw: string;
  /** Parsed metadata object, when JSON decoding succeeds. */
  metadata: Record<string, unknown> | null;
  /** Underlying Molecule data for advanced consumers. */
  raw: AchievementDataLike;
  /** Whether the referenced user already completed this achievement. */
  completed: boolean;
  /** Timestamp (CKB epoch time in shannon) when the achievement was granted. */
  grantedAt?: bigint;
  /** Receiver record that granted the achievement, if any. */
  record?: AchievementRecordLike;
}

/**
 * Response returned by the achievement validation Netlify function when a
 * claim attempt succeeds. Matches the structure produced by
 * `achievement-validate.ts`.
 */
export interface ClaimAchievementResponse {
  success: true;
  txHex: string;
  newlyGranted: string[];
  completedAchievements: number;
}

/**
 * Variant returned when the server rejects the claim or when HTTP errors occur.
 */
export interface FailedClaimResponse {
  success: false;
  error: string;
  message?: string;
}

export type ClaimAchievementResult =
  | ClaimAchievementResponse
  | FailedClaimResponse;

/**
 * High-level service that exposes achievement-centric operations:
 *
 * - Enumerating achievements stored in the dedicated achievements cell.
 * - Resolving the completion status for a user wallet.
 * - Submitting prepared transactions to the Netlify validation endpoint.
 *
 * The class mirrors the ergonomics of other domain services in `dapp/lib`,
 * keeping blockchain access encapsulated while remaining framework agnostic.
 */
export class AchievementService {
  private readonly client: ccc.Client;
  private readonly network: Network;
  private readonly achievementCellTypeScript: ccc.ScriptLike;

  /**
   * Instantiate an achievement service.
   *
   * @param client - CCC client used for chain queries.
   */
  constructor(client: ccc.Client, achievementCellTypeScript: ccc.ScriptLike) {
    this.client = client;
    this.network = deploymentManager.getCurrentNetwork();

    this.achievementCellTypeScript = achievementCellTypeScript;
  }

  /**
   * Retrieve the single achievements cell for the current protocol.
   *
   * @returns The achievements cell.
   * @throws Error when the cell is missing to surface misconfiguration early.
   */
  async getAchievementCell(): Promise<ccc.Cell> {
    const cell = await fetchAchievementCell(
      this.client,
      this.achievementCellTypeScript
    );
    if (!cell) {
      throw new Error(
        "Achievements cell not found on-chain. Ensure the achievements contract was deployed."
      );
    }
    return cell;
  }

  /**
   * List all achievements as defined in the on-chain achievements cell.
   *
   * @returns Achievements with metadata and raw Molecule structures.
   */
  async listAchievements(): Promise<AchievementEntry[]> {
    const cell = await this.getAchievementCell();
    return toAchievementEntries(cell);
  }

  /**
   * Resolve achievement completion status for a particular user address.
   *
   * @param userAddress - CKB address identifying the user.
   * @returns Collection describing completion state for each achievement.
   */
  async getUserAchievements(
    userAddress: string,
    protocol_data: ProtocolDataLike
  ): Promise<UserAchievement[]> {
    const achievementCell = await this.getAchievementCell();
    const entries = toAchievementEntries(achievementCell);

    const userCell = await getLatestUserCellByAddress(
      userAddress,
      this.client,
      ccc.hexFrom(
        protocol_data.protocol_config.script_code_hashes
          .ckb_boost_user_type_code_hash
      )
    );

    if (!userCell || !userCell.cellOutput.type) {
      console.warn(
        "[AchievementService] User cell not found for address:",
        userAddress
      );
      return entries.map((entry) => ({
        id: this.extractAchievementId(entry),
        title: entry.title,
        metadata: entry.metadata,
        metadataRaw: entry.metadataRaw,
        raw: entry.raw,
        completed: false,
      }));
    }

    const userTypeHash = userCell.cellOutput.type.hash();
    const status: UserAchievement[] = [];

    for (const entry of entries) {
      const id = this.extractAchievementId(entry);
      const record = entry.records.find((receiver) => {
        const receiverHash = ccc
          .hexFrom(receiver.receiver_user_type_hash)
          .toLowerCase();
        return receiverHash === userTypeHash.toLowerCase();
      });

      status.push({
        id,
        title: entry.title,
        metadata: entry.metadata,
        metadataRaw: entry.metadataRaw,
        raw: entry.raw,
        completed: Boolean(record),
        grantedAt: record ? BigInt(ccc.numFrom(record.granted_at)) : undefined,
        record,
      });
    }

    return status;
  }

  /**
   * Submit a prepared claim transaction to the Netlify validation endpoint for
   * final attestation. This helper does not build the transaction; instead, it
   * forwards the draft to the serverless function that performs deep checks and
   * re-signs the payload.
   *
   * @param params - Request parameters.
   * @param params.tx - Transaction instance or hex string representing the claim.
   * @param params.userAddress - Address of the claimant, forwarded to the validator.
   * @param params.endpoint - Optional relative endpoint. Defaults to `/api/achievement-validate`.
   * @returns Validation outcome as returned by the serverless function.
   */
  async claimAchievements(params: {
    tx: ccc.Transaction | string;
    userAddress: string;
    endpoint?: string;
  }): Promise<ClaimAchievementResult> {
    const { tx, userAddress } = params;
    const endpoint = params.endpoint ?? "/api/achievement-validate";
    const txHex = typeof tx === "string" ? tx : ccc.hexFrom(tx.toBytes());

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txHex, userAddress }),
    });

    const payload = (await response.json()) as ClaimAchievementResult;
    if (!response.ok) {
      return payload;
    }
    return payload;
  }

  /**
   * Preview which achievements would be granted by submitting the provided
   * transaction without mutating anything on-chain. Leverages the Netlify
   * `achievement-query` function which performs the same validation checks as
   * the signing endpoint.
   *
   * @param params - Request parameters.
   * @param params.tx - Transaction instance or hex string representing the claim attempt.
   * @param params.userAddress - Address of the claimant.
   * @param params.endpoint - Optional relative endpoint. Defaults to `/api/achievement-query`.
   * @returns Server evaluation describing potential grants or validation errors.
   */
  async previewClaim(params: {
    tx: ccc.Transaction | string;
    userAddress: string;
    endpoint?: string;
  }): Promise<AchievementQueryResponse> {
    const { tx, userAddress } = params;
    const endpoint = params.endpoint ?? "/api/achievement-query";
    const txHex = typeof tx === "string" ? tx : ccc.hexFrom(tx.toBytes());

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txHex, userAddress }),
    });

    const payload = (await response.json()) as AchievementQueryResponse;
    if (!response.ok) {
      return payload;
    }
    return payload;
  }

  /**
   * Extract the canonical achievement identifier from metadata or fallback to
   * a normalized title when metadata lacks an `id` field.
   *
   * @param entry - Achievement entry produced by {@link toAchievementEntries}.
   * @returns Stable identifier useful for React keys or state management.
   */
  private extractAchievementId(entry: AchievementEntry): string {
    const meta = entry.metadata;
    const metaId =
      typeof meta?.["id"] === "string"
        ? (meta["id"] as string)
        : typeof meta?.["key"] === "string"
        ? (meta["key"] as string)
        : typeof meta?.["slug"] === "string"
        ? (meta["slug"] as string)
        : undefined;
    if (metaId && typeof metaId === "string") {
      return metaId.trim();
    }
    const title = decodeMoleculeString(entry.raw.achievement_title);
    return title.toLowerCase().replace(/\s+/g, "-");
  }
}
