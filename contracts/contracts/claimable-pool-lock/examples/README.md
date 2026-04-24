# claimable-pool-lock Examples

These are small CCC Playground examples. Each file is meant to be readable on
its own: the imports, required fields, render or print steps, send step when
needed, and result logs are all inside the example file.

Open them through raw-source URLs:

```text
https://live.ckbccc.com/?src=https://raw.githubusercontent.com/<owner>/<repo>/<branch>/contracts/contracts/claimable-pool-lock/examples/create.ts
https://live.ckbccc.com/?src=https://raw.githubusercontent.com/<owner>/<repo>/<branch>/contracts/contracts/claimable-pool-lock/examples/query.ts
https://live.ckbccc.com/?src=https://raw.githubusercontent.com/<owner>/<repo>/<branch>/contracts/contracts/claimable-pool-lock/examples/claim.ts
https://live.ckbccc.com/?src=https://raw.githubusercontent.com/<owner>/<repo>/<branch>/contracts/contracts/claimable-pool-lock/examples/recycle.ts
```

Use them in this order:

1. `create.ts`
   - Fill `claimablePoolLockTypeId` from `deployments.json`.
   - Optionally change `amount`.
   - Run it in CCC Playground.
   - Copy the logged `poolCellOutPoint`.
2. `query.ts`
   - Fill `claimablePoolLock` with the full pool lock script.
   - Fill `claimantLockHash` with the claimant's lock hash.
   - Run it to see claimable UDT amounts grouped by Type.
   - Use the printed `poolCells` outPoints with `claim.ts`.
3. `claim.ts`
   - Fill `claimablePoolLockTypeId` from the same deployment.
   - Paste the `poolCellOutPoint` from `create.ts`.
   - Run it with the same signer.
   - Copy the logged updated `poolCellOutPoint` if you want to recycle after a full claim.
4. `recycle.ts`
   - Fill `claimablePoolLockTypeId` from the same deployment.
   - Paste the pool cell you want to recycle.
   - Run it with the recycler signer.

Each example looks up the deployed script cell by Type ID. If you prefer to use
a specific script cell outPoint directly, each example keeps the old outPoint
configuration as commented code.

`create.ts` uses `KnownScript.AlwaysSuccess` as a mock UDT-like type, so the
examples do not require a real UDT type script.

`claim.ts` intentionally keeps a pool output even when all entries are removed.
That keeps the lock transition in claim mode; recycling the empty pool is a
separate transaction.
