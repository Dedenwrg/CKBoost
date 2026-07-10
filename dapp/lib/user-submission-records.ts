import type { ccc } from "@ckb-ccc/connector-react";

export interface QuestSubmissionRecordIdentifier {
  campaign_type_id: ccc.HexLike;
  quest_id: ccc.NumLike;
}

const normalizeCampaignTypeId = (value: ccc.HexLike): ccc.Hex | null => {
  if (typeof value === "string") {
    const normalized = value.startsWith("0x") ? value : `0x${value}`;
    return /^0x(?:[0-9a-fA-F]{2})*$/.test(normalized)
      ? (normalized.toLowerCase() as ccc.Hex)
      : null;
  }

  if (!ArrayBuffer.isView(value)) {
    return null;
  }

  const bytes = new Uint8Array(
    value.buffer,
    value.byteOffset,
    value.byteLength
  );
  return `0x${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")}` as ccc.Hex;
};

export const submissionRecordMatchesQuest = (
  record: QuestSubmissionRecordIdentifier,
  campaignTypeId: ccc.HexLike,
  questId: number
): boolean => {
  const recordCampaignTypeId = normalizeCampaignTypeId(
    record.campaign_type_id
  );
  const targetCampaignTypeId = normalizeCampaignTypeId(campaignTypeId);

  return (
    recordCampaignTypeId !== null &&
    targetCampaignTypeId !== null &&
    recordCampaignTypeId === targetCampaignTypeId &&
    Number(record.quest_id) === questId
  );
};

export const removeQuestSubmissionRecords = <
  T extends QuestSubmissionRecordIdentifier
>(
  records: readonly T[],
  campaignTypeId: ccc.HexLike,
  questId: number
): { records: T[]; removedCount: number } => {
  const remainingRecords = records.filter(
    (record) =>
      !submissionRecordMatchesQuest(record, campaignTypeId, questId)
  );

  return {
    records: remainingRecords,
    removedCount: records.length - remainingRecords.length,
  };
};
