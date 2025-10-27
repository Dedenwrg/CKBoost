"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  FormEvent,
} from "react";
import Link from "next/link";
import { ccc } from "@ckb-ccc/connector-react";
import { Loader2, ShieldCheck, Sparkles, Trophy } from "lucide-react";
import {
  AchievementService,
  type AchievementQueryResponse,
  type UserAchievement,
} from "@/lib";
import { getAchievementTypeCodeHash } from "@/lib/ckb/achievement-cells";
import { deploymentManager } from "@/lib/ckb/deployment-manager";
import { useProtocol } from "@/lib/providers/protocol-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { createScopedLogger } from "ssri-ckboost";

const log = createScopedLogger("AchievementsSection");

interface PreviewState {
  result: AchievementQueryResponse | null;
  error: string | null;
  isLoading: boolean;
}

const EMPTY_PREVIEW: PreviewState = {
  result: null,
  error: null,
  isLoading: false,
};

const summarizeAchievement = (achievement: UserAchievement): string => {
  const title = achievement.title?.trim();
  if (title && title.length > 0) {
    return title;
  }
  const nevent = achievement.metadataNeventId?.trim();
  if (nevent && nevent.length > 0) {
    return nevent;
  }
  return achievement.id;
};

const formatGrantedAt = (achievement: UserAchievement): string | null => {
  if (!achievement.grantedAt) return null;
  try {
    const date = new Date(Number(achievement.grantedAt) * 1000);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toLocaleString();
  } catch {
    return null;
  }
};

export function AchievementsSection(): React.JSX.Element {
  const { client } = ccc.useCcc();
  const signer = ccc.useSigner();
  const {
    userAddress,
    protocolData,
    protocolCell,
    isLoading: protocolLoading,
    error: protocolError,
  } = useProtocol();

  const [achievements, setAchievements] = useState<UserAchievement[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>(EMPTY_PREVIEW);
  const [txHexInput, setTxHexInput] = useState("");

  const achievementService = useMemo(() => {
    if (!client) return null;
    const network = deploymentManager.getCurrentNetwork();
    const typeCodeHash = getAchievementTypeCodeHash(network);
    if (!typeCodeHash) {
      return null;
    }
    try {
      return new AchievementService(client, typeCodeHash);
    } catch (error) {
      log.warn("Failed to init service", error);
      return null;
    }
  }, [client]);

  const handleClaimAchievements = useCallback(async () => {
    if (
      !achievementService ||
      !userAddress ||
      !protocolData ||
      !protocolCell ||
      !signer
    ) {
      return;
    }
    if (!signer) {
      throw new Error("Signer not found.");
    }
    const protocolTypeHash = protocolCell.cellOutput.type?.hash();
    if (!protocolTypeHash) {
      throw new Error("Protocol cell missing type hash.");
    }
    const result = await achievementService.claimAchievements(
      grantableAchievements,
      userAddress,
      protocolTypeHash,
      signer
    );
    if (!result) {
      throw new Error("Failed to claim achievements.");
    }
    log.info({
      title: "Achievements claimed",
      description: "Achievements claimed successfully.",
      variant: "success",
    });
  }, [achievementService, userAddress, protocolData, protocolCell]);

  const loadAchievements = useCallback(async () => {
    if (!achievementService || !userAddress || !protocolData || !protocolCell) {
      return;
    }
    setIsLoading(true);
    setServiceError(null);
    try {
      const protocolTypeHash = protocolCell.cellOutput.type?.hash();
      if (!protocolTypeHash) {
        throw new Error("Protocol cell missing type hash.");
      }
      const result = await achievementService.getUserAchievements(
        userAddress,
        protocolData,
        protocolTypeHash
      );
      setAchievements(result);
      const previewResult = await achievementService.previewClaim({
        userAddress,
      });
      if (!previewResult) {
        throw new Error("Failed to preview claimable achievements.");
      }
      setPreviewState({
        result: previewResult,
        error: null,
        isLoading: false,
      });
    } catch (error) {
      log.error("Failed to load achievements", error);
      const message =
        error instanceof Error ? error.message : "Unable to load achievements.";
      setServiceError(message);
      setAchievements([]);
    } finally {
      setIsLoading(false);
    }
  }, [achievementService, protocolCell, protocolData, userAddress]);

  useEffect(() => {
    if (!client) return;
    if (!achievementService) {
      setServiceError(
        "Achievements contract is not configured for the current deployment."
      );
      setAchievements([]);
      return;
    }
    if (!userAddress || !protocolData) {
      setAchievements([]);
      return;
    }
    loadAchievements().catch((error) => log.error("load failed", error));
  }, [achievementService, client, loadAchievements, protocolData, userAddress]);

  useEffect(() => {
    if (!achievementService || !userAddress) {
      setPreviewState(EMPTY_PREVIEW);
      return;
    }

    let cancelled = false;

    setPreviewState((prev) => ({
      result: prev.result,
      error: null,
      isLoading: true,
    }));

    achievementService
      .previewClaim({ userAddress })
      .then((result) => {
        if (cancelled) return;
        if (!result.success) {
          setPreviewState({
            result,
            error:
              result.message ||
              "Unable to determine grantable achievements at this time.",
            isLoading: false,
          });
          return;
        }
        setPreviewState({
          result,
          error: null,
          isLoading: false,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        log.error("Automatic preview failed", error);
        setPreviewState({
          result: null,
          error:
            error instanceof Error
              ? error.message
              : "Failed to load grantable achievements.",
          isLoading: false,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [achievementService, userAddress]);

  const achievementsById = useMemo(() => {
    return new Map(
      achievements.map((achievement) => [achievement.id, achievement])
    );
  }, [achievements]);

  const claimedAchievements = useMemo(
    () => achievements.filter((achievement) => achievement.completed),
    [achievements]
  );

  const grantableAchievements = useMemo(() => {
    if (!previewState.result || !previewState.result.success) return [];
    return previewState.result.grantable;
  }, [previewState]);

  const handlePreview = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!achievementService) {
        setPreviewState({
          result: null,
          error:
            "Achievements validation service is unavailable. Ensure the protocol is configured for achievements.",
          isLoading: false,
        });
        return;
      }
      if (!userAddress) {
        setPreviewState({
          result: null,
          error: "Connect your wallet to preview claimable achievements.",
          isLoading: false,
        });
        return;
      }
      const txHex = txHexInput.trim();
      if (!txHex) {
        setPreviewState({
          result: null,
          error: "Paste the raw transaction hex you want to validate.",
          isLoading: false,
        });
        return;
      }

      setPreviewState({ result: null, error: null, isLoading: true });
      try {
        const result = await achievementService.previewClaim({
          tx: txHex,
          userAddress,
        });
        if (!result.success) {
          setPreviewState({
            result,
            error:
              result.message ||
              "Achievement validation failed. Review the transaction and try again.",
            isLoading: false,
          });
        } else {
          setPreviewState({ result, error: null, isLoading: false });
        }
      } catch (error) {
        log.error("Preview failed", error);
        setPreviewState({
          result: null,
          error:
            error instanceof Error
              ? error.message
              : "Failed to preview transaction.",
          isLoading: false,
        });
      }
    },
    [achievementService, txHexInput, userAddress]
  );

  const isDisabled =
    !achievementService || protocolLoading || !!protocolError || !userAddress;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Trophy className="h-5 w-5 text-amber-500" />
            Achievements
          </CardTitle>
          <CardDescription>
            Track milestones you&apos;ve earned and preview what you can claim
            next.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadAchievements()}
            disabled={isDisabled || isLoading}
          >
            {isLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
        <div className="flex items-center gap-2"></div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleClaimAchievements()}
          disabled={isDisabled || isLoading}
        >
          Claim Achievements
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {!userAddress && (
          <Alert variant="default">
            <AlertTitle>Wallet not connected</AlertTitle>
            <AlertDescription>
              Connect your wallet to load personalised achievements and preview
              claimable rewards.
            </AlertDescription>
          </Alert>
        )}

        {serviceError && userAddress && (
          <Alert variant="destructive">
            <AlertTitle>Achievements unavailable</AlertTitle>
            <AlertDescription>{serviceError}</AlertDescription>
          </Alert>
        )}

        {achievements.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-border/60 bg-muted/40 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-green-500" />
                Claimed
              </div>
              <div className="mt-2 text-2xl font-semibold">
                {claimedAchievements.length}
              </div>
              <p className="text-xs text-muted-foreground">
                Successfully recorded on-chain.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/40 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Sparkles className="h-4 w-4 text-amber-500" />
                Grantable
              </div>
              <div className="mt-2 text-2xl font-semibold">
                {grantableAchievements.length}
              </div>
              <p className="text-xs text-muted-foreground">
                Based on the last previewed transaction.
              </p>
            </div>
          </div>
        )}
        {previewState.result && (
          <pre className="rounded-xl border border-border/60 bg-muted/40 p-4">
            {JSON.stringify(
              previewState.result.success ? previewState.result.grantable : [],
              null,
              2
            )}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
