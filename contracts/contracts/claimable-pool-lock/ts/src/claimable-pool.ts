import { ccc } from "@ckb-ccc/core";
import {
  ClaimablePoolEntryVec,
  type ClaimablePoolEntryLike,
} from "./generated/claimable-pool.js";

const U128_BYTES = 16;
const BYTE32_BYTES = 32;

export interface ClaimablePoolEntry {
  claimantLockHash: ccc.Hex;
  amount: bigint;
}

export interface ClaimablePoolData {
  remainingAmount: bigint;
  entries: ClaimablePoolEntry[];
}

export type { ClaimablePoolEntryLike };

function normalizeByte32(value: ccc.HexLike): ccc.Hex {
  const bytes = ccc.bytesFrom(value);
  if (bytes.length !== BYTE32_BYTES) {
    throw new Error(`Expected 32 bytes, received ${bytes.length}`);
  }
  return ccc.hexFrom(bytes);
}

export function encodeClaimablePoolLockArgs(params: {
  recyclerLockHash: ccc.HexLike;
}): ccc.Hex {
  return normalizeByte32(params.recyclerLockHash);
}

export function decodeClaimablePoolLockArgs(args: ccc.HexLike): {
  recyclerLockHash: ccc.Hex;
} {
  return { recyclerLockHash: normalizeByte32(args) };
}

export function chunkClaimablePoolEntries(
  entries: ClaimablePoolEntry[],
  chunkSize = 100,
): ClaimablePoolEntry[][] {
  if (chunkSize <= 0) {
    throw new Error("chunkSize must be greater than zero");
  }

  const chunks: ClaimablePoolEntry[][] = [];
  for (let index = 0; index < entries.length; index += chunkSize) {
    chunks.push(entries.slice(index, index + chunkSize));
  }

  return chunks;
}

export function encodeClaimablePoolData(data: ClaimablePoolData): ccc.Hex {
  const blob = ClaimablePoolEntryVec.encode(
    data.entries.map(
      (entry): ClaimablePoolEntryLike => ({
        claimant_lock_hash: normalizeByte32(entry.claimantLockHash),
        amount: entry.amount,
      }),
    ),
  );

  return ccc.hexFrom([
    ...ccc.numToBytes(data.remainingAmount, U128_BYTES),
    ...ccc.bytesFrom(blob),
  ]);
}

export function decodeClaimablePoolData(data: ccc.HexLike): ClaimablePoolData {
  const bytes = ccc.bytesFrom(data);
  if (bytes.length < U128_BYTES) {
    throw new Error("Claimable pool data is too short");
  }

  const remainingAmount = ccc.numFromBytes(bytes.slice(0, U128_BYTES));
  const entries = ClaimablePoolEntryVec.decode(bytes.slice(U128_BYTES));

  return {
    remainingAmount,
    entries: entries.map((entry) => ({
      claimantLockHash: ccc.hexFrom(entry.claimant_lock_hash),
      amount: ccc.numFrom(entry.amount),
    })),
  };
}

export function createClaimablePoolData(params: {
  entries: Array<{
    claimantLockHash: ccc.HexLike;
    amount: bigint;
  }>;
}): ccc.Hex {
  const entries = params.entries.map((entry) => ({
    claimantLockHash: normalizeByte32(entry.claimantLockHash),
    amount: entry.amount,
  }));

  for (const entry of entries) {
    if (entry.amount <= 0n) {
      throw new Error("Claimable pool entry amount must be greater than zero");
    }
  }

  return encodeClaimablePoolData({
    remainingAmount: entries.reduce((total, entry) => total + entry.amount, 0n),
    entries,
  });
}

export function removeClaimablePoolEntriesForClaimant(
  data: ClaimablePoolData,
  claimantLockHash: ccc.HexLike,
): { data: ClaimablePoolData; claimedAmount: bigint } {
  const normalizedLockHash = normalizeByte32(claimantLockHash).toLowerCase();
  let claimedAmount = 0n;
  const entries: ClaimablePoolEntry[] = [];

  for (const entry of data.entries) {
    if (entry.claimantLockHash.toLowerCase() === normalizedLockHash) {
      claimedAmount += entry.amount;
    } else {
      entries.push(entry);
    }
  }

  if (claimedAmount === 0n) {
    throw new Error(`Lock ${normalizedLockHash} is not claimable in this pool`);
  }
  if (claimedAmount > data.remainingAmount) {
    throw new Error("Claimed amount exceeds remaining pool amount");
  }

  return {
    claimedAmount,
    data: {
      remainingAmount: data.remainingAmount - claimedAmount,
      entries,
    },
  };
}
