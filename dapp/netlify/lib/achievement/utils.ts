import { deploymentManager } from "@/lib/ckb/deployment-manager";
import { getProtocolTypeScript } from "@/lib/ckb/protocol-cells";
import { getLatestUserCellByLock } from "@/lib/ckb/user-cells";
import { ccc } from "@ckb-ccc/shell";
import {
  AchievementDataVec,
  UserData,
  UserDataLike,
  type AchievementDataLike,
} from "ssri-ckboost/types";

export type TestnetClient = InstanceType<typeof ccc.ClientPublicTestnet>;
export type MainnetClient = InstanceType<typeof ccc.ClientPublicMainnet>;
export type CkbClient = TestnetClient | MainnetClient;

type HashType = "data" | "type" | "data1";

/**
 * Parsed achievement metadata payload. Metadata is expected to be JSON that includes a stable id.
 */
type ParsedAchievementMetadata = {
  /** Unique identifier for the achievement (e.g. telegram_validation). */
  id: string;
  /** Human friendly title mirrored from the on-chain entry. */
  title: string;
  /** Referenced Nostr nevent ID carrying extended metadata. */
  neventId: string;
};

/**
 * Minimal definition for an achievement validation rule.
 */
export interface AchievementRule {
  /** Unique identifier that must match the achievement metadata id. */
  id: string;
  /** Human readable title, also expected to match the achievement title stored on-chain. */
  title: string;
  /**
   * Validate whether the user satisfies the achievement requirements.
   * Should throw an error describing the invalid state when requirements fail.
   */
  validate: (userData: UserDataLike) => void;
}

/**
 * Supported achievements for the validator.
 * Additional achievements should extend this array, keeping the interface stable.
 */
export const ACHIEVEMENT_RULES: readonly AchievementRule[] = [
  {
    id: "telegram_validation",
    title: "Telegram Verification",
    validate: (userData: UserDataLike) => {
      const verificationData =
        userData.verification_data.identity_verification_data;
      const hasVerification =
        verificationData !== undefined &&
        verificationData !== null &&
        ccc.hexFrom(verificationData).toLowerCase() !== "0x";

      if (!hasVerification) {
        throw new Error(
          "Telegram verification achievement requires completed identity verification data."
        );
      }
    },
  },
  {
    id: "first_submission",
    title: "First Submission",
    validate: (userData: UserDataLike) => {
      const submissionCount = userData.submission_records.length;
      if (submissionCount === 0) {
        throw new Error(
          "First submission achievement requires at least one submission."
        );
      }
    },
  },
] as const;

/**
 * Create a quick lookup map for achievement rules by id.
 */
const ACHIEVEMENT_RULE_MAP = new Map(
  ACHIEVEMENT_RULES.map((rule) => [rule.id, rule])
);

/**
 * Convert a Molecule string or hex-like field into a trimmed UTF-8 string.
 */
const decodeMolString = (value: unknown): string => {
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

  return "";
};

/**
 * Parse achievement metadata from on-chain data.
 * Metadata is expected to be a Nostr nevent ID referencing extended payloads.
 */
const parseAchievementMetadata = (
  rawMetadata: unknown,
  achievementTitle: string
): ParsedAchievementMetadata => {
  const metadataString = decodeMolString(rawMetadata);

  if (!metadataString) {
    throw new Error(`Achievement "${achievementTitle}" has empty metadata.`);
  }

  const neventId = metadataString.trim();

  if (!neventId.startsWith("nevent")) {
    throw new Error(
      `Achievement "${achievementTitle}" metadata must be a Nostr nevent ID.`
    );
  }

  const normalizedTitle = achievementTitle.trim();
  const rule = ACHIEVEMENT_RULES.find(
    (candidate) =>
      candidate.id.toLowerCase() === normalizedTitle.toLowerCase() ||
      candidate.title.toLowerCase() === normalizedTitle.toLowerCase()
  );

  if (!rule) {
    throw new Error(
      `Unsupported achievement title "${achievementTitle}". Ensure a matching rule is registered.`
    );
  }

  return {
    id: rule.id,
    title: rule.title,
    neventId,
  };
};

export const getGrantableAchievements = async (
  signer: ccc.Signer,
  userAddress: string,
  achievementTypeCodeHash: ccc.Hex
): Promise<string[]> => {
  // Verify user lock matches the provided address.
  const addressObj = await ccc.Address.fromString(userAddress, signer.client);
  const addressLockScript = addressObj.script;

  const network = deploymentManager.getCurrentNetwork();
  const userTypeCodeHash = deploymentManager.getContractCodeHash(
    network,
    "ckboostUserType"
  );

  if (!userTypeCodeHash) {
    throw new Error("User type code hash not found.");
  }

  const protocolTypeScript = ccc.Script.from(getProtocolTypeScript());

  // Resolve on-chain user cell using lock hash + type script for additional certainty.
  const userCell = await getLatestUserCellByLock(
    addressLockScript,
    userTypeCodeHash,
    signer,
    protocolTypeScript.hash()
  );

  if (!userCell) {
    throw new Error(
      "Unable to locate existing on-chain user cell for the supplied address."
    );
  }
  // TODO: Here we assume only one achievement cell exists.
  const achievementCell = await findAchievementCell(
    signer.client,
    achievementTypeCodeHash
  );

  if (!achievementCell) {
    throw new Error("Unable to locate existing on-chain achievement cell.");
  }

  const achievementDataVec = AchievementDataVec.decode(
    ccc.hexFrom(achievementCell.outputData)
  ) as AchievementDataLike[];

  const availableAchievements = achievementDataVec.filter((achievement) => {
    const achivementReceiverHashes = achievement.receiver_user_record_vec?.map(
      (record) => {
        return record.receiver_user_type_hash;
      }
    );
    return !achivementReceiverHashes?.includes(
      userCell.cellOutput.type?.hash() ?? ""
    );
  });

  const userData = UserData.decode(userCell.outputData);

  const grantableAchievements: string[] = availableAchievements
    .filter((achievement) => {
      return ACHIEVEMENT_RULE_MAP.get(achievement.achievement_title)?.validate(
        userData
      );
    })
    .map((achievement) => achievement.achievement_title);

  return grantableAchievements;
};

export interface EvaluateUserAchievementsInput {
  client: CkbClient;
  userAddress: string;
  userTypeCodeHash: string;
  achievementTypeCodeHash: string;
}

export interface EvaluateUserAchievementsResult {
  completedIds: Set<string>;
  grantableIds: string[];
}

const findLatestUserCell = async (
  client: CkbClient,
  userAddress: string,
  userTypeCodeHash: string
): Promise<ccc.Cell | null> => {
  const addressObj = await ccc.Address.fromString(userAddress, client);
  const lockScript = addressObj.script;

  const searchKey = {
    script: lockScript,
    scriptType: "lock" as const,
    scriptSearchMode: "exact" as const,
    withData: true,
  };

  const normalizedCodeHash = userTypeCodeHash.toLowerCase();

  let latestCell: ccc.Cell | null = null;
  let latestBlockNumber = -1n;

  for await (const cell of client.findCells(searchKey)) {
    const typeScript = cell.cellOutput.type;
    if (
      !typeScript ||
      typeScript.hashType !== ("type" as HashType) ||
      typeScript.codeHash.toLowerCase() !== normalizedCodeHash
    ) {
      continue;
    }

    const txInfo = await client.getTransaction(cell.outPoint.txHash);
    const blockNumber =
      txInfo?.blockNumber !== undefined ? BigInt(txInfo.blockNumber) : 0n;

    if (!latestCell || blockNumber > latestBlockNumber) {
      latestCell = cell;
      latestBlockNumber = blockNumber;
    }
  }

  return latestCell;
};

const findAchievementCell = async (
  client: ccc.Client,
  achievementTypeCodeHash: string
): Promise<ccc.Cell | null> => {
  const searchKey = {
    script: {
      codeHash: achievementTypeCodeHash,
      hashType: "type" as HashType,
      args: "0x",
    },
    scriptType: "type" as const,
    scriptSearchMode: "prefix" as const,
    withData: true,
  };

  for await (const cell of client.findCells(searchKey)) {
    return cell;
  }

  return null;
};
