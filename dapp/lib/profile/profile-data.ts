import { ccc } from "@ckb-ccc/connector-react";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const PROFILE_DATA_KIND = {
  DISPLAY_NAME: "display_name",
} as const;

export type ProfileDataKind =
  (typeof PROFILE_DATA_KIND)[keyof typeof PROFILE_DATA_KIND];

export interface ProfileDataRecord<T = unknown> {
  kind: ProfileDataKind | string;
  version: number;
  createdAt: number;
  payload: T;
}

export interface DisplayNamePayload {
  value: string;
}

export type ProfileDataBytes = ccc.BytesLike;

const encodeRecord = (record: ProfileDataRecord): string => {
  const json = JSON.stringify(record);
  const bytes = textEncoder.encode(json);
  return ccc.hexFrom(bytes);
};

const decodeRecord = (entry: ProfileDataBytes): ProfileDataRecord | null => {
  try {
    const bytes = ccc.bytesFrom(entry);
    const json = textDecoder.decode(bytes);
    const parsed = JSON.parse(json);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as { kind?: unknown }).kind !== "string"
    ) {
      return null;
    }
    return parsed as ProfileDataRecord;
  } catch {
    return null;
  }
};

export const createDisplayNameRecord = (name: string): string =>
  encodeRecord({
    kind: PROFILE_DATA_KIND.DISPLAY_NAME,
    version: 1,
    createdAt: Date.now(),
    payload: { value: name },
  });

export const appendProfileRecord = (
  records: ProfileDataBytes[] = [],
  newRecord: ProfileDataRecord
): string[] => [...records, encodeRecord(newRecord)];

export const decodeProfileRecords = (
  records: ProfileDataBytes[] | undefined
): ProfileDataRecord[] => {
  if (!records?.length) {
    return [];
  }
  return records
    .map((entry) => decodeRecord(entry))
    .filter((record): record is ProfileDataRecord => Boolean(record));
};

export const getLatestDisplayName = (
  records: ProfileDataBytes[] | undefined
): string | null => {
  const decoded = decodeProfileRecords(records).filter(
    (record): record is ProfileDataRecord<DisplayNamePayload> =>
      record.kind === PROFILE_DATA_KIND.DISPLAY_NAME &&
      typeof record.payload === "object" &&
      record.payload !== null &&
      typeof (record.payload as DisplayNamePayload).value === "string"
  );

  if (!decoded.length) {
    return null;
  }

  const latest = decoded.reduce((latestRecord, current) => {
    if (!latestRecord) return current;
    return current.createdAt >= latestRecord.createdAt
      ? current
      : latestRecord;
  });

  return latest.payload.value;
};
