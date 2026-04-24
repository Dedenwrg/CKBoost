import { ccc, mol } from "@ckb-ccc/core";
import { signer } from "@ckb-ccc/playground";

// What this example does:
// - Reads live claimable pool cells under one claimable-pool-lock script.
// - Finds entries that belong to the claimant lock hash you provide.
// - Groups claimable amounts by UDT Type, so different UDTs are shown
//    separately.
//
// This example is read-only. It does not assemble or send a transaction.

// -----------------------------------------------------------------------------
// Configuration - edit this section
// -----------------------------------------------------------------------------
// Fill these before running:
// - claimablePoolLock: the full lock script used by the pool cells you want to
//   query. codeHash is the deployed contract type hash, and args is the
//   recycler lock hash stored in the pool lock.
// - claimantLockHash: your own 32-byte lock hash.
// - debug: set to true when you want scan diagnostics.
//
// By default this queries pools created by create.ts for the current Playground
// signer. Replace args and claimantLockHash when querying another user/pool.
const signerLockHash = (await signer.getRecommendedAddressObj()).script.hash();
const claimablePoolLock = {
  codeHash:
    "0x458cacb13a3c40e6d046468e7fe3f5c2c93f0581062e269dc9ffec4858346cb6",
  hashType: "type",
  args: signerLockHash,
};

const claimantLockHash = signerLockHash;
const debug = false;

// -----------------------------------------------------------------------------
// Setup - no changes needed
// -----------------------------------------------------------------------------
const poolLock = ccc.Script.from(claimablePoolLock);
const claimantLockHashBytes = ccc.bytesFrom(claimantLockHash);
if (claimantLockHashBytes.length !== 32) {
  throw new Error(
    `Expected claimant lock hash to be 32 bytes, got ${claimantLockHashBytes.length}`,
  );
}
const normalizedClaimantLockHash = ccc
  .hexFrom(claimantLockHashBytes)
  .toLowerCase();
const poolLockHash = poolLock.hash();
const normalizedClaimantLockHashHex = ccc.hexFrom(claimantLockHashBytes);

// -----------------------------------------------------------------------------
// Query - no changes needed
// -----------------------------------------------------------------------------
const ClaimablePoolEntry = mol.struct({
  claimant_lock_hash: mol.Byte32,
  amount: mol.Uint128,
});
const ClaimablePoolEntryVec = mol.vector(ClaimablePoolEntry);

const totalsByType = new Map();
const scannedPoolCellSamples = [];
let scannedPoolCells = 0;
let claimablePoolCells = 0;
let poolCellsWithoutClaimant = 0;
let skippedCellsWithoutType = 0;

// Scan live pool cells locked by this exact claimable-pool-lock script.
for await (const poolCell of signer.client.findCellsByLock(
  poolLock,
  undefined,
  true,
)) {
  scannedPoolCells += 1;

  if (!poolCell.cellOutput.type) {
    skippedCellsWithoutType += 1;
    continue;
  }

  const poolDataBytes = ccc.bytesFrom(poolCell.outputData);
  if (poolDataBytes.length < 16) {
    throw new Error(
      `Pool cell ${poolCell.outPoint.txHash}:${poolCell.outPoint.index} data is too short`,
    );
  }

  const remainingAmount = ccc.numFromBytes(poolDataBytes.slice(0, 16));
  let claimableAmount = 0n;
  const entries = ClaimablePoolEntryVec.decode(poolDataBytes.slice(16));
  for (const entry of entries) {
    const entryClaimantLockHash = ccc
      .hexFrom(entry.claimant_lock_hash)
      .toLowerCase();
    if (entryClaimantLockHash === normalizedClaimantLockHash) {
      claimableAmount += ccc.numFrom(entry.amount);
    }
  }

  const typeScript = poolCell.cellOutput.type;
  const typeHash = typeScript.hash();
  if (scannedPoolCellSamples.length < 10) {
    scannedPoolCellSamples.push({
      outPoint: {
        txHash: poolCell.outPoint.txHash,
        index: Number(poolCell.outPoint.index),
      },
      typeHash,
      type: {
        codeHash: typeScript.codeHash,
        hashType: typeScript.hashType,
        args: typeScript.args,
      },
      remainingAmount: remainingAmount.toString(),
      entryCount: entries.length,
      claimableAmount: claimableAmount.toString(),
    });
  }

  if (claimableAmount === 0n) {
    poolCellsWithoutClaimant += 1;
    continue;
  }

  claimablePoolCells += 1;
  const existing = totalsByType.get(typeHash) ?? {
    typeHash,
    type: {
      codeHash: typeScript.codeHash,
      hashType: typeScript.hashType,
      args: typeScript.args,
    },
    amount: 0n,
    poolCells: [],
  };

  existing.amount += claimableAmount;
  existing.poolCells.push({
    outPoint: {
      txHash: poolCell.outPoint.txHash,
      index: Number(poolCell.outPoint.index),
    },
    amount: claimableAmount.toString(),
  });
  totalsByType.set(typeHash, existing);
}

// -----------------------------------------------------------------------------
// Result grouping - no changes needed
// -----------------------------------------------------------------------------
const claimableByType = [...totalsByType.values()].map((item) => ({
  typeHash: item.typeHash,
  type: item.type,
  amount: item.amount.toString(),
  poolCells: item.poolCells,
}));

const totalClaimableAmount = claimableByType.reduce(
  (total, item) => total + BigInt(item.amount),
  0n,
);

const diagnostics = [];
if (scannedPoolCells === 0) {
  diagnostics.push(
    "No live cell matched claimablePoolLock exactly. Compare claimablePoolLock.args with the `Query claimablePoolLock.args` line printed by create.ts.",
  );
  diagnostics.push(
    "For pools created by create.ts, claimablePoolLock.args must equal the signer lock hash printed by create.ts.",
  );
  diagnostics.push(
    "Also check that CCC Playground is on the same network as the create transaction and that the indexer has caught up.",
  );
} else if (claimablePoolCells === 0) {
  diagnostics.push(
    "The lock script matched live pool cells, but none contained claimantLockHash in their Molecule entries.",
  );
  diagnostics.push(
    "Check scanned pool samples and compare claimantLockHash with the claimant lock hash printed by create.ts.",
  );
} else {
  diagnostics.push(
    "Found claimable entries. Use claimableByType[].poolCells[].outPoint with claim.ts.",
  );
}
if (skippedCellsWithoutType > 0) {
  diagnostics.push(
    "Some matched cells had no Type script and were skipped because claimable UDT type could not be determined.",
  );
}

// -----------------------------------------------------------------------------
// Print and inspect - no changes needed
// -----------------------------------------------------------------------------
console.log("Claimable Pool Query");
console.log(`Pool lock hash: ${poolLockHash}`);
console.log(`Claimant lock hash: ${normalizedClaimantLockHashHex}`);
console.log(
  `Claimable cells: ${claimablePoolCells} | UDT types: ${claimableByType.length} | Total amount: ${totalClaimableAmount.toString()}`,
);

if (claimableByType.length > 0) {
  for (const [typeIndex, item] of claimableByType.entries()) {
    console.log(
      `${typeIndex + 1}. Type ${item.typeHash} | amount ${item.amount} | cells ${item.poolCells.length}`,
    );

    for (const [cellIndex, cell] of item.poolCells.entries()) {
      console.log(
        `${cellIndex + 1}. OutPoint: ${cell.outPoint.txHash}:${cell.outPoint.index} | Amount: ${cell.amount}`,
      );
    }
  }
} else {
  for (const item of diagnostics) {
    console.log(item);
  }
}

if (debug) {
  console.log("Debug");
  console.log(`Network: ${signer.client.addressPrefix}`);
  console.log(`Pool lock args: ${poolLock.args}`);
  console.log(`Scanned pool cells: ${scannedPoolCells}`);
  console.log(`Pools without claimant entry: ${poolCellsWithoutClaimant}`);
  console.log(`Skipped cells without Type: ${skippedCellsWithoutType}`);
  console.log("Search: findCellsByLock, withData=true");
  console.log("Scanned pool cell samples");

  if (scannedPoolCellSamples.length === 0) {
    console.log("No scanned pool cell samples.");
  } else {
    for (const [index, cell] of scannedPoolCellSamples.entries()) {
      console.log(
        `${index + 1}. ${cell.outPoint.txHash}:${cell.outPoint.index} | type=${cell.typeHash} | remaining=${cell.remainingAmount} | entries=${cell.entryCount} | claimable=${cell.claimableAmount}`,
      );
    }
  }

  console.log("Diagnostics");
  for (const item of diagnostics) {
    console.log(item);
  }
}
