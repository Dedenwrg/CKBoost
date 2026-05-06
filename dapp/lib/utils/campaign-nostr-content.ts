import type {
  QuestDataLike,
  QuestMetadataLike,
  QuestSubTaskDataLike,
} from "ssri-ckboost/types";

export const QUEST_CONTENT_FORMAT = "ckboost-campaign-quest-content";
export const QUEST_CONTENT_VERSION = 1;

const HEX_STRING_PATTERN = /^0x[0-9a-fA-F]*$/;

export interface QuestContentPayload {
  format: typeof QUEST_CONTENT_FORMAT;
  version: typeof QUEST_CONTENT_VERSION;
  quest_id: number;
  metadata: QuestMetadataLike;
  sub_tasks: QuestSubTaskDataLike[];
}

const decodeHexUtf8 = (value: string): string | null => {
  if (
    !HEX_STRING_PATTERN.test(value) ||
    value.length <= 2 ||
    (value.length - 2) % 2 !== 0
  ) {
    return null;
  }

  try {
    const hex = value.slice(2);
    const bytes = new Uint8Array(hex.length / 2);
    for (let index = 0; index < hex.length; index += 2) {
      bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
    }
    return new TextDecoder().decode(bytes).replace(/\u0000+$/g, "");
  } catch {
    return null;
  }
};

export const unwrapStorageReference = (value: string | undefined | null) => {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";

  const decoded = decodeHexUtf8(trimmed);
  return (decoded ?? trimmed).trim();
};

export const isNeventReference = (value: string | undefined | null) =>
  unwrapStorageReference(value).startsWith("nevent1");

export const getQuestContentNeventId = (quest: QuestDataLike): string | null => {
  const reference = unwrapStorageReference(quest.metadata?.long_description);
  return reference.startsWith("nevent1") ? reference : null;
};

export const buildQuestContentPayload = (
  quest: QuestDataLike
): QuestContentPayload => ({
  format: QUEST_CONTENT_FORMAT,
  version: QUEST_CONTENT_VERSION,
  quest_id: Number(quest.quest_id || 0),
  metadata: {
    title: quest.metadata?.title || "",
    short_description: quest.metadata?.short_description || "",
    long_description: quest.metadata?.long_description || "",
    requirements: quest.metadata?.requirements || "",
    difficulty: quest.metadata?.difficulty || 0,
    time_estimate: quest.metadata?.time_estimate || 0,
  },
  sub_tasks: quest.sub_tasks || [],
});

export const buildQuestChainStub = (
  quest: QuestDataLike,
  neventId: string
): QuestDataLike => ({
  ...quest,
  metadata: {
    title: quest.metadata?.title || "",
    short_description: quest.metadata?.short_description || "",
    long_description: neventId,
    requirements: "",
    difficulty: quest.metadata?.difficulty || 0,
    time_estimate: quest.metadata?.time_estimate || 0,
  },
  sub_tasks: [],
});

const isQuestMetadataPayload = (value: unknown): value is QuestMetadataLike => {
  if (!value || typeof value !== "object") return false;
  const metadata = value as Record<string, unknown>;
  return (
    typeof metadata.title === "string" &&
    typeof metadata.short_description === "string" &&
    typeof metadata.long_description === "string" &&
    typeof metadata.requirements === "string"
  );
};

const isQuestContentPayload = (value: unknown): value is QuestContentPayload => {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    payload.format === QUEST_CONTENT_FORMAT &&
    payload.version === QUEST_CONTENT_VERSION &&
    isQuestMetadataPayload(payload.metadata) &&
    Array.isArray(payload.sub_tasks)
  );
};

export const parseQuestContentPayload = (
  rawContent: string
): QuestContentPayload | null => {
  try {
    const parsed = JSON.parse(rawContent) as unknown;
    return isQuestContentPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const mergeQuestContentPayload = (
  quest: QuestDataLike,
  rawContent: string
): QuestDataLike | null => {
  const payload = parseQuestContentPayload(rawContent);
  if (!payload) return null;

  return {
    ...quest,
    metadata: {
      ...quest.metadata,
      ...payload.metadata,
    },
    sub_tasks: payload.sub_tasks,
  };
};
