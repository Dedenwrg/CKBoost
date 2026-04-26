import test from "node:test";
import assert from "node:assert/strict";
import { ccc } from "@ckb-ccc/core";
import {
  decodeClaimablePoolData,
  encodeClaimablePoolData,
  removeClaimablePoolEntriesForClaimant,
} from "./claimable-pool.js";

const USER_A = `0x${"11".repeat(32)}` as ccc.Hex;
const USER_B = `0x${"22".repeat(32)}` as ccc.Hex;
const USER_C = `0x${"33".repeat(32)}` as ccc.Hex;
const USER_D = `0x${"aa".repeat(32)}` as ccc.Hex;

test("claimable pool data round-trips and keeps the first 16 bytes as total amount", () => {
  const encoded = encodeClaimablePoolData([
    { claimantLockHash: USER_A, amount: 50n },
    { claimantLockHash: USER_B, amount: 75n },
  ]);

  const decoded = decodeClaimablePoolData(encoded);
  assert.equal(decoded.remainingAmount, 125n);
  assert.deepEqual(decoded.entries, [
    { claimantLockHash: USER_A, amount: 50n },
    { claimantLockHash: USER_B, amount: 75n },
  ]);

  const prefixAmount = ccc.numFromBytes(ccc.bytesFrom(encoded).slice(0, 16));
  assert.equal(prefixAmount, 125n);
});

test("claimable pool data supports an empty pool", () => {
  const encoded = encodeClaimablePoolData([]);
  const decoded = decodeClaimablePoolData(encoded);

  assert.equal(decoded.remainingAmount, 0n);
  assert.deepEqual(decoded.entries, []);
});

test("claimable pool data can still encode objects with an entries field", () => {
  const encoded = encodeClaimablePoolData({
    entries: [{ claimantLockHash: USER_A, amount: 10n }],
  });
  const decoded = decodeClaimablePoolData(encoded);

  assert.equal(decoded.remainingAmount, 10n);
  assert.deepEqual(decoded.entries, [{ claimantLockHash: USER_A, amount: 10n }]);
});

test("claimable pool data rejects invalid entries", () => {
  assert.throws(
    () =>
      encodeClaimablePoolData([{ claimantLockHash: USER_A, amount: 0n }]),
    /amount must be greater than zero/,
  );
  assert.throws(
    () =>
      encodeClaimablePoolData([{ claimantLockHash: USER_A, amount: -1n }]),
    /amount must be greater than zero/,
  );
  assert.throws(
    () =>
      encodeClaimablePoolData([{ claimantLockHash: "0x1234", amount: 1n }]),
    /Expected 32 bytes/,
  );
});

test("decodeClaimablePoolData rejects short data", () => {
  assert.throws(() => decodeClaimablePoolData("0x1234"), /too short/);
});

test("removeClaimablePoolEntriesForClaimant deletes all claimant entries", () => {
  const original = decodeClaimablePoolData(
    encodeClaimablePoolData([
      { claimantLockHash: USER_A, amount: 25n },
      { claimantLockHash: USER_B, amount: 10n },
      { claimantLockHash: USER_A, amount: 30n },
    ]),
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

test("removeClaimablePoolEntriesForClaimant matches lock hash case-insensitively", () => {
  const original = decodeClaimablePoolData(
    encodeClaimablePoolData([
      { claimantLockHash: USER_D, amount: 25n },
      { claimantLockHash: USER_B, amount: 10n },
    ]),
  );

  const result = removeClaimablePoolEntriesForClaimant(
    original,
    `0x${"AA".repeat(32)}` as ccc.Hex,
  );
  assert.equal(result.claimedAmount, 25n);
  assert.deepEqual(result.data.entries, [
    { claimantLockHash: USER_B, amount: 10n },
  ]);
});

test("removeClaimablePoolEntriesForClaimant rejects impossible over-claim data", () => {
  assert.throws(
    () =>
      removeClaimablePoolEntriesForClaimant(
        {
          remainingAmount: 10n,
          entries: [{ claimantLockHash: USER_A, amount: 11n }],
        },
        USER_A,
      ),
    /exceeds remaining pool amount/,
  );
});
