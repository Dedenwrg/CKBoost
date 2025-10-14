"use client";

import { ccc } from "@ckb-ccc/connector-react";

const identityCandidateKeys = [
  "displayName",
  "display_name",
  "name",
  "first_name",
  "username",
  "handle",
] as const;

const collectCandidate = (value: unknown): string | null => {
  const candidates: string[] = [];

  const visit = (input: unknown) => {
    if (!input) return;
    if (Array.isArray(input)) {
      input.forEach(visit);
      return;
    }
    if (typeof input === "object") {
      const record = input as Record<string, unknown>;
      for (const key of identityCandidateKeys) {
        const candidate = record[key];
        if (typeof candidate === "string" && candidate.trim()) {
          candidates.push(candidate.trim());
        }
      }
      for (const entry of Object.values(record)) {
        visit(entry);
      }
    }
  };

  visit(value);
  return candidates.length > 0 ? candidates[0] : null;
};

const normalizeIdentityBytes = (identityData: unknown): string | null => {
  if (!identityData) return null;

  if (typeof identityData === "string") {
    try {
      return identityData.startsWith("0x")
        ? new TextDecoder().decode(ccc.bytesFrom(identityData))
        : identityData;
    } catch {
      return identityData;
    }
  }

  if (
    typeof identityData === "object" &&
    ArrayBuffer.isView(identityData as ArrayBufferView)
  ) {
    try {
      return new TextDecoder().decode(identityData as ArrayBufferView);
    } catch {
      return null;
    }
  }

  return null;
};

export const extractIdentityDisplayName = (
  identityData: unknown
): string | null => {
  const decoded = normalizeIdentityBytes(identityData);
  if (!decoded) return null;

  const trimmed = decoded.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      const candidate = collectCandidate(parsed);
      if (candidate) return candidate;
    } catch {
      // fall through to other handling
    }
  }

  if (
    !trimmed.startsWith("{") &&
    !trimmed.startsWith("[") &&
    !trimmed.startsWith('"')
  ) {
    return trimmed;
  }

  return null;
};
