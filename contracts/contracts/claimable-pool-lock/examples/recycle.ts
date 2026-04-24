import { ccc } from "@ckb-ccc/core";
import { render, signer } from "@ckb-ccc/playground";

// What this example does:
// - Recycles a pool cell to the current Playground signer.
// - Requires the signer lock hash to match the recycler lock hash stored in
//    the pool lock args.
//
// If you want to recycle after a full claim, use the updated poolCellOutPoint
// logged by claim.ts.

// -----------------------------------------------------------------------------
// Configuration - edit this section
// -----------------------------------------------------------------------------
// Fill these before running:
// - claimablePoolLockTypeId: the deployed Type ID args. You can copy it from
//   deployments.json -> current.testnet.claimablePoolLock.typeScript.args.
// - poolCellOutPoint: the pool cell to recycle.
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
const poolCell = await signer.client.getCellLive(poolCellOutPoint, true, true);
if (!poolCell) {
  throw new Error("Pool cell not found or already spent");
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

const recyclerLockHashBytes = ccc.bytesFrom(poolCell.cellOutput.lock.args);
if (recyclerLockHashBytes.length !== 32) {
  throw new Error(
    `Expected recycler lock hash to be 32 bytes, got ${recyclerLockHashBytes.length}`,
  );
}
const recyclerLockHash = ccc.hexFrom(recyclerLockHashBytes);
if (recyclerLockHash.toLowerCase() !== signerLockHash.toLowerCase()) {
  throw new Error("Signer is not the recycler for this pool");
}

// -----------------------------------------------------------------------------
// Pool data - no changes needed
// -----------------------------------------------------------------------------
// Recycling keeps the original cell data unchanged; only the lock changes.
const recycledData = poolCell.outputData;
const recycledDataBytes = ccc.bytesFrom(recycledData);
const recycledCapacityShannons = poolCell.cellOutput.capacity.toString();
const recycledCapacityCkb = ccc.fixedPointToString(poolCell.cellOutput.capacity);
const recycledUdtAmount =
  recycledDataBytes.length >= 16
    ? ccc.numFromBytes(recycledDataBytes.slice(0, 16)).toString()
    : "unknown";
const recycledType = poolCell.cellOutput.type
  ? {
      codeHash: poolCell.cellOutput.type.codeHash,
      hashType: poolCell.cellOutput.type.hashType,
      args: poolCell.cellOutput.type.args,
      typeHash: poolCell.cellOutput.type.hash(),
    }
  : null;

// -----------------------------------------------------------------------------
// Transaction - no changes needed
// -----------------------------------------------------------------------------
// Describe what we want: consume the pool and move its capacity/data/type to a
// normal signer lock. There is intentionally no claimable-pool-lock output.
const tx = ccc.Transaction.from({});
tx.addCellDeps({ outPoint: claimablePoolLockOutPoint, depType: "code" });
if (poolCell.cellOutput.type) {
  await tx.addCellDepsOfKnownScripts(
    signer.client,
    ccc.KnownScript.AlwaysSuccess,
  );
}
tx.addInput(poolCell);
tx.addOutput(
  {
    capacity: poolCell.cellOutput.capacity,
    lock: signerLock,
    type: poolCell.cellOutput.type,
  },
  recycledData,
);

// -----------------------------------------------------------------------------
// Render, send, and inspect - no changes needed
// -----------------------------------------------------------------------------
console.log("Recycle Pool Cell");
console.log(`Pool cell: ${poolCellOutPoint.txHash}:${poolCellOutPoint.index}`);
console.log(`Recycler lock hash: ${recyclerLockHash}`);
console.log(
  `Capacity to recycle: ${recycledCapacityCkb} CKB (${recycledCapacityShannons} shannons)`,
);
console.log(`UDT amount to recycle: ${recycledUdtAmount}`);
console.log(`UDT type hash: ${recycledType?.typeHash ?? "none"}`);
await render(tx);

// Complete missing parts: add one signer-controlled input. The lock checks this
// input to verify the recycler authority.
console.log("Adding one signer input so the lock can verify the recycler...");
await tx.completeInputsAddOne(signer);
await render(tx);

// Complete missing parts: Pay fee.
console.log("Completing transaction fee...");
await tx.completeFeeBy(signer);
await render(tx);

// Send the transaction and print where the recycled cell lands.
console.log("Sending transaction...");
const txHash = await signer.sendTransaction(tx);
console.log("Recycle Complete");
console.log(`Transaction: ${txHash}`);
console.log(`Recycled output: ${txHash}:0`);
console.log(
  `Capacity recycled: ${recycledCapacityCkb} CKB (${recycledCapacityShannons} shannons)`,
);
console.log(`UDT amount recycled: ${recycledUdtAmount}`);
if (recycledType) {
  console.log(`UDT type hash: ${recycledType.typeHash}`);
  console.log(
    `UDT type script: ${recycledType.codeHash} / ${recycledType.hashType} / ${recycledType.args}`,
  );
} else {
  console.log("UDT type: none");
}
console.log(`Recycler lock hash: ${recyclerLockHash}`);
