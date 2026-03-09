"use client";

import {
  QuestDataLike,
  UserDataLike,
  UserSubmissionRecordLike,
} from "ssri-ckboost/types";
import { isNostrSubmissionData } from "@/types/submission";

type ExportCellValue = string | number | null;

type SubmissionRecordWithUser = UserSubmissionRecordLike & {
  userTypeId: string;
};

type QuestSubtaskLike = {
  title?: string;
  description?: string;
  type?: string;
  proof_required?: string;
};

type FetchedSubmission = {
  content: string;
  eventId?: string;
  author?: string;
  created_at?: number;
  relays?: string[];
};

export type SubmissionFetcher = (
  neventId: string
) => Promise<FetchedSubmission | null>;

export interface SubmissionUserInfo {
  name: string;
  email: string;
  twitter: string;
  discord: string;
}

export interface ResolvedSubmissionEvent {
  neventId: string;
  eventId?: string;
  pubkey?: string;
  createdAt?: number;
  relays?: string[];
  error?: string;
}

export interface ResolvedSubmissionContent {
  rawContent: string;
  resolvedContent: string;
  source: "direct" | "nostr" | "empty";
  events: ResolvedSubmissionEvent[];
}

export interface QuestResponseEntry {
  title: string;
  description: string;
  type: string;
  proofRequired: string;
  response: string;
}

export interface QuestSubmissionExportData {
  filename: string;
  sheetName: string;
  headers: string[];
  rows: Array<Record<string, ExportCellValue>>;
}

interface BuildQuestSubmissionExportDataArgs {
  campaignTitle: string;
  campaignTypeId: string;
  quest: QuestDataLike;
  submissions: SubmissionRecordWithUser[];
  userDetails: Map<string, UserDataLike>;
  fetchSubmission?: SubmissionFetcher;
}

const HEX_PATTERN = /^0x[0-9a-fA-F]*$/;
const NEVENT_PATTERN = /nevent1[0-9a-z]+/gi;
const DEFAULT_USER_INFO: SubmissionUserInfo = {
  name: "Anonymous",
  email: "",
  twitter: "",
  discord: "",
};

const textDecoder = new TextDecoder();

const isHexString = (value: string) =>
  HEX_PATTERN.test(value) && (value.length - 2) % 2 === 0;

const hexToBytes = (value: string): Uint8Array => {
  const normalized = value.startsWith("0x") ? value.slice(2) : value;
  const bytes = new Uint8Array(normalized.length / 2);

  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }

  return bytes;
};

const bytesToHex = (value: ArrayBuffer | ArrayBufferView): string => {
  const bytes =
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);

  return `0x${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")}`;
};

const decodeTextValue = (value: unknown): string => {
  if (typeof value === "string") {
    if (isHexString(value)) {
      try {
        return textDecoder.decode(hexToBytes(value));
      } catch {
        return value;
      }
    }
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return textDecoder.decode(new Uint8Array(value));
  }

  if (ArrayBuffer.isView(value)) {
    return textDecoder.decode(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    );
  }

  if (value == null) {
    return "";
  }

  return String(value);
};

const normalizeHexLike = (value: unknown): string => {
  if (typeof value === "string") {
    return value.toLowerCase();
  }

  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return bytesToHex(value).toLowerCase();
  }

  return "";
};

const findFirstString = (
  value: unknown,
  keys: readonly string[]
): string | null => {
  const queue: unknown[] = [value];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    if (typeof current === "object") {
      const record = current as Record<string, unknown>;

      for (const key of keys) {
        const candidate = record[key];
        if (typeof candidate === "string" && candidate.trim()) {
          return candidate.trim();
        }
      }

      queue.push(...Object.values(record));
    }
  }

  return null;
};

const sanitizeFilePart = (value: string, fallback: string): string => {
  const sanitized = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return sanitized.length > 0 ? sanitized : fallback;
};

const sanitizeSheetName = (value: string): string => {
  const sanitized = value
    .replace(/[\[\]:*?/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (sanitized || "Quest Submissions").slice(0, 31);
};

export const extractNeventIds = (content: string): string[] =>
  Array.from(new Set(content.match(NEVENT_PATTERN) || []));

export const parseSubmissionUserInfo = (
  userData?: UserDataLike
): SubmissionUserInfo => {
  const identityData =
    userData?.verification_data?.identity_verification_data ?? null;
  const decoded = decodeTextValue(identityData).trim();

  if (!decoded) {
    return DEFAULT_USER_INFO;
  }

  if (decoded.startsWith("{") || decoded.startsWith("[")) {
    try {
      const parsed = JSON.parse(decoded);
      return {
        name:
          findFirstString(parsed, [
            "displayName",
            "display_name",
            "name",
            "first_name",
            "username",
            "handle",
          ]) ?? DEFAULT_USER_INFO.name,
        email:
          findFirstString(parsed, ["email", "email_address"]) ??
          DEFAULT_USER_INFO.email,
        twitter:
          findFirstString(parsed, [
            "twitter",
            "twitter_handle",
            "twitterHandle",
            "x",
            "x_handle",
            "xHandle",
          ]) ?? DEFAULT_USER_INFO.twitter,
        discord:
          findFirstString(parsed, [
            "discord",
            "discord_handle",
            "discordHandle",
            "discord_username",
            "discordUsername",
          ]) ?? DEFAULT_USER_INFO.discord,
      };
    } catch {
      return {
        ...DEFAULT_USER_INFO,
        name: decoded,
      };
    }
  }

  return {
    ...DEFAULT_USER_INFO,
    name: decoded,
  };
};

export const resolveSubmissionContent = async (
  content: unknown,
  fetchSubmission?: SubmissionFetcher
): Promise<ResolvedSubmissionContent> => {
  const rawContent = decodeTextValue(content).trim();

  if (!rawContent) {
    return {
      rawContent: "",
      resolvedContent: "",
      source: "empty",
      events: [],
    };
  }

  const neventIds = extractNeventIds(rawContent);
  if (neventIds.length === 0) {
    return {
      rawContent,
      resolvedContent: rawContent,
      source: "direct",
      events: [],
    };
  }

  const events: ResolvedSubmissionEvent[] = [];
  let primaryContent = "";

  for (const neventId of neventIds) {
    if (!fetchSubmission) {
      events.push({
        neventId,
        error: "Nostr fetcher not available",
      });
      continue;
    }

    try {
      const result = await fetchSubmission(neventId);
      if (!result) {
        events.push({
          neventId,
          error: "Failed to fetch content from Nostr",
        });
        continue;
      }

      events.push({
        neventId,
        eventId: result.eventId,
        pubkey: result.author,
        createdAt: result.created_at,
        relays: result.relays,
      });

      if (!primaryContent) {
        primaryContent = decodeTextValue(result.content).trim();
      }
    } catch (error) {
      events.push({
        neventId,
        error:
          error instanceof Error ? error.message : "Failed to fetch from Nostr",
      });
    }
  }

  return {
    rawContent,
    resolvedContent: primaryContent || rawContent,
    source: "nostr",
    events,
  };
};

export const buildQuestResponseEntries = (
  quest: Pick<QuestDataLike, "sub_tasks"> | undefined,
  resolvedContent: string
): QuestResponseEntry[] => {
  const questSubtasks = Array.isArray(quest?.sub_tasks)
    ? quest.sub_tasks
    : [];
  const trimmedContent = resolvedContent.trim();

  let parsedSubtasks:
    | Array<{
        title?: string;
        description?: string;
        type?: string;
        proof_required?: string;
        response?: string;
      }>
    | null = null;

  if (trimmedContent.startsWith("{") || trimmedContent.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmedContent) as unknown;
      if (isNostrSubmissionData(parsed)) {
        parsedSubtasks = parsed.subtasks;
      }
    } catch {
      parsedSubtasks = null;
    }
  }

  if (!parsedSubtasks && questSubtasks.length === 1) {
    const [subtask] = questSubtasks;
    return [
      {
        title: subtask.title || "Subtask 1",
        description: subtask.description || "",
        type: subtask.type || "",
        proofRequired: subtask.proof_required || "",
        response: trimmedContent,
      },
    ];
  }

  if (!parsedSubtasks && questSubtasks.length === 0 && trimmedContent) {
    return [
      {
        title: "Response",
        description: "",
        type: "",
        proofRequired: "",
        response: trimmedContent,
      },
    ];
  }

  const responseCount = Math.max(
    questSubtasks.length,
    parsedSubtasks?.length || 0
  );

  return Array.from({ length: responseCount }, (_, index) => {
    const questSubtask = questSubtasks[index] as QuestSubtaskLike | undefined;
    const parsedSubtask = parsedSubtasks?.[index];

    return {
      title:
        questSubtask?.title ||
        parsedSubtask?.title ||
        `Subtask ${index + 1}`,
      description:
        questSubtask?.description || parsedSubtask?.description || "",
      type: questSubtask?.type || parsedSubtask?.type || "",
      proofRequired:
        questSubtask?.proof_required || parsedSubtask?.proof_required || "",
      response: parsedSubtask?.response || "",
    };
  });
};

export const buildQuestSubmissionExportData = async ({
  campaignTitle,
  campaignTypeId,
  quest,
  submissions,
  userDetails,
  fetchSubmission,
}: BuildQuestSubmissionExportDataArgs): Promise<QuestSubmissionExportData> => {
  const questId = Number(quest.quest_id);
  const questTitle = quest.metadata?.title || `Quest ${questId}`;
  const approvedUserIds = new Set(
    (quest.accepted_submission_user_type_ids || [])
      .map((userTypeId) => normalizeHexLike(userTypeId))
      .filter(Boolean)
  );
  const fetchCache = new Map<string, Promise<FetchedSubmission | null>>();
  const cachedFetch: SubmissionFetcher | undefined = fetchSubmission
    ? (neventId) => {
        const cached = fetchCache.get(neventId);
        if (cached) {
          return cached;
        }

        const request = fetchSubmission(neventId);
        fetchCache.set(neventId, request);
        return request;
      }
    : undefined;

  const missingApprovedRows = Array.from(approvedUserIds)
    .filter(
      (userTypeId) =>
        !submissions.some(
          (submission) => normalizeHexLike(submission.userTypeId) === userTypeId
        )
    )
    .map((userTypeId) => ({
      userTypeId,
      submission: null,
    }));

  const preparedRows = await Promise.all(
    [
      ...submissions.map((submission) => ({
        userTypeId: submission.userTypeId,
        submission,
      })),
      ...missingApprovedRows,
    ].map(async ({ submission, userTypeId }) => {
      const normalizedUserTypeId = normalizeHexLike(userTypeId);
      const userData =
        userDetails.get(userTypeId) || userDetails.get(normalizedUserTypeId);
      const userInfo = parseSubmissionUserInfo(userData);
      const resolvedContent = submission
        ? await resolveSubmissionContent(
            submission.submission_content,
            cachedFetch
          )
        : {
            rawContent: "",
            resolvedContent: "",
            source: "empty" as const,
            events: [],
          };
      const responses = buildQuestResponseEntries(quest, resolvedContent.resolvedContent);
      const submittedAtValue = submission
        ? Number(submission.submission_timestamp)
        : NaN;
      const submittedAt = Number.isFinite(submittedAtValue)
        ? new Date(submittedAtValue).toISOString()
        : "";
      const isApproved = approvedUserIds.has(normalizedUserTypeId);

      return {
        submittedAtValue: Number.isFinite(submittedAtValue)
          ? submittedAtValue
          : -1,
        userName: userInfo.name,
        baseRow: {
          "Campaign Title": campaignTitle,
          "Campaign Type ID": campaignTypeId,
          "Quest ID": questId,
          "Quest Title": questTitle,
          Status: isApproved ? "Approved" : "Pending",
          "Quest Points": Number(quest.points || 0),
          "Submitted At": submittedAt,
          "User Name": userInfo.name,
          "User Email": userInfo.email,
          "User Twitter": userInfo.twitter,
          "User Discord": userInfo.discord,
          "User Type ID": userTypeId,
          "User Total Points": Number(userData?.total_points_earned || 0),
          "Raw Submission Reference": resolvedContent.rawContent,
          "Resolved Submission Content": resolvedContent.resolvedContent,
          "Content Source": resolvedContent.source,
          "Nostr Event IDs": resolvedContent.events
            .map((event) => event.neventId)
            .join("\n"),
          "Nostr Event Errors": resolvedContent.events
            .filter((event) => event.error)
            .map((event) => `${event.neventId}: ${event.error}`)
            .join("\n"),
        },
        responses,
      };
    })
  );

  preparedRows.sort((left, right) => {
    if (left.submittedAtValue !== right.submittedAtValue) {
      return right.submittedAtValue - left.submittedAtValue;
    }
    return left.userName.localeCompare(right.userName);
  });

  const maxResponses = preparedRows.reduce(
    (max, row) => Math.max(max, row.responses.length),
    0
  );
  const headers = [
    "Campaign Title",
    "Campaign Type ID",
    "Quest ID",
    "Quest Title",
    "Status",
    "Quest Points",
    "Submitted At",
    "User Name",
    "User Email",
    "User Twitter",
    "User Discord",
    "User Type ID",
    "User Total Points",
    "Raw Submission Reference",
    "Resolved Submission Content",
    "Content Source",
    "Nostr Event IDs",
    "Nostr Event Errors",
  ];

  for (let index = 0; index < maxResponses; index += 1) {
    const label = `Subtask ${index + 1}`;
    headers.push(
      `${label} Title`,
      `${label} Description`,
      `${label} Type`,
      `${label} Required Proof`,
      `${label} Response`
    );
  }

  const rows = preparedRows.map(({ baseRow, responses }) => {
    const row: Record<string, ExportCellValue> = { ...baseRow };

    for (let index = 0; index < maxResponses; index += 1) {
      const label = `Subtask ${index + 1}`;
      const response = responses[index];

      row[`${label} Title`] = response?.title || "";
      row[`${label} Description`] = response?.description || "";
      row[`${label} Type`] = response?.type || "";
      row[`${label} Required Proof`] = response?.proofRequired || "";
      row[`${label} Response`] = response?.response || "";
    }

    return row;
  });

  return {
    filename: `${sanitizeFilePart(campaignTitle, "campaign")}-${sanitizeFilePart(
      questTitle,
      "quest"
    )}-submissions.xlsx`,
    sheetName: sanitizeSheetName(questTitle),
    headers,
    rows,
  };
};
