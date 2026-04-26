"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ccc } from "@ckb-ccc/connector-react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  ExternalLink,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import {
  addClaimablePoolAssetCellDep,
  queryAllClaimablePoolCells,
  recycleClaimablePoolCells,
  type ClaimablePoolAdminCell,
} from "@/lib/ckb/claimable-pool";
import { cn } from "@/lib/utils";

export function ClaimablePoolsTab() {
  const signer = ccc.useSigner();
  const { client } = ccc.useCcc();
  const { toast } = useToast();
  const [pools, setPools] = useState<ClaimablePoolAdminCell[]>([]);
  const [recyclerLockHash, setRecyclerLockHash] = useState<ccc.Hex | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isRecyclingAll, setIsRecyclingAll] = useState(false);
  const [forceTarget, setForceTarget] =
    useState<ClaimablePoolAdminCell | null>(null);
  const [forceRecyclingKey, setForceRecyclingKey] = useState<string | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const loadPools = useCallback(async () => {
    if (!client) {
      setPools([]);
      setRecyclerLockHash(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      if (!signer) {
        setPools([]);
        setRecyclerLockHash(null);
        return;
      }

      const address = await signer.getRecommendedAddressObj();
      const currentLockHash = ccc.hexFrom(address.script.hash()) as ccc.Hex;
      const nextPools = await queryAllClaimablePoolCells({
        client,
        recyclerLockHash: currentLockHash,
      });

      setPools(nextPools);
      setRecyclerLockHash(currentLockHash.toLowerCase() as ccc.Hex);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load claimable pools"
      );
    } finally {
      setIsLoading(false);
    }
  }, [client, signer]);

  useEffect(() => {
    void loadPools();
  }, [loadPools]);

  const completedAuthorizedPools = useMemo(
    () => pools.filter((pool) => pool.isFullyClaimed),
    [pools]
  );
  const pendingPools =
    pools.length - pools.filter((pool) => pool.isFullyClaimed).length;

  const recyclePools = useCallback(
    async (targetPools: ClaimablePoolAdminCell[], label: string) => {
      if (!signer) {
        throw new Error("Connect a wallet before recycling pools.");
      }
      const txHash = await recycleClaimablePoolCells({
        signer,
        cells: targetPools.map((pool) => pool.cell),
        label,
        addAssetCellDeps: async (tx, typeScript) => {
          await addClaimablePoolAssetCellDep(signer.client, tx, typeScript);
        },
      });
      toast({
        title: "Recycle submitted",
        description: `${targetPools.length} pool${
          targetPools.length === 1 ? "" : "s"
        } recycled in ${formatHash(txHash)}. ${formatRecycleSummary(
          targetPools
        )}`,
      });
      await loadPools();
    },
    [loadPools, signer, toast]
  );

  const handleRecycleCompleted = async () => {
    if (completedAuthorizedPools.length === 0) {
      return;
    }

    setIsRecyclingAll(true);
    setError(null);
    try {
      await recyclePools(
        completedAuthorizedPools,
        "Recycle Completed Claimable Pools"
      );
    } catch (recycleError) {
      setError(
        recycleError instanceof Error
          ? recycleError.message
          : "Failed to recycle completed pools"
      );
    } finally {
      setIsRecyclingAll(false);
    }
  };

  const handleForceRecycle = async () => {
    if (!forceTarget) {
      return;
    }

    setForceRecyclingKey(forceTarget.outPointKey);
    setError(null);
    try {
      await recyclePools([forceTarget], "Force Recycle Claimable Pool");
      setForceTarget(null);
    } catch (recycleError) {
      setError(
        recycleError instanceof Error
          ? recycleError.message
          : "Failed to force recycle pool"
      );
    } finally {
      setForceRecyclingKey(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Claimable Pools</h2>
          <p className="text-muted-foreground">
            Manage claimable-pool-lock cells recyclable by the current wallet
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadPools}>
            <RefreshCw
              className={cn("w-4 h-4 mr-2", isLoading && "animate-spin")}
            />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={handleRecycleCompleted}
            disabled={
              !signer || completedAuthorizedPools.length === 0 || isRecyclingAll
            }
          >
            <RotateCcw
              className={cn("w-4 h-4 mr-2", isRecyclingAll && "animate-spin")}
            />
            Recycle Completed
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <PoolStatCard label="Total Pools" value={pools.length.toString()} />
        <PoolStatCard
          label="Completed"
          value={pools.filter((pool) => pool.isFullyClaimed).length.toString()}
        />
        <PoolStatCard label="Open" value={pendingPools.toString()} />
        <PoolStatCard
          label="Recycler"
          value={recyclerLockHash ? formatHash(recyclerLockHash) : "Connect"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5" />
            Live Pool Cells
          </CardTitle>
          <CardDescription>
            This table only shows pools whose recycler lock hash is the current
            wallet. Completed pools have no remaining entries.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
              Loading pools...
            </div>
          ) : !signer ? (
            <div className="text-center py-12 text-muted-foreground">
              <Database className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>Connect a wallet to load recyclable pools</p>
            </div>
          ) : pools.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Database className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No recyclable claimable pool cells found for this wallet</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pool</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Asset</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Remaining</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pools.map((pool) => {
                  const isBusy = forceRecyclingKey === pool.outPointKey;

                  return (
                    <TableRow key={pool.outPointKey}>
                      <TableCell className="font-mono text-xs">
                        <a
                          className="inline-flex items-center gap-1 hover:underline"
                          href={getExplorerTransactionUrl(pool.cell.outPoint.txHash)}
                          rel="noreferrer"
                          target="_blank"
                          title={pool.outPointKey}
                        >
                          {formatOutPoint(pool.outPointKey)}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="text-sm">
                            {formatCreatedAt(pool.createdAt)}
                          </div>
                          {pool.blockNumber !== null && (
                            <div className="text-xs text-muted-foreground">
                              Block #{pool.blockNumber.toString()}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="font-medium">
                            {pool.assetKind === "ckb" ? "CKB" : "UDT"}
                          </div>
                          {pool.typeHash && (
                            <div className="text-xs text-muted-foreground font-mono">
                              {formatHash(pool.typeHash)}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {pool.isFullyClaimed ? (
                          <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Completed
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            {pool.entryCount}{" "}
                            {pool.entryCount === 1 ? "entry" : "entries"}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {pool.remainingAmount.toString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={isBusy || isRecyclingAll}
                          onClick={() => setForceTarget(pool)}
                        >
                          <Trash2
                            className={cn(
                              "w-4 h-4 mr-2",
                              isBusy && "animate-pulse"
                            )}
                          />
                          Force Recycle
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={!!forceTarget}
        onOpenChange={(open) => {
          if (!open) setForceTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Force recycle this pool?</AlertDialogTitle>
            <AlertDialogDescription>
              This will consume the selected claimable pool cell. If entries
              remain, those unclaimed assets will no longer be claimable from
              this pool.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {forceTarget && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
              <div>
                Pool:{" "}
                <span className="font-mono">
                  {formatOutPoint(forceTarget.outPointKey)}
                </span>
              </div>
              <div>Remaining entries: {forceTarget.entryCount}</div>
              <div>Remaining amount: {forceTarget.remainingAmount.toString()}</div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!forceRecyclingKey}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!!forceRecyclingKey}
              onClick={(event) => {
                event.preventDefault();
                void handleForceRecycle();
              }}
            >
              Force Recycle
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PoolStatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

function formatRecycleSummary(pools: ClaimablePoolAdminCell[]): string {
  const capacity = pools.reduce(
    (total, pool) => total + ccc.numFrom(pool.cell.cellOutput.capacity),
    0n
  );
  const udtAmounts = new Map<string, bigint>();
  for (const pool of pools) {
    if (!pool.typeHash) {
      continue;
    }
    udtAmounts.set(
      pool.typeHash,
      (udtAmounts.get(pool.typeHash) ?? 0n) + pool.remainingAmount
    );
  }

  const capacityText = `Capacity: ${ccc.fixedPointToString(capacity)} CKB.`;
  if (udtAmounts.size === 0) {
    return capacityText;
  }

  const udtText = Array.from(udtAmounts.entries())
    .slice(0, 2)
    .map(
      ([typeHash, amount]) => `${amount.toString()} @ ${formatHash(typeHash)}`
    )
    .join(", ");
  const suffix = udtAmounts.size > 2 ? `, +${udtAmounts.size - 2} more` : "";
  return `${capacityText} UDT: ${udtText}${suffix}.`;
}

function formatHash(hash: string): string {
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

function formatOutPoint(key: string): string {
  const [txHash, index] = key.split(":");
  return `${txHash.slice(0, 10)}...${txHash.slice(-6)}:${index}`;
}

function formatCreatedAt(createdAt: number | null): string {
  if (createdAt === null) {
    return "Unknown";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(createdAt));
}

function getExplorerTransactionUrl(txHash: string): string {
  const network = process.env.NEXT_PUBLIC_CKB_NETWORK || "testnet";
  const base =
    network === "mainnet"
      ? "https://explorer.nervos.org/transaction/"
      : "https://pudge.explorer.nervos.org/transaction/";
  return `${base}${txHash}`;
}
