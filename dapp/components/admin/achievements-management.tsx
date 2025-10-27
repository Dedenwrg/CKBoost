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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import {
  CheckCircle2,
  Clipboard,
  ExternalLink,
  FileJson,
  Info,
  Loader2,
  Plus,
  RefreshCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { MarkdownEditor } from "@/components/markdown-editor";
import {
  fetchAchievementCell,
  toAchievementEntries,
  getAchievementTypeCodeHash,
  getAchievementTypeCodeOutPoint,
  type AchievementEntry,
  type AchievementDefinitionInput,
} from "@/lib/ckb/achievement-cells";
import { deploymentManager } from "@/lib/ckb/deployment-manager";
import { useProtocol } from "@/lib/providers/protocol-provider";
import { ConnectedTypeID, type ConnectedTypeIDLike } from "ssri-ckboost/types";
import { useNostrStorage } from "@/hooks/use-nostr-storage";
import { useStorageModal } from "@/lib/providers/storage-modal-provider";
import { createScopedLogger } from "ssri-ckboost";
const log = createScopedLogger("AchievementsManagement");

const decodeConnectedTypeId = (
  args?: ccc.HexLike | null
): ConnectedTypeIDLike | null => {
  if (!args || args === "0x") return null;
  try {
    return ConnectedTypeID.decode(ccc.hexFrom(args)) as ConnectedTypeIDLike;
  } catch (error) {
    log.warn("Failed to decode ConnectedTypeID args", error);
    return null;
  }
};

const formatHash = (hash: string, prefix = 8, suffix = 6): string => {
  if (hash.length <= prefix + suffix + 2) return hash;
  return `${hash.slice(0, prefix + 2)}…${hash.slice(-suffix)}`;
};

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

type AchievementCellStatus =
  | { found: false }
  | {
      found: true;
      txHash: string;
      index: number;
      capacity: string;
      typeId: string;
      protocolKey: string;
      lockTypeId?: string;
      lockProtocolKey?: string;
    };

type AchievementDraft = {
  key: string;
  title: string;
  metadataText: string;
  metadataDescription: string;
};

type DraftEvaluation = {
  titleError: string | null;
  metadataError: string | null;
};

const createDraft = (): AchievementDraft => ({
  key: Math.random().toString(36).slice(2),
  title: "",
  metadataText: "",
  metadataDescription: "",
});

export function AchievementsManagement(): React.JSX.Element {
  const { client } = ccc.useCcc();
  const { protocolCell, signer, isWalletConnected, achievementService } =
    useProtocol();
  const { toast } = useToast();
  const storageModal = useStorageModal();
  const network = deploymentManager.getCurrentNetwork();
  const achievementTypeCodeHash = useMemo(
    () => getAchievementTypeCodeHash(network),
    [network]
  );
  const achievementTypeCodeOutPoint = useMemo(
    () => getAchievementTypeCodeOutPoint(network),
    [network]
  );
  const protocolTypeHash = useMemo(
    () => protocolCell?.cellOutput.type?.hash() ?? null,
    [protocolCell]
  );

  const [status, setStatus] = useState<AchievementCellStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [onChainAchievements, setOnChainAchievements] = useState<
    AchievementEntry[]
  >([]);

  const [drafts, setDrafts] = useState<AchievementDraft[]>([createDraft()]);
  const [deploying, setDeploying] = useState(false);
  const [publishingKey, setPublishingKey] = useState<string | null>(null);
  const { storeAchievementMetadata } = useNostrStorage();

  const evaluateDraft = useCallback(
    (draft: AchievementDraft): DraftEvaluation => {
      const titleTrimmed = draft.title.trim();
      const titleError = titleTrimmed ? null : "Title is required.";

      const descriptionTrimmed = draft.metadataDescription.trim();
      const metadataError = descriptionTrimmed
        ? null
        : "Add a description for this achievement.";

      return {
        titleError,
        metadataError,
      };
    },
    []
  );

  const draftEvaluations = useMemo(
    () => drafts.map(evaluateDraft),
    [drafts, evaluateDraft]
  );

  const previewEntries = useMemo(() => {
    return drafts.flatMap((draft, index) => {
      const evaluation = draftEvaluations[index];
      if (evaluation.titleError || evaluation.metadataError) {
        return [];
      }

      return [
        {
          achievement_title: draft.title.trim(),
          description_preview: draft.metadataDescription.trim(),
        },
      ];
    });
  }, [drafts, draftEvaluations]);

  const dataPreview = useMemo(
    () => JSON.stringify(previewEntries, null, 2),
    [previewEntries]
  );

  const hasValidEntries = previewEntries.length > 0;
  const deploymentUnavailable = !achievementTypeCodeHash;
  const missingProtocolCell = !protocolCell || !protocolTypeHash;

  const loadStatus = useCallback(async () => {
    if (!client) {
      setStatus(null);
      setStatusError("CKB client not initialized.");
      setOnChainAchievements([]);
      return;
    }

    if (!achievementTypeCodeHash) {
      setStatus(null);
      setStatusError(
        "Achievement type code cell is not registered. Update deployments.json."
      );
      setOnChainAchievements([]);
      return;
    }

    if (!protocolTypeHash) {
      setStatus(null);
      setStatusError(
        "Protocol cell type hash unavailable. Deploy the protocol cell first."
      );
      setOnChainAchievements([]);
      return;
    }

    setStatusLoading(true);
    setStatusError(null);

    try {
      const cell = await fetchAchievementCell(client, achievementTypeCodeHash, {
        protocolTypeHash,
      });

      if (!cell) {
        setStatus({ found: false });
        setOnChainAchievements([]);
        return;
      }

      const txHash = cell.outPoint?.txHash
        ? ccc.hexFrom(cell.outPoint.txHash)
        : "unknown";
      const index = Number(cell.outPoint?.index ?? 0);
      const capacity = ccc.numFrom(cell.cellOutput.capacity ?? 0).toString();

      const typeConnected = decodeConnectedTypeId(cell.cellOutput.type?.args);
      const lockConnected = decodeConnectedTypeId(
        cell.cellOutput.lock?.args ?? null
      );

      setStatus({
        found: true,
        txHash,
        index,
        capacity,
        typeId: typeConnected?.type_id
          ? ccc.hexFrom(typeConnected.type_id)
          : "unknown",
        protocolKey: typeConnected?.connected_key
          ? ccc.hexFrom(typeConnected.connected_key)
          : "unknown",
        lockTypeId: lockConnected?.type_id
          ? ccc.hexFrom(lockConnected.type_id)
          : undefined,
        lockProtocolKey: lockConnected?.connected_key
          ? ccc.hexFrom(lockConnected.connected_key)
          : undefined,
      });

      setOnChainAchievements(toAchievementEntries(cell));
    } catch (error) {
      log.error("Failed to load status", error);
      const message =
        error instanceof Error ? error.message : "Unknown error occurred.";
      setStatus(null);
      setOnChainAchievements([]);
      setStatusError(message);
    } finally {
      setStatusLoading(false);
    }
  }, [client, achievementTypeCodeHash, protocolTypeHash]);

  useEffect(() => {
    loadStatus().catch((error) => log.error("initial load failed", error));
  }, [loadStatus]);

  const handleAddDraft = useCallback(() => {
    setDrafts((prev) => [...prev, createDraft()]);
  }, []);

  const handleRemoveDraft = useCallback((key: string) => {
    setDrafts((prev) => prev.filter((draft) => draft.key !== key));
  }, []);

  const handleUpdateDraft = useCallback(
    (key: string, patch: Partial<AchievementDraft>) => {
      setDrafts((prev) =>
        prev.map((draft) =>
          draft.key === key
            ? {
                ...draft,
                ...patch,
              }
            : draft
        )
      );
    },
    []
  );

  const handleCopyPreview = useCallback(async () => {
    if (!hasValidEntries) {
      toast({
        title: "Nothing to copy",
        description:
          "Add at least one achievement with valid metadata before copying.",
        variant: "destructive",
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(dataPreview);
      toast({
        title: "Preview copied",
        description: "Draft achievement JSON copied to clipboard.",
      });
    } catch (error) {
      log.error("Copy failed", error);
      toast({
        title: "Unable to copy",
        description:
          "Clipboard access was denied. Copy the preview manually instead.",
        variant: "destructive",
      });
    }
  }, [dataPreview, hasValidEntries, toast]);

  const handlePublishMetadata = useCallback(
    async (key: string) => {
      const draft = drafts.find((item) => item.key === key);
      if (!draft) return;

      const titleTrimmed = draft.title.trim();
      const descriptionTrimmed = draft.metadataDescription.trim();

      if (!titleTrimmed) {
        toast({
          title: "Title required",
          description: "Add a title before publishing metadata.",
          variant: "destructive",
        });
        return;
      }

      if (!descriptionTrimmed) {
        toast({
          title: "Description required",
          description: "Add a description before publishing metadata.",
          variant: "destructive",
        });
        return;
      }

      setPublishingKey(key);
      try {
        const baseId =
          slugify(titleTrimmed) || `achievement-${key.slice(0, 6)}`;
        const uniqueId = `${baseId}-${Date.now().toString(36)}`;

        const payload = {
          id: uniqueId,
          title: titleTrimmed,
          description_html: descriptionTrimmed,
          updated_at: new Date().toISOString(),
        };

        const neventId = await storeAchievementMetadata.mutateAsync({
          achievementId: uniqueId,
          title: titleTrimmed,
          content: JSON.stringify(payload),
          metadata: {
            format: "html",
            type: "achievement_metadata",
          },
        });

        handleUpdateDraft(key, {
          metadataText: neventId,
        });

        toast({
          title: "Metadata published",
          description: `Stored via Nostr as ${formatHash(neventId)}`,
        });

        storageModal.open({
          neventId,
          mode: "verifying",
          label: titleTrimmed,
          contentHint: "html",
          cachedPayloads: {
            [neventId]: {
              content: JSON.stringify(payload),
              metadata: {
                format: "html",
                type: "achievement_metadata",
              },
            },
          },
          onConfirm: async () => undefined,
        });
      } catch (error) {
        toast({
          title: "Failed to publish metadata",
          description:
            error instanceof Error
              ? error.message
              : "Unable to store metadata via Nostr.",
          variant: "destructive",
        });
      } finally {
        setPublishingKey(null);
      }
    },
    [drafts, handleUpdateDraft, storageModal, storeAchievementMetadata, toast]
  );

  const handleViewMetadata = useCallback(
    (draft: AchievementDraft) => {
      const neventId = draft.metadataText.trim();
      if (!neventId.startsWith("nevent")) return;

      storageModal.open({
        neventId,
        mode: "verifying",
        label: draft.title.trim() || "Achievement Metadata",
        contentHint: "html",
        onConfirm: async () => undefined,
      });
    },
    [storageModal]
  );

  const handleDeploy = useCallback(async () => {
    if (!hasValidEntries) {
      toast({
        title: "No achievements prepared",
        description: "Add at least one achievement before deploying.",
        variant: "destructive",
      });
      return;
    }

    if (!isWalletConnected || !signer) {
      toast({
        title: "Wallet required",
        description: "Connect an admin wallet to deploy the achievements cell.",
        variant: "destructive",
      });
      return;
    }

    if (!protocolCell || !protocolTypeHash) {
      toast({
        title: "Protocol cell unavailable",
        description:
          "Deploy and load the protocol cell before creating the achievements cell.",
        variant: "destructive",
      });
      return;
    }

    if (!achievementTypeCodeHash) {
      toast({
        title: "Missing deployment info",
        description:
          "The achievement type code cell is not registered. Update deployments.json first.",
        variant: "destructive",
      });
      return;
    }

    if (status?.found) {
      toast({
        title: "Achievements cell already exists",
        description:
          "Updating achievements requires a dedicated flow. Only one cell should exist per protocol.",
        variant: "destructive",
      });
      return;
    }

    if (!hasValidEntries) {
      toast({
        title: "Add achievement details",
        description:
          "Provide at least one achievement with title and description.",
        variant: "destructive",
      });
      return;
    }

    const firstErrorIndex = draftEvaluations.findIndex(
      (evaluation) => evaluation.titleError || evaluation.metadataError
    );
    if (firstErrorIndex !== -1) {
      const evaluation = draftEvaluations[firstErrorIndex];
      toast({
        title: "Complete achievement details",
        description:
          evaluation.titleError ?? evaluation.metadataError ?? "Invalid entry.",
        variant: "destructive",
      });
      return;
    }

    setDeploying(true);
    try {
      const achievementsPayload: AchievementDefinitionInput[] = [];
      const updatedDrafts: AchievementDraft[] = [];
      const usedIds = new Set<string>();

      for (const [index, draft] of drafts.entries()) {
        const titleTrimmed = draft.title.trim();
        const descriptionTrimmed = draft.metadataDescription.trim();

        let metadataId = slugify(titleTrimmed);
        if (!metadataId) {
          metadataId = `achievement-${index + 1}`;
        }
        let uniqueId = metadataId;
        let suffix = 1;
        while (usedIds.has(uniqueId)) {
          uniqueId = `${metadataId}-${suffix}`;
          suffix += 1;
        }
        usedIds.add(uniqueId);

        let metadataNevent = draft.metadataText.trim();
        if (!metadataNevent.startsWith("nevent")) {
          const payload = {
            id: uniqueId,
            title: titleTrimmed,
            description_html: descriptionTrimmed,
            updated_at: new Date().toISOString(),
          };

          metadataNevent = await storeAchievementMetadata.mutateAsync({
            achievementId: uniqueId,
            title: titleTrimmed,
            content: JSON.stringify(payload),
            metadata: {
              format: "html",
              type: "achievement_metadata",
            },
          });
        }

        achievementsPayload.push({
          achievement_title: titleTrimmed,
          achievement_metadata: metadataNevent,
          receiver_user_record_vec: [],
        });

        updatedDrafts.push({
          ...draft,
          metadataText: metadataNevent,
        });
      }

      setDrafts(updatedDrafts);

      if (!achievementService) {
        toast({
          title: "Achievement service not available",
          description:
            "Achievement service is not available. Please try again later.",
          variant: "destructive",
        });
        return;
      }

      const result = await achievementService.deployAchievementCell({
        signer,
        protocolCell,
        achievements: achievementsPayload,
      });

      toast({
        title: "Achievement cell deployed",
        description: `Tx: ${formatHash(
          result?.txHash ?? ""
        )} · Type ID: ${formatHash(result?.typeId ?? "")}`,
      });

      await loadStatus();
    } catch (error) {
      log.error("Deployment failed", error);
      toast({
        title: "Deployment failed",
        description:
          error instanceof Error ? error.message : "Unknown error occurred.",
        variant: "destructive",
      });
    } finally {
      setDeploying(false);
    }
  }, [
    achievementTypeCodeHash,
    draftEvaluations,
    drafts,
    hasValidEntries,
    isWalletConnected,
    loadStatus,
    protocolCell,
    protocolTypeHash,
    signer,
    status,
    storeAchievementMetadata,
    toast,
  ]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Achievements Deployment</CardTitle>
            <CardDescription>
              Deploy and monitor the achievements cell connected to the current
              protocol.
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
              <AlertTitle>Unable to load achievements status</AlertTitle>
              <AlertDescription>{statusError}</AlertDescription>
            </Alert>
          )}

          {deploymentUnavailable && (
            <Alert variant="destructive">
              <AlertTitle>Achievement type code cell missing</AlertTitle>
              <AlertDescription>
                Register the achievement type contract in{" "}
                <code>deployments.json</code> before creating the achievements
                cell.
              </AlertDescription>
            </Alert>
          )}

          {missingProtocolCell && (
            <Alert>
              <AlertTitle>Protocol cell not detected</AlertTitle>
              <AlertDescription>
                Deploy the protocol cell or refresh the admin dashboard after it
                becomes available.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Info className="h-4 w-4" />
              Achievement Type Code Cell (smart contract)
            </div>
            <div className="grid gap-2 text-xs font-mono sm:grid-cols-2">
              <div>
                <span className="block text-[0.65rem] uppercase text-muted-foreground">
                  Code hash
                </span>
                <span className="break-all">
                  {achievementTypeCodeHash ?? "n/a"}
                </span>
              </div>
              <div>
                <span className="block text-[0.65rem] uppercase text-muted-foreground">
                  OutPoint
                </span>
                <span className="break-all">
                  {achievementTypeCodeOutPoint
                    ? `${achievementTypeCodeOutPoint.txHash}:${Number(
                        achievementTypeCodeOutPoint.index
                      )}`
                    : "n/a"}
                </span>
              </div>
            </div>
          </div>

          {status?.found === true && (
            <div className="space-y-3 rounded-lg border border-green-400/60 bg-green-50/80 p-4 text-sm dark:border-green-800/70 dark:bg-green-900/20">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-green-500 text-white">
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                  Active
                </Badge>
                <span className="font-medium">
                  Achievements cell detected on-chain.
                </span>
              </div>
              <dl className="grid gap-2 text-xs font-mono md:grid-cols-2">
                <div>
                  <span className="block text-[0.65rem] uppercase text-muted-foreground">
                    Transaction hash
                  </span>
                  <span className="break-all">{status.txHash}</span>
                </div>
                <div>
                  <span className="block text-[0.65rem] uppercase text-muted-foreground">
                    Output index
                  </span>
                  <span className="break-all">{status.index}</span>
                </div>
                <div>
                  <span className="block text-[0.65rem] uppercase text-muted-foreground">
                    Cell capacity (shannons)
                  </span>
                  <span className="break-all">{status.capacity}</span>
                </div>
                <div>
                  <span className="block text-[0.65rem] uppercase text-muted-foreground">
                    Type ID
                  </span>
                  <span className="break-all">{status.typeId}</span>
                </div>
                <div>
                  <span className="block text-[0.65rem] uppercase text-muted-foreground">
                    Connected protocol key
                  </span>
                  <span className="break-all">{status.protocolKey}</span>
                </div>
                {status.lockTypeId && (
                  <div>
                    <span className="block text-[0.65rem] uppercase text-muted-foreground">
                      Lock ConnectedTypeID · type_id
                    </span>
                    <span className="break-all">{status.lockTypeId}</span>
                  </div>
                )}
                {status.lockProtocolKey && (
                  <div>
                    <span className="block text-[0.65rem] uppercase text-muted-foreground">
                      Lock ConnectedTypeID · protocol
                    </span>
                    <span className="break-all">{status.lockProtocolKey}</span>
                  </div>
                )}
              </dl>

              <div className="space-y-2 rounded-md border border-border/50 bg-background/70 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Sparkles className="h-4 w-4 text-amber-500" />
                    On-chain achievements
                  </div>
                  <Badge variant="outline">
                    {onChainAchievements.length} entries
                  </Badge>
                </div>
                {onChainAchievements.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    The achievements cell is deployed but currently empty.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {onChainAchievements.map((entry, index) => {
                      const nevent = entry.metadataNeventId;
                      return (
                        <div
                          key={`on-chain-${nevent || entry.title || index}`}
                          className="rounded-md border border-border/60 bg-muted/10 p-3"
                        >
                          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                            <Badge variant="secondary" className="font-mono">
                              {nevent ? formatHash(nevent, 6, 4) : "no-nevent"}
                            </Badge>
                            <span>
                              {entry.title || "(Untitled achievement)"}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Metadata stored off-chain.
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Granted records: {entry.records.length}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {status?.found === false && (
            <Alert>
              <AlertTitle>No achievements cell found</AlertTitle>
              <AlertDescription>
                Deploy the achievements cell below to initialise on-chain
                storage for protocol milestones.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Prepare Achievements</CardTitle>
          <CardDescription>
            Define the achievements that will be stored in the achievements
            cell. Data is persisted as <code>AchievementDataVec</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-amber-500" />
              Draft achievements
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddDraft}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add achievement
            </Button>
          </div>

          <div className="space-y-4">
            {drafts.map((draft, index) => {
              const evaluation = draftEvaluations[index];
              return (
                <div
                  key={draft.key}
                  className="rounded-lg border border-border/60 bg-background p-4 shadow-sm"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="flex-1 space-y-2">
                      <label className="text-sm font-medium">
                        Achievement title
                      </label>
                      <Input
                        value={draft.title}
                        placeholder="e.g. Telegram Verification"
                        onChange={(event) =>
                          handleUpdateDraft(draft.key, {
                            title: event.target.value,
                          })
                        }
                      />
                      {evaluation.titleError && (
                        <p className="text-xs text-red-500">
                          {evaluation.titleError}
                        </p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveDraft(draft.key)}
                      disabled={drafts.length === 1}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Remove
                    </Button>
                  </div>
                  <div className="mt-4 space-y-2">
                    <label
                      className="text-sm font-medium"
                      htmlFor={`achievement-description-${draft.key}`}
                    >
                      Description
                    </label>
                    <MarkdownEditor
                      id={`achievement-description-${draft.key}`}
                      value={draft.metadataDescription}
                      onChange={(value) =>
                        handleUpdateDraft(draft.key, {
                          metadataDescription: value,
                        })
                      }
                      placeholder="Describe the achievement, requirements, and rewards."
                      height={220}
                    />
                    <p className="text-xs text-muted-foreground">
                      This content is saved off-chain automatically when you
                      deploy the achievements cell.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {draft.metadataText &&
                        draft.metadataText.startsWith("nevent") && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewMetadata(draft)}
                            className="flex items-center"
                          >
                            <ExternalLink className="mr-2 h-4 w-4" />
                            Preview on Nostr
                          </Button>
                        )}
                    </div>
                    {draft.metadataText &&
                      draft.metadataText.startsWith("nevent") && (
                        <p className="text-xs font-mono text-muted-foreground break-all">
                          Stored as {draft.metadataText}
                        </p>
                      )}
                    {evaluation.metadataError && (
                      <p className="text-xs text-red-500">
                        {evaluation.metadataError}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button
              type="button"
              onClick={handleDeploy}
              disabled={
                deploying ||
                !hasValidEntries ||
                !isWalletConnected ||
                !signer ||
                deploymentUnavailable ||
                missingProtocolCell ||
                status?.found === true
              }
            >
              {deploying ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deploying
                </>
              ) : (
                <>
                  <FileJson className="mr-2 h-4 w-4" />
                  Deploy achievements cell
                </>
              )}
            </Button>
            {status?.found && (
              <p className="text-xs text-muted-foreground">
                Deployment disabled because an achievements cell already exists.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
