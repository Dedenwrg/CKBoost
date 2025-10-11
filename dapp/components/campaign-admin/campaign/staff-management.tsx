"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, Loader2, Lock, Trash2, UserPlus } from "lucide-react";
import { ccc } from "@ckb-ccc/connector-react";

type InputMode = "address" | "lock";

interface StaffManagementProps {
  staffLockHashes: string[];
  onChange: (hashes: string[]) => void;
  signer: ccc.Signer | null;
  disabled?: boolean;
}

interface AddStaffState {
  mode: InputMode;
  address: string;
  lockHash: string;
}

const isHexLockHash = (value: string): boolean => {
  if (!value) return false;
  const normalized = value.startsWith("0x") ? value.slice(2) : value;
  return normalized.length === 64 && /^[0-9a-fA-F]+$/.test(normalized);
};

export function StaffManagement({
  staffLockHashes,
  onChange,
  signer,
  disabled = false,
}: StaffManagementProps) {
  const [state, setState] = useState<AddStaffState>({
    mode: "address",
    address: "",
    lockHash: "",
  });
  const [previewLockHash, setPreviewLockHash] = useState<string>("");
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      if (disabled) return;
      if (state.mode !== "address") {
        setPreviewLockHash("");
        return;
      }
      const trimmed = state.address.trim();
      if (!trimmed) {
        setPreviewLockHash("");
        setError(null);
        return;
      }
      if (!signer) {
        setError("Connect wallet to resolve CKB addresses.");
        setPreviewLockHash("");
        return;
      }

      setIsResolving(true);
      try {
        const address = await ccc.Address.fromString(trimmed, signer.client);
        if (!cancelled) {
          const hash = address.script.hash();
          setPreviewLockHash(hash);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setPreviewLockHash("");
          setError("Invalid CKB address.");
        }
      } finally {
        if (!cancelled) {
          setIsResolving(false);
        }
      }
    };

    resolve();
    return () => {
      cancelled = true;
    };
  }, [state.mode, state.address, signer, disabled]);

  const handleAddStaff = async () => {
    if (disabled) return;
    setError(null);
    try {
      let lockHash: string;

      if (state.mode === "address") {
        const trimmed = state.address.trim();
        if (!trimmed) {
          throw new Error("Enter a CKB address.");
        }
        if (!signer) {
          throw new Error("Connect wallet to resolve CKB addresses.");
        }
        const address = await ccc.Address.fromString(trimmed, signer.client);
        lockHash = address.script.hash();
      } else {
        const trimmed = state.lockHash.trim();
        if (!isHexLockHash(trimmed)) {
          throw new Error("Lock hash must be a 32-byte hex string.");
        }
        lockHash = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
      }

      if (staffLockHashes.some((hash) => hash.toLowerCase() === lockHash.toLowerCase())) {
        throw new Error("This staff lock hash is already listed.");
      }

      onChange([...staffLockHashes, lockHash as ccc.Hex]);
      setState((prev) => ({
        ...prev,
        address: "",
        lockHash: "",
      }));
      setPreviewLockHash("");
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleRemove = (hash: string) => {
    if (disabled) return;
    onChange(staffLockHashes.filter((h) => h !== hash));
  };

  const normalizedStaff = useMemo(
    () =>
      staffLockHashes.map((hash) => ({
        hash,
        short: `${hash.slice(0, 10)}...${hash.slice(-6)}`,
      })),
    [staffLockHashes]
  );

  return (
    <Card className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Lock className="w-4 h-4" />
            Campaign Staff Access
          </h3>
          <p className="text-sm text-muted-foreground">
            Staff members can help manage quests, submissions, and rewards.
            Provide either a CKB address or a lock hash to grant access.
          </p>
        </div>
        <Badge variant={disabled ? "outline" : "secondary"}>
          {disabled ? "Read Only" : `${staffLockHashes.length} Staff`}
        </Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[220px,1fr]">
        <div className="space-y-3">
          <Label>Input Method</Label>
          <Select
            disabled={disabled}
            value={state.mode}
            onValueChange={(value: InputMode) =>
              setState((prev) => ({
                ...prev,
                mode: value,
                address: "",
                lockHash: "",
              }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Select input method" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="address">CKB Address</SelectItem>
              <SelectItem value="lock">Lock Hash</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          {state.mode === "address" ? (
            <div className="space-y-2">
              <Label htmlFor="staff-address">Staff CKB Address</Label>
              <Input
                id="staff-address"
                value={state.address}
                onChange={(e) =>
                  setState((prev) => ({ ...prev, address: e.target.value }))
                }
                disabled={disabled}
                placeholder="ckt1..."
              />
              <div className="min-h-[20px] text-xs text-muted-foreground flex items-center gap-2">
                {isResolving ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Resolving lock hash...
                  </>
                ) : (
                  previewLockHash && (
                    <>
                      <Lock className="w-3 h-3" />
                      {previewLockHash}
                    </>
                  )
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="staff-lockhash">Staff Lock Hash</Label>
              <Input
                id="staff-lockhash"
                value={state.lockHash}
                onChange={(e) =>
                  setState((prev) => ({ ...prev, lockHash: e.target.value }))
                }
                disabled={disabled}
                placeholder="0x..."
              />
            </div>
          )}

          <Button
            type="button"
            onClick={handleAddStaff}
            disabled={disabled}
            className="w-full"
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Add Staff Member
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <div>
        <h4 className="text-sm font-medium mb-2">Active Staff Members</h4>
        {normalizedStaff.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No staff members have been added yet.
          </p>
        ) : (
          <ScrollArea className="max-h-48 rounded-md border">
            <div className="divide-y">
              {normalizedStaff.map(({ hash, short }) => (
                <div
                  key={hash}
                  className="flex items-center justify-between gap-4 px-3 py-2 text-sm"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{short}</span>
                    <span className="text-xs text-muted-foreground">
                      {hash}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemove(hash)}
                    disabled={disabled}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </Card>
  );
}
