"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { ccc } from "@ckb-ccc/connector-react";
import { Trophy, Coins, RefreshCw } from "lucide-react";
import { badgeVariants } from "@/components/ui/badge";
import { useProtocol } from "@/lib/providers/protocol-provider";
import {
  fetchUserPointsBalance,
  formatPointsBalance,
} from "@/lib/ckb/points-balance";
import { debug } from "@/lib/utils/debug";
import { cn } from "@/lib/utils";
import { StreakBonusService } from "@/lib/services/streak-bonus-service";
import type { BonusStreakResponse } from "@/netlify/lib/streak-bonus";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";

export function PointsBalance() {
  const { protocolCell } = useProtocol();
  const signer = ccc.useSigner();
  const { client } = ccc.useCcc();
  const { toast } = useToast();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [bonus, setBonus] = useState<BonusStreakResponse | null>(null);
  const [bonusLoading, setBonusLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [userAddress, setUserAddress] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadBalances = useCallback(async () => {
    if (!mountedRef.current) {
      return;
    }

    if (!signer || !client || !protocolCell) {
      setBalance(null);
      setBonus(null);
      setUserAddress(null);
      setIsLoading(false);
      setBonusLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setBonusLoading(true);

      const recommended = await signer.getRecommendedAddressObj();
      const userAddressString = await signer.getRecommendedAddress();
      if (!mountedRef.current) return;
      setUserAddress(userAddressString);

      const protocolTypeHash = protocolCell.cellOutput.type?.hash();
      if (!protocolTypeHash) {
        debug.warn("Protocol type hash not found");
        setBalance(BigInt(0));
        setBonus(null);
        return;
      }

      const pointsPromise = fetchUserPointsBalance(
        client,
        recommended.script,
        protocolTypeHash
      );

      const streakBonusService = new StreakBonusService();
      let bonusResponse: BonusStreakResponse | null = null;
      try {
        bonusResponse = await streakBonusService.query({
          userAddress: userAddressString,
        });
      } catch (bonusError) {
        debug.warn("Failed to load streak bonus information:", bonusError);
      }

      const pointsBalance = await pointsPromise;
      if (!mountedRef.current) return;

      setBalance(pointsBalance);
      setBonus(bonusResponse);
    } catch (error) {
      debug.error("Failed to load Points balance:", error);
      if (!mountedRef.current) return;
      setBalance(BigInt(0));
      setBonus(null);
    } finally {
      if (!mountedRef.current) return;
      setIsLoading(false);
      setBonusLoading(false);
    }
  }, [signer, client, protocolCell]);

  useEffect(() => {
    void loadBalances();

    const interval = setInterval(() => {
      void loadBalances();
    }, 300000);
    return () => clearInterval(interval);
  }, [loadBalances]);

  const handleClaimBonus = useCallback(async () => {
    if (
      !signer ||
      !bonus ||
      !bonus.eligible ||
      !bonus.transaction?.txHex ||
      !userAddress
    ) {
      return;
    }

    try {
      setClaiming(true);
      const bonusService = new StreakBonusService(signer);
      const { txHash } = await bonusService.claim({
        userAddress,
        txHex: bonus.transaction.txHex,
      });

      toast({
        title: "Streak bonus claimed",
        description: `Transaction ${txHash.slice(0, 10)}...${txHash.slice(
          -6
        )} submitted.`,
      });
      await loadBalances();
    } catch (error) {
      debug.error("Failed to claim streak bonus:", error);
      toast({
        title: "Unable to claim streak bonus",
        description:
          error instanceof Error ? error.message : "Unexpected claim error.",
        variant: "destructive",
      });
    } finally {
      if (mountedRef.current) {
        setClaiming(false);
      }
    }
  }, [bonus, loadBalances, signer, toast, userAddress]);

  const handleRefresh = useCallback(() => {
    void loadBalances();
  }, [loadBalances]);

  // Don't show anything if wallet not connected
  if (!signer) {
    return null;
  }

  // Show loading state
  if ((isLoading || bonusLoading) && balance === null) {
    return (
      <div
        className={cn(
          badgeVariants({ variant: "secondary" }),
          "bg-gradient-to-r from-purple-100 to-blue-100 dark:from-purple-900/20 dark:to-blue-900/20 border-purple-200 dark:border-purple-800"
        )}
      >
        <div className="animate-pulse flex items-center gap-1.5">
          <Trophy className="w-3.5 h-3.5" />
          <span className="text-xs">Loading...</span>
        </div>
      </div>
    );
  }

  const bonusAmount = (() => {
    try {
      return bonus?.bonusAmount ? BigInt(bonus.bonusAmount) : 0n;
    } catch {
      return 0n;
    }
  })();

  const isBonusAvailable =
    Boolean(bonus?.eligible) &&
    Boolean(bonus?.transaction?.txHex) &&
    bonusAmount > 0n;

  const isDisabled =
    !isBonusAvailable || claiming || isLoading || bonusLoading || !userAddress;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleClaimBonus}
        disabled={isDisabled}
        className={cn(
          badgeVariants({ variant: "secondary" }),
          "bg-gradient-to-r from-purple-100 to-blue-100 dark:from-purple-900/20 dark:to-blue-900/20 border-purple-200 dark:border-purple-800",
          "flex items-center gap-1.5 transition",
          isDisabled ? "cursor-default opacity-80" : "cursor-pointer",
          claiming ? "animate-pulse" : ""
        )}
      >
        <Coins className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
        <span className="font-semibold text-purple-700 dark:text-purple-300">
          {balance !== null ? formatPointsBalance(balance) : "0"}
        </span>
        <span className="text-xs text-purple-600 dark:text-purple-400">
          Points
        </span>
        {claiming ? (
          <span className="text-xs text-purple-500 dark:text-purple-300">
            Claiming...
          </span>
        ) : (
          isBonusAvailable && (
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              +{formatPointsBalance(bonusAmount)} bonus
            </span>
          )
        )}
      </button>
      <Button
        variant="outline"
        size="icon"
        onClick={handleRefresh}
        disabled={isLoading || bonusLoading || claiming}
        className="h-7 w-7"
      >
        <RefreshCw
          className={cn(
            "h-4 w-4",
            isLoading || bonusLoading ? "animate-spin" : ""
          )}
        />
        <span className="sr-only">Refresh points and streak bonus</span>
      </Button>
    </div>
  );
}
