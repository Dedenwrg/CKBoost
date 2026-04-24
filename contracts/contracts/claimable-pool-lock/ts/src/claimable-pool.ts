import { ccc } from "@ckb-ccc/core";
import {
  ClaimablePoolEntryVec,
  type ClaimablePoolEntryLike,
} from "./generated/claimable-pool.js";

const UDT_AMOUNT_BYTES = 16;

export interface ClaimablePoolEntry {
  claimantLockHash: ccc.HexLike;
  amount: ccc.NumLike;
}

export interface ClaimablePoolData {
  remainingAmount: bigint;
  entries: ClaimablePoolEntry[];
}

export type { ClaimablePoolEntryLike };

export function encodeClaimablePoolData(
  data: ClaimablePoolEntry[] | { entries: ClaimablePoolEntry[] },
): ccc.Hex {
  const entries = (Array.isArray(data) ? data : data.entries).map(
    (entry): ClaimablePoolEntryLike => {
      const claimantLockHash = ccc.bytesFrom(entry.claimantLockHash);
      if (claimantLockHash.length !== 32) {
        throw new Error(`Expected 32 bytes, received ${claimantLockHash.length}`);
      }

      const amount = ccc.numFrom(entry.amount);
      if (amount <= 0n) {
        throw new Error("Claimable pool entry amount must be greater than zero");
      }

      return {
        claimant_lock_hash: ccc.hexFrom(claimantLockHash),
        amount,
      };
    },
  );
  const remainingAmount = entries.reduce(
    (total, entry) => total + ccc.numFrom(entry.amount),
    0n,
  );

  return ccc.hexFrom([
    ...ccc.numToBytes(remainingAmount, UDT_AMOUNT_BYTES),
    ...ccc.bytesFrom(ClaimablePoolEntryVec.encode(entries)),
  ]);
}

export function decodeClaimablePoolData(data: ccc.HexLike): ClaimablePoolData {
  const bytes = ccc.bytesFrom(data);
  if (bytes.length < UDT_AMOUNT_BYTES) {
    throw new Error("Claimable pool data is too short");
  }

  const remainingAmount = ccc.numFromBytes(bytes.slice(0, UDT_AMOUNT_BYTES));
  const entries = ClaimablePoolEntryVec.decode(bytes.slice(UDT_AMOUNT_BYTES));

  return {
    remainingAmount,
    entries: entries.map((entry) => ({
      claimantLockHash: ccc.hexFrom(entry.claimant_lock_hash),
      amount: ccc.numFrom(entry.amount),
    })),
  };
}

export function removeClaimablePoolEntriesForClaimant(
  data: ClaimablePoolData,
  claimantLockHash: ccc.HexLike,
): { data: ClaimablePoolData; claimedAmount: bigint } {
  const claimantLockHashBytes = ccc.bytesFrom(claimantLockHash);
  if (claimantLockHashBytes.length !== 32) {
    throw new Error(`Expected 32 bytes, received ${claimantLockHashBytes.length}`);
  }

  const normalizedLockHash = ccc.hexFrom(claimantLockHashBytes).toLowerCase();
  let claimedAmount = 0n;
  const entries: ClaimablePoolEntry[] = [];

  for (const entry of data.entries) {
    const entryLockHash = ccc.hexFrom(ccc.bytesFrom(entry.claimantLockHash));
    const amount = ccc.numFrom(entry.amount);
    if (entryLockHash.toLowerCase() === normalizedLockHash) {
      claimedAmount += amount;
    } else {
      entries.push({ claimantLockHash: entryLockHash, amount });
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
