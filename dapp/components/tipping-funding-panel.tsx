"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CardWithIndents } from "@/components/ui/card-with-indents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PiggyBank, Coins, Wallet } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useTippingContext } from "@/lib/providers/tipping-provider";
import { udtRegistry } from "@/lib/services/udt-registry";
import { ccc } from "@ckb-ccc/connector-react";
import { useProtocol } from "@/lib/providers/protocol-provider";

const CKB_DECIMALS = 8;

const formatCKB = (value: bigint): string => {
  const divisor = 10n ** BigInt(CKB_DECIMALS);
  const integerPart = value / divisor;
  const fractionalPart = value % divisor;

  if (fractionalPart === 0n) {
    return integerPart.toString();
  }

  const fractionalStr = fractionalPart
    .toString()
    .padStart(CKB_DECIMALS, "0")
    .replace(/0+$/, "");

  return `${integerPart}.${fractionalStr}`;
};

const parseDecimalToUnits = (input: string, decimals: number): bigint => {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Amount is required");
  }

  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Amount must be a positive number");
  }

  const [integerDigits, fractionDigitsRaw = ""] = trimmed.split(".");
  if (fractionDigitsRaw.length > decimals) {
    throw new Error(
      `Too many decimal places (max ${decimals} decimal${
        decimals === 1 ? "" : "s"
      })`
    );
  }

  const fractionDigits = fractionDigitsRaw.padEnd(decimals, "0");
  const integerValue = BigInt(integerDigits);
  const fractionalValue =
    fractionDigits.length > 0 ? BigInt(fractionDigits) : 0n;
  const base = 10n ** BigInt(decimals);

  return integerValue * base + fractionalValue;
};

export function TippingFundingPanel() {
  const {
    fundingSummary,
    fundProtocolWithCKB,
    fundProtocolWithUDT,
    fundingShortage,
  } = useTippingContext();
  const signer = ccc.useSigner();
  const { toast } = useToast();
  const { isAdmin, isEndorser } = useProtocol();
  const canFund = isAdmin || isEndorser;

  const tokens = useMemo(() => udtRegistry.getAllTokens(), []);
  const [selectedTokenSymbol, setSelectedTokenSymbol] = useState<string>(
    tokens[0]?.symbol ?? ""
  );
  const [ckbAmount, setCkbAmount] = useState("");
  const [udtAmount, setUdtAmount] = useState("");
  const [isFundingCKB, setIsFundingCKB] = useState(false);
  const [isFundingUDT, setIsFundingUDT] = useState(false);

  const udtEntries = useMemo(() => {
    if (!fundingSummary) {
      return [];
    }
    return Array.from(fundingSummary.udtTotalsByType.entries());
  }, [fundingSummary]);

  const handleFundCKB = async () => {
    try {
      if (!signer) {
        throw new Error("Connect a wallet to fund the protocol pool.");
      }
      setIsFundingCKB(true);
      const shannons = parseDecimalToUnits(ckbAmount, CKB_DECIMALS);
      const txHash = await fundProtocolWithCKB(shannons);
      toast({
        title: "Funding submitted",
        description: `Transaction ${txHash.slice(0, 10)}…${txHash.slice(
          -6
        )} submitted.`,
      });
      setCkbAmount("");
    } catch (error) {
      toast({
        title: "Failed to fund",
        description:
          error instanceof Error ? error.message : "Unknown funding error.",
        variant: "destructive",
      });
    } finally {
      setIsFundingCKB(false);
    }
  };

  const handleFundUDT = async () => {
    try {
      if (!signer) {
        throw new Error("Connect a wallet to fund the protocol pool.");
      }
      const token = udtRegistry.getTokenBySymbol(selectedTokenSymbol);
      if (!token) {
        throw new Error("Select a token to fund.");
      }
      setIsFundingUDT(true);
      const amount = parseDecimalToUnits(udtAmount, token.decimals);
      const txHash = await fundProtocolWithUDT([
        {
          udt_script: token.script,
          amount,
        },
      ]);
      toast({
        title: `Funded ${token.symbol}`,
        description: `Transaction ${txHash.slice(0, 10)}…${txHash.slice(
          -6
        )} submitted.`,
      });
      setUdtAmount("");
    } catch (error) {
      toast({
        title: "Failed to fund",
        description:
          error instanceof Error ? error.message : "Unknown funding error.",
        variant: "destructive",
      });
    } finally {
      setIsFundingUDT(false);
    }
  };

  return (
    <CardWithIndents>
      <CardHeader className="flex flex-col gap-2 bg-[#1b1b1b] dark:bg-[#1b1b1b]">
        <div className="flex items-center gap-2">
          <PiggyBank className="w-5 h-5 text-purple-400" />
          <CardTitle className="text-white">Protocol Funding Pool</CardTitle>
        </div>
        <p className="text-sm text-gray-400">
          Deposit CKB or UDTs into the shared protocol pool powering community
          tippings.
        </p>
      </CardHeader>
      <CardContent className="space-y-6 bg-[#1b1b1b] dark:bg-[#1b1b1b]">
        {!fundingSummary ? (
          <Alert>
            <AlertDescription>
              Funding summary unavailable. Connect your wallet and refresh to
              view the latest totals.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="outline" className="text-base px-3 py-1">
                Total CKB Locked:{" "}
                <span className="font-semibold ml-1">
                  {formatCKB(fundingSummary.totalCapacity)} CKB
                </span>
              </Badge>
              {udtEntries.length > 0 ? (
                udtEntries.map(([typeHash, total]) => {
                  const token = udtRegistry.getTokenByScriptHash(typeHash);
                  const label = token
                    ? `${token.symbol}: ${udtRegistry.formatAmount(
                        total,
                        token
                      )}`
                    : `Unknown (${typeHash.slice(0, 10)}…)`;
                  return (
                    <Badge
                      key={typeHash}
                      variant="outline"
                      className="text-base px-3 py-1"
                    >
                      {label}
                    </Badge>
                  );
                })
              ) : (
                <Badge variant="secondary" className="text-base px-3 py-1">
                  No UDT deposits yet
                </Badge>
              )}
            </div>

            <Separator />

            {fundingShortage && (
              <Alert variant="destructive">
                <AlertDescription>
                  Insufficient funding to grant a pending tipping reward:
                  <ul className="mt-2 space-y-1 text-sm list-disc list-inside">
                    {fundingShortage.ckb && (
                      <li>
                        CKB required {formatCKB(fundingShortage.ckb.required)},
                        available {formatCKB(fundingShortage.ckb.available)}
                      </li>
                    )}
                    {fundingShortage.udts.map((item) => {
                      const token = udtRegistry.getTokenByScriptHash(
                        item.scriptHash
                      );
                      const label = token
                        ? `${token.symbol}: ${udtRegistry.formatAmount(
                            item.required,
                            token
                          )} required, ${udtRegistry.formatAmount(
                            item.available,
                            token
                          )} available`
                        : `${item.scriptHash.slice(0, 10)}… hash shortage`;
                      return <li key={item.scriptHash}>{label}</li>;
                    })}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {canFund ? (
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-white">
                    <Coins className="w-4 h-4 text-yellow-400" />
                    Fund with CKB
                  </div>
                  <Input
                    type="number"
                    step="0.0001"
                    min="0"
                    placeholder="Amount in CKB"
                    value={ckbAmount}
                    onChange={(event) => setCkbAmount(event.target.value)}
                    className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-400"
                  />
                  <Button
                    onClick={handleFundCKB}
                    disabled={!signer || isFundingCKB || !ckbAmount.trim()}
                    className="rounded-full text-white font-semibold shadow-lg border-0 hover:opacity-90 transition-opacity disabled:opacity-50"
                    style={{ backgroundColor: "#0000FF" }}
                  >
                    {isFundingCKB ? "Submitting…" : "Deposit CKB"}
                  </Button>
                </div>
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-white">
                    <Wallet className="w-4 h-4 text-green-400" />
                    Fund with UDT
                  </div>
                  <Select
                    value={selectedTokenSymbol}
                    onValueChange={setSelectedTokenSymbol}
                  >
                    <SelectTrigger className="bg-gray-800 border-gray-700 text-white">
                      <SelectValue placeholder="Select token" />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-800 border-gray-700">
                      {tokens.map((token) => (
                        <SelectItem key={token.symbol} value={token.symbol} className="text-white">
                          {token.symbol} • {token.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    step="0.0001"
                    min="0"
                    placeholder="Amount to deposit"
                    value={udtAmount}
                    onChange={(event) => setUdtAmount(event.target.value)}
                    className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-400"
                  />
                  <Button
                    onClick={handleFundUDT}
                    disabled={
                      !signer ||
                      !selectedTokenSymbol ||
                      !udtAmount.trim() ||
                      isFundingUDT
                    }
                    className="rounded-full text-white font-semibold shadow-lg border-0 hover:opacity-90 transition-opacity disabled:opacity-50"
                    style={{ backgroundColor: "#0000FF" }}
                  >
                    {isFundingUDT ? "Submitting…" : "Deposit UDT"}
                  </Button>
                </div>
              </div>
            ) : (
              <Alert>
                <AlertDescription>
                  Funding actions are limited to admins and endorsers. Please
                  contact a platform administrator if additional liquidity is
                  required.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </CardContent>
    </CardWithIndents>
  );
}
