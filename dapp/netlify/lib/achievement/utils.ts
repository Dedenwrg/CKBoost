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

/**
 * Minimal definition for an achievement validation rule.
 */
export interface AchievementRule {
  /** Human readable title, also expected to match the achievement title stored on-chain. */
  title: string;
  /**
   * Validate whether the user satisfies the achievement requirements.
   * Should throw an error describing the invalid state when requirements fail.
   */
  validate: (userData: UserDataLike) => boolean;
}

/**
 * Supported achievements for the validator.
 * Additional achievements should extend this array, keeping the interface stable.
 */
export const ACHIEVEMENT_RULES: readonly AchievementRule[] = [
  {
    title: "Telegram Verification",
    validate: (userData: UserDataLike) => {
      const verificationData =
        userData.verification_data.identity_verification_data;
      const hasVerification =
        verificationData !== undefined &&
        verificationData !== null &&
        ccc.hexFrom(verificationData).toLowerCase() !== "0x";

      if (!hasVerification) {
        console.log(
          "Telegram verification achievement requires completed identity verification data."
        );
        return false;
      }
      return true;
    },
  },
  {
    title: "First Submission",
    validate: (userData: UserDataLike) => {
      console.log("Validating first submission");
      const submissionCount = userData.submission_records.length;
      if (submissionCount === 0) {
        console.log(
          "First submission achievement requires at least one submission."
        );
      }
      return true;
    },
  },
] as const;

/**
 * Create a quick lookup map for achievement rules by id.
 */
const ACHIEVEMENT_RULE_MAP = new Map(
  ACHIEVEMENT_RULES.map((rule) => [rule.title, rule])
);

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
  console.log("achievementDataVec", achievementDataVec);
  const availableAchievements = achievementDataVec.filter((achievement) => {
    const achievementReceiverHashes = achievement.receiver_user_record_vec?.map(
      (record) => {
        return record.receiver_user_type_hash;
      }
    );
    return !achievementReceiverHashes?.includes(
      userCell.cellOutput.type?.hash() ?? ""
    );
  });
  console.log("availableAchievements", availableAchievements);

  const userData = UserData.decode(userCell.outputData);

  const grantableAchievements: string[] = availableAchievements
    .filter((achievement) => {
      console.log("Checking achievement", achievement.achievement_title);
      const rule = ACHIEVEMENT_RULE_MAP.get(achievement.achievement_title);
      if (!rule) {
        console.log(
          "Rule not found for achievement",
          achievement.achievement_title
        );
        return false;
      }
      console.log("Validating achievement", achievement.achievement_title);
      return rule.validate(userData);
    })
    .map((achievement) => achievement.achievement_title);
  console.log("grantableAchievements", grantableAchievements);
  return grantableAchievements;
};

export interface EvaluateUserAchievementsInput {
  client: ccc.Client;
  userAddress: string;
  userTypeCodeHash: string;
  achievementTypeCodeHash: string;
}

export interface EvaluateUserAchievementsResult {
  completedIds: Set<string>;
  grantableIds: string[];
}

const findAchievementCell = async (
  client: ccc.Client,
  achievementTypeCodeHash: string
): Promise<ccc.Cell | null> => {
  for await (const cell of client.findCells({
    script: {
      codeHash: achievementTypeCodeHash,
      hashType: "type" as ccc.HashType,
      args: "0x",
    },
    scriptType: "type",
    scriptSearchMode: "prefix",
    withData: true,
  })) {
    return cell;
  }

  return null;
};
