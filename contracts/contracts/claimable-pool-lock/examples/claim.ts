import { ccc, mol } from "@ckb-ccc/core";
import { render, signer } from "@ckb-ccc/playground";

// What this example does:
// - Claims every entry in the pool that belongs to the current Playground signer.
// - Keeps the remaining pool as output 0.
// - Pays the claimed mock amount to the signer as output 1.
//
// The claim is all-or-nothing for the signer. This example does not do partial
// claim.

// -----------------------------------------------------------------------------
// Configuration - edit this section
// -----------------------------------------------------------------------------
// Fill these before running:
// - claimablePoolLockTypeId: the deployed Type ID args. You can copy it from
//   deployments.json -> current.testnet.claimablePoolLock.typeScript.args.
// - poolCellOutPoint: the pool cell created by create.ts.
const claimablePoolLockTypeId =
  "0x6953e9905a3c922da6974aafdbaf3b22965982894c558a0a125e8dc796a5b8a2";

// If you want to use your own script cell outPoint directly, replace the Type
// ID lookup below with getCellLive(claimablePoolLockOutPoint).
// const claimablePoolLockOutPoint = {
//   txHash: "0x",
//   index: 0,
// };

const poolCellOutPoint = {
  txHash: "0x",
  index: 0,
};

// -----------------------------------------------------------------------------
// Setup - no changes needed
// -----------------------------------------------------------------------------
const signerLock = (await signer.getRecommendedAddressObj()).script;
const signerLockHash = signerLock.hash();
const normalizedSignerLockHash = signerLockHash.toLowerCase();

const poolCell = await signer.client.getCellLive(poolCellOutPoint, true, true);
if (!poolCell?.cellOutput.type) {
  throw new Error("Pool cell not found, spent, or missing mock type");
}

// Find the deployed script cell by Type ID, then use its outPoint as CellDep.
// To use the outPoint above instead, replace this Type ID lookup with:
// const claimablePoolLockCell = await signer.client.getCellLive(
//   claimablePoolLockOutPoint,
//   false,
//   true,
// );
const claimablePoolLockCell = await signer.client.findSingletonCellByType(
  await ccc.Script.fromKnownScript(
    signer.client,
    ccc.KnownScript.TypeId,
    claimablePoolLockTypeId,
  ),
  false,
);
if (!claimablePoolLockCell?.cellOutput.type) {
  throw new Error("claimable-pool-lock script cell not found by Type ID");
}
const claimablePoolLockOutPoint = claimablePoolLockCell.outPoint;

// -----------------------------------------------------------------------------
// Pool data - no changes needed
// -----------------------------------------------------------------------------
const ClaimablePoolEntry = mol.struct({
  claimant_lock_hash: mol.Byte32,
  amount: mol.Uint128,
});
const ClaimablePoolEntryVec = mol.vector(ClaimablePoolEntry);

// Decode the pool data with the Molecule schema used by the lock contract.
const poolDataBytes = ccc.bytesFrom(poolCell.outputData);
if (poolDataBytes.length < 16) {
  throw new Error("Pool data is too short");
}
const remainingAmount = ccc.numFromBytes(poolDataBytes.slice(0, 16));
const entries = ClaimablePoolEntryVec.decode(poolDataBytes.slice(16)).map(
  (entry) => ({
    lockHash: ccc.hexFrom(entry.claimant_lock_hash),
    amount: ccc.numFrom(entry.amount),
  }),
);

// Remove every entry for the signer. The lock requires this claim to be
// all-or-nothing for the signer, so no signer entry is left in the pool output.
let claimedAmount = 0n;
let updatedRemainingAmount = remainingAmount;
const remainingEntries = [];
for (const entry of entries) {
  if (entry.lockHash.toLowerCase() === normalizedSignerLockHash) {
    claimedAmount += entry.amount;
    updatedRemainingAmount -= entry.amount;
  } else {
    remainingEntries.push(entry);
  }
}
if (claimedAmount === 0n) {
  throw new Error("Signer has nothing claimable in this pool");
}

const updatedPoolData = ccc.hexFrom([
  ...ccc.numToBytes(updatedRemainingAmount, 16),
  ...ccc.bytesFrom(
    ClaimablePoolEntryVec.encode(
      remainingEntries.map((entry) => ({
        claimant_lock_hash: entry.lockHash,
        amount: entry.amount,
      })),
    ),
  ),
]);

// -----------------------------------------------------------------------------
// Transaction - no changes needed
// -----------------------------------------------------------------------------
// Describe what we want: consume the old pool, keep the updated pool as output
// 0, and pay the signer the claimed mock amount as output 1.
const tx = ccc.Transaction.from({});
tx.addCellDeps({ outPoint: claimablePoolLockOutPoint, depType: "code" });
await tx.addCellDepsOfKnownScripts(
  signer.client,
  ccc.KnownScript.AlwaysSuccess,
);
tx.addInput(poolCell);
tx.addOutput(
  {
    capacity: poolCell.cellOutput.capacity,
    lock: poolCell.cellOutput.lock,
    type: poolCell.cellOutput.type,
  },
  updatedPoolData,
);
tx.addOutput(
  {
    lock: signerLock,
    type: poolCell.cellOutput.type,
  },
  ccc.hexFrom(ccc.numToBytes(claimedAmount, 16)),
);

// -----------------------------------------------------------------------------
// Render, send, and inspect - no changes needed
// -----------------------------------------------------------------------------
console.log("Claim Pool Cell");
console.log(`Pool cell: ${poolCellOutPoint.txHash}:${poolCellOutPoint.index}`);
console.log(`Signer lock hash: ${signerLockHash}`);
console.log(`UDT type hash: ${poolCell.cellOutput.type.hash()}`);
console.log(`Claim amount: ${claimedAmount.toString()}`);
console.log(`Remaining pool amount: ${updatedRemainingAmount.toString()}`);
await render(tx);

// Complete missing parts: add one signer-controlled input. The lock checks this
// input to verify that the claimant is actually present in the transaction.
console.log("Adding one signer input so the lock can verify the claimant...");
await tx.completeInputsAddOne(signer);
await render(tx);

// Complete missing parts: Pay fee.
console.log("Completing transaction fee...");
await tx.completeFeeBy(signer);
await render(tx);

// Send the transaction and print the updated pool outPoint.
console.log("Sending transaction...");
const txHash = await signer.sendTransaction(tx);
console.log("Claim Complete");
console.log(`Transaction: ${txHash}`);
console.log(`Updated pool cell: ${txHash}:0`);
console.log(`Claimed amount output: ${txHash}:1`);
console.log(`Claimed amount: ${claimedAmount.toString()}`);
console.log(`Remaining pool amount: ${updatedRemainingAmount.toString()}`);
