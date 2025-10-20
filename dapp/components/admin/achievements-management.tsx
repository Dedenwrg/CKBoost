"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ccc } from "@ckb-ccc/connector-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import {
  CheckCircle2,
  Loader2,
  RefreshCcw,
  Rocket,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import { useProtocol } from "@/lib/providers/protocol-provider";
import { fetchAchievementCell } from "@/lib/ckb/achievement-cells";
import { deploymentManager } from "@/lib/ckb/deployment-manager";
import { AchievementsConfig } from "@/components/admin/protocol";
import type { ProtocolDataLike } from "ssri-ckboost/types";

type AchievementCellStatus =
  | {
      found: true;
      txHash: string;
      index: number;
      capacity: string;
      typeHash: string;
    }
  | { found: false };

const normalizeHashes = (hashes: string[]): string[] =>
  hashes.map((hash) => hash.toLowerCase()).sort();

export function AchievementsManagement(): React.JSX.Element {
  const { client } = ccc.useCcc();
  const {
    protocolData,
    updateProtocol,
    refreshProtocolData,
    isWalletConnected,
  } = useProtocol();
  const { toast } = useToast();

  const network = deploymentManager.getCurrentNetwork();
  const achievementTypeCodeHash = deploymentManager.getContractCodeHash(
    network,
    "ckboostAchievementsType"
  );

  const [status, setStatus] = useState<AchievementCellStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const baselineTypeHashes = useMemo(() => {
    const hashes = protocolData?.protocol_config?.achievement_type_hashes || [];
    return hashes.map((hash) => ccc.hexFrom(hash as ccc.HexLike));
  }, [protocolData]);

  const [typeHashes, setTypeHashes] = useState<string[]>(baselineTypeHashes);
  const [applyLoading, setApplyLoading] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  useEffect(() => {
    setTypeHashes(baselineTypeHashes);
  }, [baselineTypeHashes]);

  const hasTypeHashChanges = useMemo(() => {
    return (
      JSON.stringify(normalizeHashes(typeHashes)) !==
      JSON.stringify(normalizeHashes(baselineTypeHashes))
    );
  }, [typeHashes, baselineTypeHashes]);

  const loadStatus = useCallback(async () => {
    if (!client || !achievementTypeCodeHash) {
      setStatus(null);
      setStatusError(
        "Missing client or achievements type code hash. Ensure deployments.json is configured."
      );
      return;
    }

    setStatusLoading(true);
    setStatusError(null);
    try {
      const cell = await fetchAchievementCell(client, achievementTypeCodeHash);
      if (!cell) {
        setStatus({ found: false });
      } else {
        const txHash = cell.outPoint?.txHash
          ? ccc.hexFrom(cell.outPoint.txHash)
          : "unknown";
        const index = Number(cell.outPoint?.index || 0);
        const capacity = cell.cellOutput.capacity
          ? ccc.numFrom(cell.cellOutput.capacity as ccc.NumLike).toString()
          : "0";
        const typeHash = cell.cellOutput.type
          ? cell.cellOutput.type.hash()
          : "0x";
        setStatus({
          found: true,
          txHash,
          index,
          capacity,
          typeHash,
        });
      }
    } catch (error) {
      console.error("[AchievementsManagement] Failed to load status", error);
      const message =
        error instanceof Error ? error.message : "Unknown error occurred.";
      setStatusError(message);
    } finally {
      setStatusLoading(false);
    }
  }, [client, achievementTypeCodeHash]);

  useEffect(() => {
    loadStatus().catch((error) =>
      console.error("[AchievementsManagement] initial load failed", error)
    );
  }, [loadStatus]);

  const handleApplyTypeHashes = useCallback(async () => {
    if (!protocolData) {
      toast({
        title: "Protocol data unavailable",
        description:
          "Load protocol configuration before updating achievements type hashes.",
        variant: "destructive",
      });
      return;
    }

    if (!isWalletConnected) {
      toast({
        title: "Wallet required",
        description:
          "Connect a wallet with admin privileges to update protocol data.",
        variant: "destructive",
      });
      return;
    }

    setApplyLoading(true);
    try {
      const updatedData = {
        ...protocolData,
        last_updated: BigInt(Date.now()),
      } as unknown as ProtocolDataLike;

      updatedData.protocol_config.achievement_type_hashes = typeHashes.map(
        (hash) => ccc.hexFrom(hash) as ccc.Hex
      );

      const txHash = await updateProtocol(updatedData);
      toast({
        title: "Protocol updated",
        description: `Transaction: ${txHash}`,
      });
      await refreshProtocolData();
    } catch (error) {
      console.error("[AchievementsManagement] Failed to apply changes", error);
      toast({
        title: "Failed to update protocol",
        description:
          error instanceof Error ? error.message : "Unknown error occurred.",
        variant: "destructive",
      });
    } finally {
      setApplyLoading(false);
    }
  }, [
    protocolData,
    typeHashes,
    updateProtocol,
    refreshProtocolData,
    toast,
    isWalletConnected,
  ]);

  const deploymentUnavailable = !achievementTypeCodeHash;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Achievements Cell Status</CardTitle>
            <CardDescription>
              Check whether the achievements cell is deployed on the current
              network.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadStatus()}
            disabled={statusLoading}
          >
            {statusLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Refreshing
              </>
            ) : (
              <>
                <RefreshCcw className="mr-2 h-4 w-4" />
                Refresh
              </>
            )}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {statusError && (
            <Alert variant="destructive">
              <AlertTitle>Unable to load achievements cell</AlertTitle>
              <AlertDescription>{statusError}</AlertDescription>
            </Alert>
          )}

          {deploymentUnavailable && (
            <Alert>
              <AlertTitle>Deployment configuration missing</AlertTitle>
              <AlertDescription>
                The achievements contract is not registered in
                <code className="mx-1 rounded bg-muted px-1 py-0.5">
                  deployments.json
                </code>
                for the active network. Deploy the achievements type script and
                update the deployment records before creating the cell.
              </AlertDescription>
            </Alert>
          )}

          {!deploymentUnavailable && !statusError && status?.found === true && (
            <div className="rounded-lg border border-green-400/60 bg-green-50/80 p-4 text-sm dark:border-green-800/70 dark:bg-green-900/20">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-green-500 text-white">
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                  Active
                </Badge>
                <span className="font-medium">
                  Achievements cell detected on-chain.
                </span>
              </div>
              <dl className="mt-3 grid gap-2 md:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">
                    Transaction Hash
                  </dt>
                  <dd className="text-xs font-mono break-all">
                    {status.txHash}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">
                    Output Index
                  </dt>
                  <dd className="text-xs font-mono break-all">
                    {status.index}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">
                    Capacity (shannons)
                  </dt>
                  <dd className="text-xs font-mono break-all">
                    {status.capacity}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">
                    Type Hash
                  </dt>
                  <dd className="text-xs font-mono break-all">
                    {status.typeHash}
                  </dd>
                </div>
              </dl>
            </div>
          )}

          {!deploymentUnavailable &&
            !statusError &&
            status?.found === false && (
              <Alert>
                <AlertTitle>Achievements cell not found</AlertTitle>
                <AlertDescription>
                  Deploy the achievements cell to enable on-chain achievement
                  definitions. Use the deployment wizard below to review the
                  required steps.
                </AlertDescription>
              </Alert>
            )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-blue-500" />
            Deploy Achievements Cell
          </CardTitle>
          <CardDescription>
            Prepare and broadcast the initial achievements cell defining
            available milestones for your protocol.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            The achievements cell stores all milestone definitions (metadata,
            grant records, and receivers). Deploy the cell once after the
            achievements contract is registered, then update it through
            transactions that append new achievements or grant records.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              onClick={() => setIsDialogOpen(true)}
              disabled={deploymentUnavailable}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Deployment Wizard
            </Button>
            <Button type="button" variant="outline" asChild>
              <a
                href="https://github.com/ckboost/ckboost-docs"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Documentation
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Registered Achievement Cells</CardTitle>
            <CardDescription>
              Link the achievements cell type hash to your protocol
              configuration so downstream services can validate grants.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant={hasTypeHashChanges ? "default" : "outline"}
            disabled={!hasTypeHashChanges || applyLoading}
            onClick={handleApplyTypeHashes}
          >
            {applyLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Updating…
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Apply to Protocol
              </>
            )}
          </Button>
        </CardHeader>
        <CardContent>
          <AchievementsConfig
            typeHashes={typeHashes}
            onChange={setTypeHashes}
            pendingChanges={hasTypeHashChanges}
            disabled={!isWalletConnected}
          />
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Deploy Achievements Cell</DialogTitle>
            <DialogDescription>
              Use the checklist below to prepare and broadcast the achievements
              cell on the current network.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            {deploymentUnavailable ? (
              <Alert variant="destructive">
                <AlertTitle>Achievements contract not registered</AlertTitle>
                <AlertDescription>
                  Update{" "}
                  <code className="mx-1 rounded bg-muted px-1 py-0.5">
                    deployments.json
                  </code>{" "}
                  with the achievements contract deployment before creating the
                  achievements cell.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <ol className="list-decimal list-inside space-y-2">
                  <li>
                    <strong>Verify prerequisites:</strong> ensure your wallet
                    has sufficient CKB, the achievements contract is deployed,
                    and the wallet is connected to the dashboard.
                  </li>
                  <li>
                    <strong>Craft the deployment transaction:</strong> build a
                    transaction that creates a new cell with the achievements
                    type script and an empty <code>AchievementDataVec</code> in
                    the data field.
                  </li>
                  <li>
                    <strong>Broadcast the transaction:</strong> sign and submit
                    the transaction via your preferred wallet or CLI.
                  </li>
                  <li>
                    <strong>Register the cell:</strong> add the resulting type
                    hash to the protocol configuration using the editor above.
                  </li>
                </ol>
                <div className="rounded-lg border bg-muted/40 p-3">
                  <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                    Achievements Type Script
                  </h4>
                  <Textarea
                    readOnly
                    className="min-h-[120px] font-mono text-xs"
                    value={JSON.stringify(achievementTypeCodeHash, null, 2)}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    Use these parameters as the type script when constructing
                    the achievements cell output.
                  </p>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setIsDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
