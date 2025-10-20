import { ccc } from "@ckb-ccc/shell";
import {
  AchievementDataVec,
  UserData,
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
 * Context passed to individual achievement rule validators.
 */
export interface AchievementRuleContext {
  /** User data prior to applying the transaction. */
  userPre: ReturnType<typeof UserData.decode>;
  /** User data after applying the transaction. */
  userPost: ReturnType<typeof UserData.decode>;
}

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
  validate: (context: AchievementRuleContext) => void;
}

/**
 * Supported achievements for the validator.
 * Additional achievements should extend this array, keeping the interface stable.
 */
export const ACHIEVEMENT_RULES: readonly AchievementRule[] = [
  {
    id: "telegram_validation",
    title: "Telegram Verification",
    validate: ({ userPost }) => {
      const verificationData =
        userPost.verification_data.identity_verification_data;
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
    validate: ({ userPre, userPost }) => {
      const beforeCount = userPre.submission_records.length;
      const afterCount = userPost.submission_records.length;

      if (beforeCount > 0) {
        throw new Error(
          "First submission achievement can only be claimed when the user has no prior submissions."
        );
      }

      if (afterCount <= beforeCount) {
        throw new Error(
          "First submission achievement requires at least one submission in the updated user cell."
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

/**
 * Extract the set of achievement ids the target user already holds from a decoded AchievementDataVec.
 */
const collectUserAchievementIds = (
  achievementVec: AchievementDataLike[],
  userTypeHash: ccc.Hex
): Set<string> => {
  const ids = new Set<string>();

  for (const achievement of achievementVec) {
    const title = decodeMolString(achievement.achievement_title);
    const metadata = parseAchievementMetadata(
      achievement.achievement_metadata,
      title
    );

    const receivers = achievement.receiver_user_record_vec ?? [];
    const hasUser = receivers.some((record) => {
      const receiverHash = ccc
        .hexFrom(record.receiver_user_type_hash)
        .toLowerCase();
      return receiverHash === userTypeHash.toLowerCase();
    });

    if (hasUser) {
      ids.add(metadata.id);
    }
  }

  return ids;
};

/**
 * Identify newly claimed achievement ids by diffing the output and input vectors.
 */
const determineNewAchievementIds = (
  inputIds: Set<string>,
  outputIds: Set<string>
): string[] => {
  const ids: string[] = [];

  for (const id of outputIds) {
    if (!inputIds.has(id)) {
      ids.push(id);
    }
  }

  return ids;
};

/**
 * Decode the user cell data into the strongly typed molecule representation.
 */
const decodeUserData = (data: ccc.HexLike): ReturnType<typeof UserData.decode> => {
  const hex = ccc.hexFrom(data);
  if (!hex || hex === "0x") {
    throw new Error("User cell data is empty.");
  }
  return UserData.decode(hex);
};

/**
 * Resolve the first cell found for a given lock script and optional type script.
 */
const resolveLatestCellByLock = async (
  client: CkbClient,
  lock: ccc.Script,
  type: ccc.Script | null
): Promise<ccc.Cell | null> => {
  const iterator = client.findCellsByLock(lock, type);
  const result = await iterator.next();
  return result.value ?? null;
};

/**
 * Retrieve the most suitable achievement rule for a given id.
 */
const lookupAchievementRule = (id: string): AchievementRule => {
  const rule = ACHIEVEMENT_RULE_MAP.get(id);
  if (!rule) {
    throw new Error(`Unsupported achievement id "${id}".`);
  }
  return rule;
};

export interface GetGrantableAchievementsInput {
  tx: ccc.Transaction;
  client: CkbClient;
  userAddress: string;
  userTypeCodeHash: string;
  achievementTypeCodeHash: string;
  /**
   * When true (default), require the transaction to grant at least one new achievement.
   * View-only flows can disable this to surface state without enforcing a grant.
   */
  requireNew?: boolean;
}

export interface GetGrantableAchievementsResult {
  userPre: ReturnType<typeof UserData.decode>;
  userPost: ReturnType<typeof UserData.decode>;
  inputAchievementIds: Set<string>;
  outputAchievementIds: Set<string>;
  newAchievementIds: string[];
}

/**
 * Inspect a transaction attempting to claim achievements for a user.
 * Throws on invalid state; otherwise returns decoded data and identifiers, including
 * achievements that could be granted if the transaction is submitted.
 */
export const getGrantableAchievements = async ({
  tx,
  client,
  userAddress,
  userTypeCodeHash,
  achievementTypeCodeHash,
  requireNew = true,
}: GetGrantableAchievementsInput): Promise<GetGrantableAchievementsResult> => {
  const userOutputIndex = tx.outputs.findIndex(
    (output) =>
      output.type?.codeHash === userTypeCodeHash &&
      output.type?.hashType === ("type" as HashType)
  );

  if (userOutputIndex < 0) {
    throw new Error("Transaction must include an updated user cell output.");
  }

  const userOutput = tx.outputs[userOutputIndex];
  const userOutputData = tx.outputsData[userOutputIndex];
  const userTypeHash = userOutput.type?.hash();

  if (!userTypeHash) {
    throw new Error("User output type hash is missing.");
  }

  // Verify user lock matches the provided address.
  const addressObj = await ccc.Address.fromString(userAddress, client);
  const addressLockScript = addressObj.script;
  const addressLockHash = addressLockScript.hash();
  if (addressLockHash !== userOutput.lock.hash()) {
    throw new Error(
      "Provided address does not match the user cell lock in the transaction."
    );
  }

  // Resolve on-chain user cell using lock hash + type script for additional certainty.
  const resolvedUserCell = await resolveLatestCellByLock(
    client,
    addressLockScript,
    userOutput.type || null
  );

  if (!resolvedUserCell) {
    throw new Error(
      "Unable to locate existing on-chain user cell for the supplied address."
    );
  }

  if (
    resolvedUserCell.cellOutput.type?.hash() &&
    resolvedUserCell.cellOutput.type.hash() !== userTypeHash
  ) {
    throw new Error(
      "Resolved user cell type hash differs from the transaction output."
    );
  }

  // Find the user input cell inside the transaction.
  let userInputCell: ccc.Cell | null = null;
  for (const input of tx.inputs) {
    const cell = await input.getCell(client);
    if (
      cell &&
      cell.cellOutput.type?.codeHash === userTypeCodeHash &&
      cell.cellOutput.type?.hashType === ("type" as HashType) &&
      cell.cellOutput.type?.hash() === userTypeHash
    ) {
      userInputCell = cell;
      break;
    }
  }

  if (!userInputCell) {
    throw new Error("Transaction must consume the existing user cell.");
  }

  // Locate achievement input and output cells.
  let achievementInputCell: ccc.Cell | null = null;
  for (const input of tx.inputs) {
    const cell = await input.getCell(client);
    if (
      cell &&
      cell.cellOutput.type?.codeHash === achievementTypeCodeHash &&
      cell.cellOutput.type?.hashType === ("type" as HashType)
    ) {
      achievementInputCell = cell;
      break;
    }
  }

  if (!achievementInputCell) {
    throw new Error("Transaction is missing the achievement input cell.");
  }

  const achievementOutputIndex = tx.outputs.findIndex(
    (output) =>
      output.type?.codeHash === achievementTypeCodeHash &&
      output.type?.hashType === ("type" as HashType)
  );

  if (achievementOutputIndex < 0) {
    throw new Error("Transaction must include an updated achievement output.");
  }

  // Decode user data (pre/post).
  const userPre = decodeUserData(userInputCell.outputData);
  const userPost = decodeUserData(userOutputData);

  // Decode achievement data (pre/post).
  let achievementInputVec: AchievementDataLike[];
  let achievementOutputVec: AchievementDataLike[];
  try {
    achievementInputVec = AchievementDataVec.decode(
      ccc.hexFrom(achievementInputCell.outputData)
    ) as AchievementDataLike[];
    achievementOutputVec = AchievementDataVec.decode(
      ccc.hexFrom(tx.outputsData[achievementOutputIndex])
    ) as AchievementDataLike[];
  } catch (error) {
    throw new Error(
      `Failed to decode achievement cell data: ${(error as Error).message}`
    );
  }

  const inputAchievementIds = collectUserAchievementIds(
    achievementInputVec,
    userTypeHash
  );
  const outputAchievementIds = collectUserAchievementIds(
    achievementOutputVec,
    userTypeHash
  );

  const newAchievementIds = determineNewAchievementIds(
    inputAchievementIds,
    outputAchievementIds
  );

  if (requireNew && newAchievementIds.length === 0) {
    throw new Error("No new achievements detected for this user.");
  }

  const ruleContext: AchievementRuleContext = {
    userPre,
    userPost,
  };

  for (const id of newAchievementIds) {
    const rule = lookupAchievementRule(id);
    rule.validate(ruleContext);
  }

  return {
    userPre,
    userPost,
    inputAchievementIds,
    outputAchievementIds,
    newAchievementIds,
  };
};
