import { ccc, mol } from "@ckb-ccc/core";
import { render, signer } from "@ckb-ccc/playground";

// What this example does:
// - Creates one claimable pool cell.
// - Uses AlwaysSuccess as a mock UDT-like type, so no real UDT type is needed.
// - Makes the current Playground signer both the claimant and the recycler.
//
// After the transaction is sent, copy the logged poolCellOutPoint into claim.ts
// or recycle.ts.

// -----------------------------------------------------------------------------
// Configuration - edit this section
// -----------------------------------------------------------------------------
// Fill these before running:
// - claimablePoolLockTypeId: the deployed Type ID args. You can copy it from
//   deployments.json -> current.testnet.claimablePoolLock.typeScript.args.
// - amount: the mock amount that the signer can later claim.
const claimablePoolLockTypeId =
  "0x6953e9905a3c922da6974aafdbaf3b22965982894c558a0a125e8dc796a5b8a2";

// If you want to use your own script cell outPoint directly, replace the Type
// ID lookup below with getCellLive(claimablePoolLockOutPoint).
// const claimablePoolLockOutPoint = {
//   txHash: "0x",
//   index: 0,
// };

const amount = 100n;

// -----------------------------------------------------------------------------
// Setup - no changes needed
// -----------------------------------------------------------------------------
const signerLock = (await signer.getRecommendedAddressObj()).script;
const signerLockHash = signerLock.hash();

// Use AlwaysSuccess as a mock UDT-like type. The pool lock only assumes the
// first 16 bytes of the cell data are the amount.
const mockType = await ccc.Script.fromKnownScript(
  signer.client,
  ccc.KnownScript.AlwaysSuccess,
  "0x",
);

// Find the deployed script cell by Type ID. To use the outPoint above instead,
// replace this Type ID lookup with:
// const claimablePoolLockCell = await signer.client.getCellLive(
//   claimablePoolLockOutPoint,
//   false,
//   true,
// );
//
// The cell's type hash is the lock code hash used by claimable-pool-lock cells.
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
const poolLock = ccc.Script.from({
  codeHash: claimablePoolLockCell.cellOutput.type.hash(),
  hashType: "type",
  args: signerLockHash,
});

// -----------------------------------------------------------------------------
// Pool data - no changes needed
// -----------------------------------------------------------------------------
const ClaimablePoolEntry = mol.struct({
  claimant_lock_hash: mol.Byte32,
  amount: mol.Uint128,
});
const ClaimablePoolEntryVec = mol.vector(ClaimablePoolEntry);

// Pool data is: first 16 bytes total amount, then a Molecule vector of entries.
const poolData = ccc.hexFrom([
  ...ccc.numToBytes(amount, 16),
  ...ccc.bytesFrom(
    ClaimablePoolEntryVec.encode([
      {
        claimant_lock_hash: signerLockHash,
        amount,
      },
    ]),
  ),
]);

// -----------------------------------------------------------------------------
// Transaction - no changes needed
// -----------------------------------------------------------------------------
// Describe what we want: one pool output locked by claimable-pool-lock.
const tx = ccc.Transaction.from({});
tx.addCellDeps({ outPoint: claimablePoolLockOutPoint, depType: "code" });
await tx.addCellDepsOfKnownScripts(
  signer.client,
  ccc.KnownScript.AlwaysSuccess,
);
tx.addOutput(
  {
    lock: poolLock,
    type: mockType,
  },
  poolData,
);

// -----------------------------------------------------------------------------
// Render, send, and inspect - no changes needed
// -----------------------------------------------------------------------------
console.log("Create Pool Cell");
console.log(`Pool lock hash: ${poolLock.hash()}`);
console.log(`Pool lock args / recycler: ${signerLockHash}`);
console.log(`Claimant lock hash: ${signerLockHash}`);
console.log(`Claimable amount: ${amount.toString()}`);
console.log(`UDT type hash: ${mockType.hash()}`);
console.log("Pool entries");
console.log(`1. Claimant: ${signerLockHash} | Amount: ${amount.toString()}`);
await render(tx);

// Complete missing parts: Fill normal CKB inputs for capacity.
console.log("Completing CKB inputs...");
await tx.completeInputsByCapacity(signer);
await render(tx);

// Complete missing parts: Pay fee.
console.log("Completing transaction fee...");
await tx.completeFeeBy(signer);
await render(tx);

// Send the transaction and print the pool outPoint for the next examples.
console.log("Sending transaction...");
const txHash = await signer.sendTransaction(tx);
const poolCellOutPoint = { txHash, index: 0 };
console.log("Create Complete");
console.log(`Transaction: ${txHash}`);
console.log(
  `Pool cell OutPoint for claim.ts or recycle.ts: ${poolCellOutPoint.txHash}:${poolCellOutPoint.index}`,
);
console.log("Created pool entries");
console.log(`1. Claimant: ${signerLockHash} | Amount: ${amount.toString()}`);
console.log(`Query claimablePoolLock.args: ${signerLockHash}`);
console.log(`Query claimantLockHash: ${signerLockHash}`);
