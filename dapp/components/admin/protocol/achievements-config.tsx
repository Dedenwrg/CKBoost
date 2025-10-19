"use client";

import React, { useMemo, useState } from "react";
import { ccc } from "@ckb-ccc/connector-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { deploymentManager } from "@/lib/ckb/deployment-manager";
import type { Network } from "@/lib/ckb/deployment-manager";
import {
  CheckCircle2,
  Info,
  Plus,
  Trash2,
  UploadCloud,
  Wrench,
} from "lucide-react";

interface AchievementsConfigProps {
  typeHashes: string[];
  onChange: (next: string[]) => void;
  pendingChanges: boolean;
  ChangeIndicator?: React.FC<{ hasChanged: boolean }>;
  disabled?: boolean;
}

const normalizeHash = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("0x")) {
    return `0x${trimmed}`;
  }
  return trimmed;
};

const isValidHash = (value: string): boolean =>
  /^0x[a-fA-F0-9]{64}$/u.test(value.trim());

export function AchievementsConfig({
  typeHashes,
  onChange,
  pendingChanges,
  ChangeIndicator,
  disabled = false,
}: AchievementsConfigProps) {
  const [newHash, setNewHash] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);

  const network = deploymentManager.getCurrentNetwork();

  const deployment = useMemo(() => {
    try {
      return deploymentManager.getCurrentDeployment(
        network,
        "ckboostAchievementsType"
      );
    } catch (error) {
      console.warn("Failed to read achievements deployment", error);
      return null;
    }
  }, [network]);

  const handleAdd = () => {
    const normalized = normalizeHash(newHash);
    if (!isValidHash(normalized)) {
      setInputError(
        "Provide a 32-byte hex type hash (0x...) for the achievement cell."
      );
      return;
    }
    if (typeHashes.includes(normalized)) {
      setInputError("This hash is already listed.");
      return;
    }
    setInputError(null);
    onChange([...typeHashes, normalized]);
    setNewHash("");
  };

  const handleRemove = (hash: string) => {
    onChange(typeHashes.filter((value) => value !== hash));
  };

  return (
    <Card className={pendingChanges ? "border-orange-500" : ""}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Achievement Cells
          {ChangeIndicator && <ChangeIndicator hasChanged={pendingChanges} />}
        </CardTitle>
        <CardDescription>
          Reference deployed achievement cells so the protocol can validate and
          award milestones.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2 rounded-lg border border-border/60 bg-muted/40 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Info className="h-4 w-4" />
            Deployment status
          </div>
          {deployment ? (
            <div className="text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                Achievements contract registered for {network}.
              </div>
              <div className="mt-2 text-xs font-mono break-words">
                Code hash: {deployment.typeHash || "n/a"}
              </div>
              {deployment.typeScript && (
                <div className="mt-2 text-xs font-mono break-words">
                  Args: {ccc.hexFrom(deployment.typeScript.args) || "0x"}
                </div>
              )}
            </div>
          ) : (
            <Alert variant="default" className="border border-dashed">
              <UploadCloud className="h-4 w-4" />
              <AlertTitle className="text-sm font-medium">
                No deployment record found
              </AlertTitle>
              <AlertDescription className="text-xs">
                Deploy the achievements contract and update{" "}
                <code>deployments.json</code>
                or add the cell manually once deployed.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Wrench className="h-4 w-4" />
            Registered Achievement Cells
          </div>
          <p className="text-sm text-muted-foreground">
            Provide the type script hash for each published achievement cell.
            The validation service uses these references to locate and update
            achievement data on-chain.
          </p>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={newHash}
              onChange={(event) => setNewHash(event.target.value)}
              placeholder="0x..."
              className="font-mono text-xs"
              disabled={disabled}
            />
            <Button type="button" onClick={handleAdd} disabled={disabled}>
              <Plus className="mr-2 h-4 w-4" /> Add Cell
            </Button>
          </div>
          {inputError && <p className="text-xs text-red-500">{inputError}</p>}

          {typeHashes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No achievement cells configured yet. Add at least one type hash to
              enable achievements.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {typeHashes.map((hash) => (
                <div
                  key={hash}
                  className="flex items-center justify-between rounded-lg border border-border/60 bg-background p-3"
                >
                  <div className="font-mono text-xs break-all">{hash}</div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemove(hash)}
                    disabled={disabled}
                    aria-label={`Remove ${hash}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {typeHashes.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {typeHashes.map((hash) => (
                <Badge
                  key={`badge-${hash}`}
                  variant="outline"
                  className="font-mono text-xs"
                >
                  {hash.slice(0, 10)}…{hash.slice(-6)}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
