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
import {
  Award,
  Loader2,
  ShieldCheck,
  Sparkles,
  Trophy,
  Wrench,
} from "lucide-react";
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
      console.warn("[AchievementsSection] Failed to init service", error);
      return null;
    }
  }, [client]);

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
    } catch (error) {
      console.error("[AchievementsSection] Failed to load achievements", error);
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
    loadAchievements().catch((error) =>
      console.error("[AchievementsSection] load failed", error)
    );
  }, [achievementService, client, loadAchievements, protocolData, userAddress]);

  const achievementsById = useMemo(() => {
    return new Map(
      achievements.map((achievement) => [achievement.id, achievement])
    );
  }, [achievements]);

  const claimedAchievements = useMemo(
    () => achievements.filter((achievement) => achievement.completed),
    [achievements]
  );

  const pendingAchievements = useMemo(
    () => achievements.filter((achievement) => !achievement.completed),
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
        console.error("[AchievementsSection] Preview failed", error);
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
          <Button variant="outline" size="sm" asChild>
            <Link href="/platform-admin">
              <Wrench className="mr-2 h-4 w-4" />
              Manage Protocol
            </Link>
          </Button>
        </div>
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
                <Award className="h-4 w-4 text-blue-500" />
                Available
              </div>
              <div className="mt-2 text-2xl font-semibold">
                {pendingAchievements.length}
              </div>
              <p className="text-xs text-muted-foreground">
                Achievements still waiting to be earned.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/40 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Sparkles className="h-4 w-4 text-amber-500" />
                Grantable (Draft)
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

        <div className="space-y-4">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            Preview a Claim Transaction
          </h3>
          <p className="text-sm text-muted-foreground">
            Paste a draft achievement claim transaction to let the server verify
            what would be granted. Use the response to confirm your draft before
            requesting a signature.
          </p>
          <form className="space-y-3" onSubmit={handlePreview}>
            <Textarea
              value={txHexInput}
              onChange={(event) => setTxHexInput(event.target.value)}
              placeholder="0x..."
              className="min-h-[120px] font-mono text-xs"
              disabled={isDisabled || previewState.isLoading}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                disabled={isDisabled || previewState.isLoading}
              >
                {previewState.isLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                Preview via Netlify
              </Button>
              {previewState.error && (
                <span className="text-sm text-red-500">
                  {previewState.error}
                </span>
              )}
              {previewState.result && previewState.result.success && (
                <Badge variant="secondary">
                  {previewState.result.grantable.length > 0
                    ? `${previewState.result.grantable.length} achievements can be granted`
                    : "No new grants detected"}
                </Badge>
              )}
            </div>
          </form>
        </div>

        {previewState.result && previewState.result.success && (
          <div className="space-y-3">
            <h3 className="text-base font-semibold flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-green-500" />
              Preview Results
            </h3>
            {grantableAchievements.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                The provided transaction does not grant any new achievements.
              </p>
            ) : (
              <div className="space-y-3">
                {grantableAchievements.map((id) => {
                  const achievement = achievementsById.get(id);
                  return (
                    <div
                      key={`grantable-${id}`}
                      className="rounded-lg border border-green-200/70 bg-green-50/70 p-3 dark:border-green-900/60 dark:bg-green-900/20"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium">
                            {achievement
                              ? summarizeAchievement(achievement)
                              : id}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Achievement ID: {id}
                          </div>
                        </div>
                        <Badge variant="secondary">Grantable</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {previewState.result.alreadyClaimed.length > 0 && (
              <div className="rounded-lg border border-border/60 bg-muted/40 p-3">
                <div className="text-sm font-medium mb-2">
                  Already claimed in current state
                </div>
                <div className="flex flex-wrap gap-2">
                  {previewState.result.alreadyClaimed.map((id) => (
                    <Badge key={`claimed-${id}`} variant="outline">
                      {id}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="space-y-3">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Award className="h-4 w-4 text-blue-500" />
            Claimed Achievements
          </h3>
          {claimedAchievements.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No achievements recorded yet. Complete verification steps or
              quests to start collecting milestones.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {claimedAchievements.map((achievement) => (
                <div
                  key={`claimed-${achievement.id}`}
                  className="rounded-lg border border-border/60 bg-background p-3 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">
                      {summarizeAchievement(achievement)}
                    </div>
                    <Badge variant="default" className="bg-green-500/90">
                      Claimed
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground break-all font-mono">
                    {achievement.metadataNeventId || achievement.id}
                  </div>
                  {formatGrantedAt(achievement) && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      Granted at {formatGrantedAt(achievement)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500" />
            Available Achievements
          </h3>
          {pendingAchievements.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              All currently configured achievements are already claimed. Keep an
              eye on new campaign releases for more opportunities.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {pendingAchievements.map((achievement) => (
                <div
                  key={`pending-${achievement.id}`}
                  className="rounded-lg border border-dashed border-border/60 bg-muted/30 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">
                      {summarizeAchievement(achievement)}
                    </div>
                    <Badge variant="outline">Awaiting claim</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground break-all font-mono">
                    {achievement.metadataNeventId || achievement.id}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
