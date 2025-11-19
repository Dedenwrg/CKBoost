import { ccc } from "@ckb-ccc/shell";
import { UserData } from "ssri-ckboost/types";

export type NormalizedUserSubmissionRecord = {
  campaign_type_id: string;
  quest_id: string;
  submission_timestamp: string;
  submission_content: string;
};

export type NormalizedVerificationData = {
  telegram_personal_chat_id: string;
  identity_verification_data: string;
};

export type NormalizedUserData = {
  verification_data: NormalizedVerificationData;
  total_points_earned: string;
  last_activity_timestamp: string;
  submission_records: NormalizedUserSubmissionRecord[];
  profile_data: string[];
  last_bonus_streak_at: string;
};

type ResolvedUserCell = {
  index: number;
  cellOutput: ccc.CellOutput;
  outputData: ccc.HexLike;
};

const toHexString = (value: ccc.HexLike | undefined): string =>
  ccc.hexFrom(value ?? "0x").toLowerCase();

const toDecimalString = (value: ccc.NumLike | undefined): string =>
  ccc.numFrom(value ?? 0n).toString();

export const decodeUserData = (data: ccc.HexLike) => UserData.decode(data);

export const normalizeUserData = (
  data: ReturnType<typeof UserData.decode>
): NormalizedUserData => {
  const verification = data.verification_data ?? {
    telegram_personal_chat_id: 0n,
    identity_verification_data: "0x",
  };

  return {
    verification_data: {
      telegram_personal_chat_id: toDecimalString(
        verification.telegram_personal_chat_id
      ),
      identity_verification_data: toHexString(
        verification.identity_verification_data
      ),
    },
    total_points_earned: toDecimalString(data.total_points_earned),
    last_activity_timestamp: toDecimalString(data.last_activity_timestamp),
    submission_records: (data.submission_records ?? []).map((record) => ({
      campaign_type_id: toHexString(record.campaign_type_id),
      quest_id: toDecimalString(record.quest_id),
      submission_timestamp: toDecimalString(record.submission_timestamp),
      submission_content: record.submission_content ?? "",
    })),
    profile_data: (data.profile_data ?? []).map((entry) => toHexString(entry)),
    last_bonus_streak_at: toDecimalString(data.last_bonus_streak_at),
  };
};

export const findUserCellInput = async ({
  tx,
  client,
  userTypeCodeHash,
  expectedLockHash,
}: {
  tx: ccc.Transaction;
  client: ccc.Client;
  userTypeCodeHash: string;
  expectedLockHash?: string;
}): Promise<ResolvedUserCell | undefined> => {
  const normalizedLockHash = expectedLockHash?.toLowerCase();

  for (let i = 0; i < tx.inputs.length; i += 1) {
    const input = tx.inputs[i];
    let cellOutput: ccc.CellOutput | undefined;
    let outputData: ccc.HexLike | undefined;

    if (input.cellOutput && input.outputData) {
      cellOutput = input.cellOutput;
      outputData = input.outputData as ccc.HexLike;
    } else if (input.previousOutput) {
      const fetched = await client.getCell(input.previousOutput);
      if (fetched) {
        cellOutput = fetched.cellOutput;
        outputData = fetched.outputData;
      }
    }

    if (!cellOutput || !outputData) {
      continue;
    }

    const type = cellOutput.type;
    if (
      !type ||
      type.codeHash !== userTypeCodeHash ||
      type.hashType !== "type"
    ) {
      continue;
    }

    if (normalizedLockHash) {
      const lockHash = cellOutput.lock.hash().toLowerCase();
      if (lockHash !== normalizedLockHash) {
        continue;
      }
    }

    return { index: i, cellOutput, outputData };
  }

  return undefined;
};

export const findUserCellOutput = ({
  tx,
  userTypeCodeHash,
  expectedLockHash,
}: {
  tx: ccc.Transaction;
  userTypeCodeHash: string;
  expectedLockHash?: string;
}): ResolvedUserCell | undefined => {
  const normalizedLockHash = expectedLockHash?.toLowerCase();

  for (let i = 0; i < tx.outputs.length; i += 1) {
    const output = tx.outputs[i];
    if (!output.type) {
      continue;
    }

    if (
      output.type.codeHash !== userTypeCodeHash ||
      output.type.hashType !== "type"
    ) {
      continue;
    }

    const outputData = tx.outputsData[i] as ccc.HexLike | undefined;
    if (outputData === undefined) {
      continue;
    }

    const cellOutput = ccc.CellOutput.from(
      { lock: output.lock, type: output.type },
      outputData
    );

    if (normalizedLockHash) {
      const lockHash = cellOutput.lock.hash().toLowerCase();
      if (lockHash !== normalizedLockHash) {
        continue;
      }
    }

    return { index: i, cellOutput, outputData };
  }

  return undefined;
};
