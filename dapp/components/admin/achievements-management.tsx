"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";
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
import { useNostrFetch } from "@/hooks/use-nostr-fetch";
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

type AchievementCellStatus =
  | { found: false }
  | {
      found: true;
      txHash: string;
      index: number;
      capacity: string;
      typeHash: string;
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
  const {
    protocolCell,
    protocolData,
    signer,
    isWalletConnected,
    achievementService,
  } = useProtocol();
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
  const [appending, setAppending] = useState(false);
  const [publishingKey, setPublishingKey] = useState<string | null>(null);
  const { storeAchievementMetadata } = useNostrStorage();
  const { fetchSubmission } = useNostrFetch();
  const [resolvedMetadata, setResolvedMetadata] = useState<
    Map<
      string,
      { content: string | null; error: string | null; loading: boolean }
    >
  >(new Map());
  const fetchingRef = useRef<Set<string>>(new Set());

  const protocolAchievementTypeHashes = useMemo(() => {
    const hashes = protocolData?.protocol_config?.achievement_type_hashes ?? [];
    return hashes
      .map((hash) =>
        typeof hash === "string"
          ? hash.toLowerCase()
          : ccc.hexFrom(hash as ccc.HexLike).toLowerCase()
      )
      .filter((hash) => hash && hash !== "0x");
  }, [protocolData]);

  const activeAchievementTypeHash = useMemo(() => {
    if (status?.found && status.typeHash && status.typeHash !== "unknown") {
      return status.typeHash.toLowerCase();
    }
    return null;
  }, [status]);

  const isActiveCellRegistered = useMemo(
    () =>
      activeAchievementTypeHash
        ? protocolAchievementTypeHashes.includes(activeAchievementTypeHash)
        : false,
    [activeAchievementTypeHash, protocolAchievementTypeHashes]
  );

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

  const prepareAchievementDefinitions = useCallback(
    async (
      existingEntries: AchievementEntry[] = []
    ): Promise<{
      definitions: AchievementDefinitionInput[];
      updatedDrafts: AchievementDraft[];
    }> => {
      const definitions: AchievementDefinitionInput[] = existingEntries.map(
        (entry) => ({
          achievement_title: entry.raw.achievement_title,
          achievement_metadata: entry.raw.achievement_metadata,
          receiver_user_record_vec:
            entry.raw.receiver_user_record_vec ?? entry.records ?? [],
        })
      );

      const updatedDrafts: AchievementDraft[] = [];
      const usedIds = new Set<string>();

      existingEntries.forEach((entry) => {
        const existingTitle = entry.title?.trim();
        if (existingTitle) {
          usedIds.add(slugify(existingTitle));
        }
      });

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

        definitions.push({
          achievement_title: titleTrimmed,
          achievement_metadata: metadataNevent,
          receiver_user_record_vec: [],
        });

        updatedDrafts.push({
          ...draft,
          metadataText: metadataNevent,
        });
      }

      return { definitions, updatedDrafts };
    },
    [drafts, storeAchievementMetadata]
  );

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
      const typeHash = cell.cellOutput.type
        ? ccc.hexFrom(cell.cellOutput.type.hash())
        : "unknown";

      const typeConnected = decodeConnectedTypeId(cell.cellOutput.type?.args);
      const lockConnected = decodeConnectedTypeId(
        cell.cellOutput.lock?.args ?? null
      );

      setStatus({
        found: true,
        txHash,
        index,
        capacity,
        typeHash,
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

  // Fetch metadata for achievements with nevent IDs
  useEffect(() => {
    const fetchMetadata = async () => {
      const metadataToFetch = onChainAchievements.filter((entry) => {
        const neventId = entry.metadataNeventId;
        return (
          neventId?.startsWith("nevent1") &&
          !resolvedMetadata.has(neventId) &&
          !fetchingRef.current.has(neventId)
        );
      });

      if (metadataToFetch.length === 0) return;

      for (const entry of metadataToFetch) {
        const neventId = entry.metadataNeventId!;

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
  }, [onChainAchievements, fetchSubmission, resolvedMetadata]);

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
          "Use the append action below to add new achievements instead of deploying a new cell.",
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

    if (!achievementService) {
      toast({
        title: "Achievement service not available",
        description:
          "Achievement service is not available. Please try again later.",
        variant: "destructive",
      });
      return;
    }

    setDeploying(true);
    try {
      const { definitions, updatedDrafts } =
        await prepareAchievementDefinitions();
      setDrafts(updatedDrafts);

      const result = await achievementService.deployAchievementCell({
        signer,
        protocolCell,
        achievements: definitions,
      });

      toast({
        title: "Achievement cell deployed",
        description: `Tx: ${formatHash(
          result?.txHash ?? ""
        )} · Type ID: ${formatHash(result?.typeId ?? "")}`,
      });

      setDrafts([createDraft()]);
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
    achievementService,
    achievementTypeCodeHash,
    draftEvaluations,
    hasValidEntries,
    isWalletConnected,
    loadStatus,
    prepareAchievementDefinitions,
    protocolCell,
    protocolTypeHash,
    signer,
    status,
    toast,
  ]);

  const handleAppend = useCallback(async () => {
    if (!status?.found) {
      toast({
        title: "Achievements cell not found",
        description: "Deploy the achievements cell before adding new entries.",
        variant: "destructive",
      });
      return;
    }

    if (!hasValidEntries) {
      toast({
        title: "No achievements prepared",
        description: "Add at least one achievement before updating the cell.",
        variant: "destructive",
      });
      return;
    }

    if (!isWalletConnected || !signer) {
      toast({
        title: "Wallet required",
        description: "Connect an admin wallet to append achievements.",
        variant: "destructive",
      });
      return;
    }

    if (!protocolCell || !protocolTypeHash) {
      toast({
        title: "Protocol cell unavailable",
        description:
          "Deploy and load the protocol cell before updating achievements.",
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

    if (!achievementService) {
      toast({
        title: "Achievement service not available",
        description:
          "Achievement service is not available. Please try again later.",
        variant: "destructive",
      });
      return;
    }

    setAppending(true);
    try {
      const { definitions, updatedDrafts } =
        await prepareAchievementDefinitions(onChainAchievements);
      setDrafts(updatedDrafts);

      const txHash = await achievementService.updateAchievementCell({
        signer,
        protocolCell,
        protocolTypeHash: ccc.hexFrom(protocolTypeHash) as ccc.Hex,
        achievements: definitions,
      });

      toast({
        title: "Achievements updated",
        description: `Tx: ${formatHash(txHash)}`,
      });

      setDrafts([createDraft()]);
      await loadStatus();
    } catch (error) {
      log.error("Failed to append achievements", error);
      toast({
        title: "Update failed",
        description:
          error instanceof Error ? error.message : "Unknown error occurred.",
        variant: "destructive",
      });
    } finally {
      setAppending(false);
    }
  }, [
    achievementService,
    draftEvaluations,
    hasValidEntries,
    isWalletConnected,
    loadStatus,
    onChainAchievements,
    prepareAchievementDefinitions,
    protocolCell,
    protocolTypeHash,
    signer,
    status,
    toast,
  ]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Achievements Cell Status</CardTitle>
            <CardDescription>
              Monitor the achievements cell connected to the current protocol
              and confirm it is registered.
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
                    Type hash
                  </span>
                  <span className="break-all">{status.typeHash}</span>
                </div>
                <div>
                  <span className="block text-[0.65rem] uppercase text-muted-foreground">
                    Connected type ID
                  </span>
                  <span className="break-all">{status.typeId}</span>
                </div>
                <div>
                  <span className="block text-[0.65rem] uppercase text-muted-foreground">
                    Connected protocol key
                  </span>
                  <span className="break-all">{status.protocolKey}</span>
                </div>
                <div className="md:col-span-2">
                  <span className="block text-[0.65rem] uppercase text-muted-foreground">
                    Protocol config registration
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      className={
                        isActiveCellRegistered
                          ? "bg-green-100 text-green-800"
                          : "bg-amber-100 text-amber-800"
                      }
                    >
                      {isActiveCellRegistered ? "Registered" : "Not in config"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {isActiveCellRegistered
                        ? "Listed in protocol_config.achievement_type_hashes."
                        : `Add ${status.typeId} to protocol_config.achievement_type_hashes.`}
                    </span>
                  </div>
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

              {!isActiveCellRegistered && (
                <Alert variant="destructive">
                  <AlertTitle>Protocol config update required</AlertTitle>
                  <AlertDescription>
                    <span>
                      Achievements cell type hash {status.typeHash} is not
                      listed in
                      <code>protocol_config.achievement_type_hashes</code>. Add
                      it to ensure dashboards and clients can detect this cell.
                    </span>
                    {protocolAchievementTypeHashes.length > 0 && (
                      <span className="mt-1 block">
                        Registered values:{" "}
                        {protocolAchievementTypeHashes.join(", ")}
                      </span>
                    )}
                  </AlertDescription>
                </Alert>
              )}

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
                      const metadata =
                        nevent && nevent.startsWith("nevent1")
                          ? resolvedMetadata.get(nevent)
                          : null;

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
                          {metadata?.loading && (
                            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Loading metadata...
                            </div>
                          )}
                          {metadata?.error && (
                            <p className="mt-2 text-xs text-red-500">
                              {metadata.error}
                            </p>
                          )}
                          {metadata?.content && (
                            <div
                              className="mt-2 text-xs text-muted-foreground prose prose-sm max-w-none"
                              dangerouslySetInnerHTML={{
                                __html: metadata.content,
                              }}
                            />
                          )}
                          {!metadata &&
                            nevent &&
                            nevent.startsWith("nevent1") && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Metadata stored off-chain.
                              </p>
                            )}
                          {!nevent && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              No metadata reference.
                            </p>
                          )}
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
          <CardTitle>Manage Achievements</CardTitle>
          <CardDescription>
            Draft new achievements to append to the active achievements cell.
            Deploy a new cell only when one is not yet connected.
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

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              {status?.found
                ? `New achievements will be appended to type hash ${status.typeHash}.`
                : "Draft achievements and deploy a new cell if one is not available."}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={handleAppend}
                disabled={
                  appending ||
                  deploying ||
                  !hasValidEntries ||
                  !isWalletConnected ||
                  !signer ||
                  deploymentUnavailable ||
                  missingProtocolCell ||
                  !status?.found ||
                  statusLoading
                }
              >
                {appending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Updating
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    Add achievements to cell
                  </>
                )}
              </Button>
              {!status?.found && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleDeploy}
                  disabled={
                    deploying ||
                    appending ||
                    !hasValidEntries ||
                    !isWalletConnected ||
                    !signer ||
                    deploymentUnavailable ||
                    missingProtocolCell
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
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
