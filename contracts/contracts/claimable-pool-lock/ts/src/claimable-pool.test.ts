import test from "node:test";
import assert from "node:assert/strict";
import { ccc } from "@ckb-ccc/core";
import {
  chunkClaimablePoolEntries,
  createClaimablePoolData,
  decodeClaimablePoolLockArgs,
  decodeClaimablePoolData,
  encodeClaimablePoolLockArgs,
  removeClaimablePoolEntriesForClaimant,
} from "./claimable-pool.js";

const USER_A = `0x${"11".repeat(32)}` as ccc.Hex;
const USER_B = `0x${"22".repeat(32)}` as ccc.Hex;
const USER_C = `0x${"33".repeat(32)}` as ccc.Hex;

test("chunkClaimablePoolEntries preserves entry amounts and chunk boundaries", () => {
  const chunks = chunkClaimablePoolEntries(
    [
      { claimantLockHash: USER_A, amount: 10n },
      { claimantLockHash: USER_B, amount: 20n },
      { claimantLockHash: USER_C, amount: 30n },
    ],
    2,
  );

  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks[0], [
    { claimantLockHash: USER_A, amount: 10n },
    { claimantLockHash: USER_B, amount: 20n },
  ]);
  assert.deepEqual(chunks[1], [{ claimantLockHash: USER_C, amount: 30n }]);
});

test("claimable pool data round-trips and keeps the first 16 bytes as total amount", () => {
  const encoded = createClaimablePoolData({
    entries: [
      { claimantLockHash: USER_A, amount: 50n },
      { claimantLockHash: USER_B, amount: 75n },
    ],
  });

  const decoded = decodeClaimablePoolData(encoded);
  assert.equal(decoded.remainingAmount, 125n);
  assert.deepEqual(decoded.entries, [
    { claimantLockHash: USER_A, amount: 50n },
    { claimantLockHash: USER_B, amount: 75n },
  ]);

  const prefixAmount = ccc.numFromBytes(ccc.bytesFrom(encoded).slice(0, 16));
  assert.equal(prefixAmount, 125n);
});

test("claimable pool lock args are the recycler lock hash bytes", () => {
  const encoded = encodeClaimablePoolLockArgs({
    recyclerLockHash: USER_B,
  });

  assert.equal(encoded, USER_B);
  assert.deepEqual(decodeClaimablePoolLockArgs(encoded), {
    recyclerLockHash: USER_B,
  });
});

test("removeClaimablePoolEntriesForClaimant deletes all claimant entries", () => {
  const original = decodeClaimablePoolData(
    createClaimablePoolData({
      entries: [
        { claimantLockHash: USER_A, amount: 25n },
        { claimantLockHash: USER_B, amount: 10n },
        { claimantLockHash: USER_A, amount: 30n },
      ],
    }),
  );

  const result = removeClaimablePoolEntriesForClaimant(original, USER_A);
  assert.equal(result.claimedAmount, 55n);
  assert.equal(result.data.remainingAmount, 10n);
  assert.deepEqual(result.data.entries, [{ claimantLockHash: USER_B, amount: 10n }]);

  assert.throws(
    () => removeClaimablePoolEntriesForClaimant(result.data, USER_A),
    /is not claimable/,
  );
  assert.throws(
    () => removeClaimablePoolEntriesForClaimant(result.data, USER_C),
    /is not claimable/,
  );
});
