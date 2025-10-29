"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  FormEvent,
  useRef,
} from "react";
import Link from "next/link";
import { ccc } from "@ckb-ccc/connector-react";
import { Loader2, ShieldCheck, Sparkles, Trophy, Target } from "lucide-react";
import { useNostrFetch } from "@/hooks/use-nostr-fetch";
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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

const extractHtmlFromContent = (raw: string): string => {
  if (!raw) return "";

  try {
    const parsed = JSON.parse(raw) as {
      format?: string;
      contentHtml?: string;
      content?: string;
      description_html?: string;
    } | null;

    if (parsed && typeof parsed === "object") {
      // Achievement metadata format
      if (typeof parsed.description_html === "string") {
        return parsed.description_html;
      }
      // Campaign long description format
      if (
        parsed.format === "ckboost-campaign-long-description" &&
        typeof parsed.contentHtml === "string"
      ) {
        return parsed.contentHtml;
      }
      // Generic HTML format
      if (parsed.format === "html" && typeof parsed.content === "string") {
        return parsed.content;
      }
    }
  } catch {
    // Not JSON, fall back to raw string
  }

  return raw;
};

const formatMetadataHtml = (content: string): string => {
  if (!content) {
    return "";
  }

  const hasHtmlTags = /<[a-z][\s\S]*>/i.test(content);
  if (hasHtmlTags) {
    return content;
  }

  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  return `<p>${escapeHtml(content).replace(/\n/g, "<br />")}</p>`;
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
  const { fetchSubmission } = useNostrFetch();
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
  const [resolvedMetadata, setResolvedMetadata] = useState<
    Map<
      string,
      { content: string | null; error: string | null; loading: boolean }
    >
  >(new Map());
  const fetchingRef = useRef<Set<string>>(new Set());

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

  const availableAchievements = useMemo(() => {
    const grantableSet = new Set(grantableAchievements);
    return achievements.filter(
      (achievement) =>
        !achievement.completed &&
        !grantableSet.has(achievement.title) &&
        !grantableSet.has(achievement.id)
    );
  }, [achievements, grantableAchievements]);

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

  // Fetch metadata for achievements with nevent IDs
  useEffect(() => {
    const fetchMetadata = async () => {
      const metadataToFetch = availableAchievements.filter((achievement) => {
        const neventId = achievement.metadataNeventId;
        return (
          neventId?.startsWith("nevent1") &&
          !resolvedMetadata.has(neventId) &&
          !fetchingRef.current.has(neventId)
        );
      });

      if (metadataToFetch.length === 0) return;

      for (const achievement of metadataToFetch) {
        const neventId = achievement.metadataNeventId!;

        // Mark as fetching
        fetchingRef.current.add(neventId);

        // Mark as loading
        setResolvedMetadata((prev) => {
          const next = new Map(prev);
          next.set(neventId, { content: null, error: null, loading: true });
          return next;
        });

        try {
          const submission = await fetchSubmission(neventId);
          if (!submission?.content) {
            throw new Error("Unable to load metadata from Nostr.");
          }

          const html = formatMetadataHtml(
            extractHtmlFromContent(submission.content)
          );

          setResolvedMetadata((prev) => {
            const next = new Map(prev);
            next.set(neventId, {
              content: html,
              error: null,
              loading: false,
            });
            return next;
          });
        } catch (error) {
          log.error("Failed to fetch achievement metadata", error);
          setResolvedMetadata((prev) => {
            const next = new Map(prev);
            next.set(neventId, {
              content: null,
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to load metadata.",
              loading: false,
            });
            return next;
          });
        } finally {
          fetchingRef.current.delete(neventId);
        }
      }
    };

    fetchMetadata();
  }, [availableAchievements, fetchSubmission, resolvedMetadata]);

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
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleClaimAchievements()}
            disabled={
              isDisabled || isLoading || grantableAchievements.length === 0
            }
          >
            Claim Achievements
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
              {claimedAchievements.map((achievement) => (
                <Badge key={achievement.id}>{achievement.title}</Badge>
              ))}
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
              {previewState.result &&
                previewState.result.success &&
                previewState.result.grantable.map((achievement) => (
                  <Badge key={achievement}>{achievement}</Badge>
                ))}
            </div>
          </div>
        )}

        {availableAchievements.length > 0 && (
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem
              value="available-achievements"
              className="border-none"
            >
              <AccordionTrigger className="rounded-lg border border-border/60 bg-muted/40 px-4 py-3 hover:no-underline">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-blue-500" />
                  <span className="font-medium">
                    Available Achievements ({availableAchievements.length})
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pt-4">
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Achievements you haven&apos;t earned yet. Complete the
                    requirements to make them grantable.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {availableAchievements.map((achievement) => {
                      const neventId = achievement.metadataNeventId;
                      const metadata =
                        neventId && neventId.startsWith("nevent1")
                          ? resolvedMetadata.get(neventId)
                          : null;

                      return (
                        <div
                          key={achievement.id}
                          className="group rounded-lg border border-border/60 bg-muted/20 p-4 transition-colors hover:bg-muted/40"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 space-y-2">
                              <h4 className="font-medium leading-tight">
                                {achievement.title || achievement.id}
                              </h4>
                              {metadata?.loading && (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  Loading metadata...
                                </div>
                              )}
                              {metadata?.error && (
                                <p className="text-xs text-red-500">
                                  {metadata.error}
                                </p>
                              )}
                              {metadata?.content && (
                                <div
                                  className="text-xs text-muted-foreground prose prose-sm max-w-none"
                                  dangerouslySetInnerHTML={{
                                    __html: metadata.content,
                                  }}
                                />
                              )}
                              {!metadata &&
                                neventId &&
                                neventId.startsWith("nevent1") && (
                                  <p className="text-xs text-muted-foreground font-mono break-all">
                                    {neventId.slice(0, 20)}...
                                  </p>
                                )}
                              {!achievement.title && !neventId && (
                                <p className="text-xs text-muted-foreground">
                                  ID: {achievement.id}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}
