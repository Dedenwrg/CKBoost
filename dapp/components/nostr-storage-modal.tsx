/* eslint-disable react/no-unescaped-entities */
"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  Loader2,
  CheckCircle,
  XCircle,
  RefreshCw,
  ExternalLink,
  Cloud,
  Code,
  Eye,
  Copy,
  AlertCircle,
  Circle,
  AlertTriangle,
} from "lucide-react";
import { useNostrFetch } from "@/hooks/use-nostr-fetch";
import { createScopedLogger } from "ssri-ckboost";
import { isNostrSubmissionData } from "@/types/submission";

const log = createScopedLogger("NostrStorageModal");

interface TippingNostrPayload {
  format: string;
  version?: string;
  timestamp?: number;
  metadata?: {
    targetLockHash?: string;
    proposerLockHash?: string | null;
    contributionTitle?: string;
    shortDescription?: string;
    typeTags?: string[];
  };
  contentHtml: string;
}

type ContentHint = "image" | "html" | "text";

interface ItemPreviewPayload {
  content: string;
  metadata: Record<string, string>;
  parsed?: unknown;
  hint: ContentHint;
  quest?: unknown;
  tipping?: TippingNostrPayload | null;
}

const determineContentHint = (
  content: string,
  metadata: Record<string, string>,
  fallback?: ContentHint
): ContentHint => {
  if (!content) return fallback ?? "text";

  const typeTag = metadata?.type;
  if (typeTag === "cover_image") return "image";
  if (typeTag === "long_description") return "html";
  if (typeTag === "quest_content") return "text";

  const metaFormat = metadata?.["meta-format"] ?? metadata?.format;
  if (metaFormat === "html") return "html";

  const metaEncoding = metadata?.["meta-encoding"];
  if (metaEncoding && metaEncoding.toLowerCase().includes("image")) {
    return "image";
  }

  if (content.startsWith("data:image")) return "image";

  if (fallback && fallback !== "text") return fallback;

  const trimmed = content.trim();
  if (/<\/?[a-z][\s\S]*>/i.test(trimmed)) {
    return "html";
  }

  return fallback ?? "text";
};

const buildPreviewPayload = (
  content: string,
  metadata: Record<string, string>,
  fallbackHint?: ContentHint
): ItemPreviewPayload => {
  const normalizedMetadata = metadata ?? {};
  const hint = determineContentHint(content, normalizedMetadata, fallbackHint);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = undefined;
  }

  let quest: unknown;
  let tipping: TippingNostrPayload | null = null;

  if (parsed && isNostrSubmissionData(parsed)) {
    quest = parsed;
  } else if (parsed && typeof parsed === "object") {
    const payload = parsed as Partial<TippingNostrPayload>;
    if (
      payload &&
      payload.format === "ckboost-tipping-long-description" &&
      typeof payload.contentHtml === "string"
    ) {
      tipping = payload as TippingNostrPayload;
    }
  }

  return {
    content,
    metadata: normalizedMetadata,
    parsed,
    hint,
    quest,
    tipping,
  };
};

const hasHtmlTags = (value: string) => /<\/?[a-z][\s\S]*>/i.test(value);

const escapePlainText = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatTippingContentHtml = (raw: string | undefined | null) => {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (hasHtmlTags(trimmed)) {
    return trimmed;
  }

  const paragraphs = trimmed
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  if (paragraphs.length === 0) {
    return `<p>${escapePlainText(trimmed).replace(/\n+/g, "<br />")}</p>`;
  }

  return paragraphs
    .map((paragraph) => {
      const escaped = escapePlainText(paragraph);
      return `<p>${escaped.replace(/\n+/g, "<br />")}</p>`;
    })
    .join("");
};

type CachedPayloadMap = Record<
  string,
  { content: string; metadata: Record<string, string> }
>;

type QueueItem = {
  neventId: string;
  label?: string;
  contentHint?: ContentHint;
};

interface NostrStorageModalProps {
  isOpen: boolean;
  onClose: () => void;
  neventId: string | null;
  onConfirm: () => Promise<string | void>;
  mode: "storing" | "verifying";
  label?: string;
  contentHint?: ContentHint;
  queuePosition?: number;
  queueTotal?: number;
  queueItems?: QueueItem[];
  queueIndex?: number;
  cachedPayloads?: CachedPayloadMap;
}

export function NostrStorageModal({
  isOpen,
  onClose,
  neventId,
  onConfirm,
  mode,
  label,
  contentHint,
  queuePosition,
  queueTotal,
  queueItems = [],
  queueIndex = 0,
  cachedPayloads = {},
}: NostrStorageModalProps) {
  const { fetchSubmission } = useNostrFetch();
  const [status, setStatus] = useState<
    "storing" | "verifying" | "success" | "error"
  >("storing");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [verifiedContent, setVerifiedContent] = useState<string>("");
  const [verifiedMetadata, setVerifiedMetadata] = useState<
    Record<string, string>
  >({});
  const [retryCount, setRetryCount] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [txStatus, setTxStatus] = useState<
    "idle" | "submitting" | "submitted" | "error"
  >("idle");
  const [txError, setTxError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<string[]>([]);
  const [verifiedNeventId, setVerifiedNeventId] = useState<string | null>(null);
  const prevOpenRef = useRef(false);
  const [itemPayloads, setItemPayloads] = useState<
    Record<string, ItemPreviewPayload>
  >(() => {
    const initial: Record<string, ItemPreviewPayload> = {};
    for (const [key, value] of Object.entries(cachedPayloads || {})) {
      initial[key] = buildPreviewPayload(value.content, value.metadata);
    }
    return initial;
  });
  const prefetchingRef = useRef(new Set<string>());
  const [manualPreview, setManualPreview] = useState<{
    index: number;
    content: string;
    metadata: Record<string, string>;
    hint: ContentHint;
  } | null>(null);
  const [manualPreviewLoading, setManualPreviewLoading] = useState(false);
  const [manualPreviewError, setManualPreviewError] = useState<string | null>(
    null
  );

  const resolvedLabel = useMemo(() => {
    if (label) return label;
    if (queueItems[queueIndex]?.label) return queueItems[queueIndex]?.label;
    const typeTag = verifiedMetadata?.type;
    if (typeTag === "cover_image") return "Campaign Cover Image";
    if (typeTag === "long_description") return "Campaign Long Description";
    if (typeTag === "quest_content") return "Quest Content";
    return undefined;
  }, [label, queueItems, queueIndex, verifiedMetadata]);

  const queueSummary = useMemo(() => {
    if (queueItems.length > 0) {
      return queueItems;
    }
    if (resolvedLabel && neventId) {
      const cached = itemPayloads[neventId];
      return [
        {
          neventId,
          label: resolvedLabel,
          contentHint: cached?.hint,
        },
      ];
    }
    return [];
  }, [queueItems, resolvedLabel, neventId, itemPayloads]);

  const queueSize = queueSummary.length;

  const effectiveQueueIndex = useMemo(() => {
    if (queueSummary.length === 0) return 0;
    const idx = queueIndex ?? 0;
    return Math.max(0, Math.min(idx, queueSummary.length - 1));
  }, [queueSummary, queueIndex]);

  const parsedVerifiedContent = useMemo(() => {
    if (!verifiedContent) {
      return null;
    }

    try {
      return JSON.parse(verifiedContent) as unknown;
    } catch {
      return null;
    }
  }, [verifiedContent]);

  const questSubmissionData = useMemo(() => {
    if (!parsedVerifiedContent) {
      return null;
    }
    if (isNostrSubmissionData(parsedVerifiedContent)) {
      return parsedVerifiedContent;
    }
    return null;
  }, [parsedVerifiedContent]);

  const tippingSubmissionData = useMemo(() => {
    if (!parsedVerifiedContent || typeof parsedVerifiedContent !== "object") {
      return null;
    }

    const payload = parsedVerifiedContent as Partial<TippingNostrPayload>;
    if (
      payload &&
      payload.format === "ckboost-tipping-long-description" &&
      typeof payload.contentHtml === "string"
    ) {
      return payload as TippingNostrPayload;
    }

    return null;
  }, [parsedVerifiedContent]);

  useEffect(() => {
    if (
      status === "success" &&
      neventId &&
      verifiedContent &&
      verifiedMetadata
    ) {
      const payload = buildPreviewPayload(
        verifiedContent,
        verifiedMetadata,
        contentHint
      );
      setItemPayloads((prev) => ({ ...prev, [neventId]: payload }));
    }
  }, [status, neventId, verifiedContent, verifiedMetadata, contentHint]);

  useEffect(() => {
    for (const [key, value] of Object.entries(cachedPayloads || {})) {
      setItemPayloads((prev) => {
        if (prev[key]) return prev;
        const next = { ...prev };
        next[key] = buildPreviewPayload(value.content, value.metadata);
        return next;
      });
    }
  }, [cachedPayloads]);

  useEffect(() => {
    if (!isOpen) return;
    queueSummary.forEach((item, idx) => {
      if (idx === effectiveQueueIndex) return;
      if (itemPayloads[item.neventId]) return;
      if (prefetchingRef.current.has(item.neventId)) return;

      prefetchingRef.current.add(item.neventId);
      fetchSubmission(item.neventId)
        .then((result) => {
          if (result && result.content) {
            setItemPayloads((prev) => ({
              ...prev,
              [item.neventId]: buildPreviewPayload(
                result.content,
                result.metadata || {},
                item.contentHint as ContentHint | undefined
              ),
            }));
          }
        })
        .finally(() => {
          prefetchingRef.current.delete(item.neventId);
        });
    });
  }, [
    queueSummary,
    effectiveQueueIndex,
    itemPayloads,
    fetchSubmission,
    isOpen,
  ]);

  const effectiveHint = useMemo(
    () => determineContentHint(verifiedContent, verifiedMetadata, contentHint),
    [verifiedContent, verifiedMetadata, contentHint]
  );

  const manualParsedContent = useMemo(() => {
    if (!manualPreview) return null;
    try {
      return JSON.parse(manualPreview.content) as unknown;
    } catch {
      return null;
    }
  }, [manualPreview]);

  const manualQuestSubmissionData = useMemo(() => {
    if (!manualParsedContent) return null;
    if (isNostrSubmissionData(manualParsedContent)) {
      return manualParsedContent;
    }
    return null;
  }, [manualParsedContent]);

  const manualTippingSubmissionData = useMemo(() => {
    if (!manualParsedContent || typeof manualParsedContent !== "object") {
      return null;
    }

    const payload = manualParsedContent as Partial<TippingNostrPayload>;
    if (
      payload &&
      payload.format === "ckboost-tipping-long-description" &&
      typeof payload.contentHtml === "string"
    ) {
      return payload as TippingNostrPayload;
    }

    return null;
  }, [manualParsedContent]);

  const activePreview = useMemo(() => {
    if (manualPreview) {
      const labelFromQueue =
        queueSummary[manualPreview.index]?.label ??
        manualPreview.metadata?.type ??
        "Preview Item";

      return {
        index: manualPreview.index,
        content: manualPreview.content,
        metadata: manualPreview.metadata,
        hint: manualPreview.hint,
        label: labelFromQueue,
        quest: manualQuestSubmissionData,
        tipping: manualTippingSubmissionData,
        isManual: true,
      };
    }

    return {
      index: effectiveQueueIndex,
      content: verifiedContent,
      metadata: verifiedMetadata,
      hint: effectiveHint,
      label: resolvedLabel,
      quest: questSubmissionData,
      tipping: tippingSubmissionData,
      isManual: false,
    };
  }, [
    manualPreview,
    manualQuestSubmissionData,
    manualTippingSubmissionData,
    queueSummary,
    effectiveQueueIndex,
    verifiedContent,
    verifiedMetadata,
    effectiveHint,
    resolvedLabel,
    questSubmissionData,
    tippingSubmissionData,
  ]);

  const activeRawContent = manualPreview
    ? manualPreview.content
    : verifiedContent;
  const activeRawParsed = manualPreview
    ? manualParsedContent
    : parsedVerifiedContent;
  const activeMetadata = manualPreview
    ? manualPreview.metadata
    : verifiedMetadata;
  const hasPendingQueueItems =
    queueSummary.length > 0 && effectiveQueueIndex < queueSummary.length - 1;
  const currentQueueItem =
    queueSummary.length > 0 ? queueSummary[effectiveQueueIndex] : null;
  const hasCurrentPayload = currentQueueItem
    ? !!itemPayloads[currentQueueItem.neventId]
    : true;

  function renderPreviewContent(
    preview: {
      content: string;
      metadata: Record<string, string>;
      hint: "image" | "html" | "text";
      quest: typeof questSubmissionData | undefined;
      tipping: typeof tippingSubmissionData | undefined;
      label?: string;
    },
    image: boolean,
    html: boolean
  ) {
    if (preview.tipping) {
      return (
        <div className="space-y-4">
          <div className="rounded-lg border border-muted p-4 bg-gray-50 dark:bg-gray-800 space-y-2">
            <p className="text-sm font-semibold text-muted-foreground">
              Proposal Metadata
            </p>
            {preview.tipping.metadata?.contributionTitle && (
              <p className="text-sm">
                <span className="font-medium">Title:</span>{" "}
                {preview.tipping.metadata.contributionTitle}
              </p>
            )}
            {preview.tipping.metadata?.shortDescription && (
              <p className="text-sm">
                <span className="font-medium">Summary:</span>{" "}
                {preview.tipping.metadata.shortDescription}
              </p>
            )}
            {(preview.tipping.metadata?.typeTags?.length ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">
                Tags: {preview.tipping.metadata?.typeTags?.join(", ")}
              </p>
            )}
            {preview.tipping.metadata?.targetLockHash && (
              <p className="text-xs text-muted-foreground font-mono break-all">
                Recipient: {preview.tipping.metadata.targetLockHash}
              </p>
            )}
            {preview.tipping.metadata?.proposerLockHash && (
              <p className="text-xs text-muted-foreground font-mono break-all">
                Proposer: {preview.tipping.metadata.proposerLockHash}
              </p>
            )}
          </div>
          {preview.tipping.contentHtml ? (
            <div
              className="prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{
                __html: formatTippingContentHtml(preview.tipping.contentHtml),
              }}
            />
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400 italic">
              No detailed justification provided.
            </p>
          )}
        </div>
      );
    }

    if (preview.quest) {
      return (
        <div className="space-y-4">
          {preview.quest.subtasks.map((subtask, index) => (
            <div
              key={index}
              className="border rounded-lg p-3 bg-gray-50 dark:bg-gray-800"
            >
              <div className="mb-2 pb-2 border-b">
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  {subtask.title || `Subtask ${index + 1}`}
                </span>
                {subtask.description && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 block mt-1">
                    {subtask.description}
                  </span>
                )}
              </div>
              {subtask.response ? (
                <div
                  className="prose prose-sm dark:prose-invert max-w-none"
                  dangerouslySetInnerHTML={{ __html: subtask.response }}
                />
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                  No response provided
                </p>
              )}
            </div>
          ))}
        </div>
      );
    }

    if (image) {
      return (
        <div className="flex flex-col items-center gap-4">
          <img
            src={preview.content}
            alt={preview.label || "Nostr image"}
            className="max-h-[360px] w-auto rounded-lg border border-muted shadow"
          />
          <p className="text-xs text-muted-foreground">
            {preview.metadata["meta-encoding"]
              ? `Encoding: ${preview.metadata["meta-encoding"]}`
              : "Image data loaded from Nostr."}
          </p>
        </div>
      );
    }

    if (html) {
      return (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Rendered HTML content stored on Nostr.
          </p>
          <div
            className="prose prose-sm dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: preview.content }}
          />
        </div>
      );
    }

    return (
      <div className="text-center py-8 space-y-2">
        <AlertCircle className="w-8 h-8 text-yellow-500 mx-auto" />
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {preview.label
            ? `${preview.label} preview unavailable.`
            : "Unrecognised submission format."}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-500">
          Review the raw data tab for the original content.
        </p>
      </div>
    );
  }

  const getExplorerUrl = (hash: string | null) => {
    if (!hash) return null;
    const net = process.env.NEXT_PUBLIC_CKB_NETWORK || "mainnet";
    const base =
      net === "testnet"
        ? "https://pudge.explorer.nervos.org"
        : "https://explorer.nervos.org";
    return `${base}/transaction/${hash}`;
  };

  // Reset state only when the modal transitions from closed -> open
  useEffect(() => {
    if (isOpen && !prevOpenRef.current) {
      setStatus(mode === "storing" ? "storing" : "verifying");
      setErrorMessage("");
      setVerifiedContent("");
      setVerifiedMetadata({});
      setRetryCount(0);
      setTxStatus("idle");
      setTxError(null);
      setTxHash(null);
      setVerifiedNeventId(null);
      setOpenSections([]);
    }
    prevOpenRef.current = isOpen;
  }, [isOpen, mode]);

  useEffect(() => {
    setManualPreview(null);
    setManualPreviewLoading(false);
    setManualPreviewError(null);
  }, [neventId]);

  useEffect(() => {
    if (!isOpen) {
      setManualPreview(null);
      setManualPreviewLoading(false);
      setManualPreviewError(null);
      setItemPayloads({});
      setOpenSections([]);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setOpenSections((prev) => {
      if (queueSize > 1 && !prev.includes("queue")) {
        return [...prev, "queue"];
      }
      if (queueSize <= 1 && prev.includes("queue")) {
        return prev.filter((key) => key !== "queue");
      }
      return prev;
    });
  }, [isOpen, queueSize]);

  // Start verification when we have a nevent ID
  useEffect(() => {
    if (!isOpen || !neventId || mode !== "verifying") return;
    // If we've already verified this exact nevent, don't re-verify
    if (status === "success" && verifiedNeventId === neventId) return;
    // If user already started or finished submitting the tx, don't re-verify
    if (txStatus !== "idle") return;
    verifyStorage();
  }, [isOpen, neventId, mode, status, verifiedNeventId, txStatus]);

  // Removed auto-close guard to ensure the modal never closes automatically

  const verifyStorage = async () => {
    if (!neventId) return;

    // Avoid regressing to verifying if we already succeeded for this nevent
    if (status === "success" && verifiedNeventId === neventId) {
      return;
    }
    setStatus("verifying");
    setErrorMessage("");
    setVerifiedMetadata({});
    setVerifiedContent("");
    setVerifiedNeventId(null);
    setTxStatus("idle");
    setTxError(null);
    setTxHash(null);

    try {
      log.log("Verifying Nostr storage for:", neventId);

      // Try to fetch the submission from Nostr
      const result = await fetchSubmission(neventId);

      if (result && result.content) {
        log.log("✅ Successfully retrieved content from Nostr");
        setVerifiedContent(result.content);
        setVerifiedNeventId(neventId);
        setVerifiedMetadata(result.metadata || {});
        setStatus("success");
      } else {
        throw new Error("Content could not be retrieved from Nostr relays");
      }
    } catch (err) {
      log.error("Failed to verify Nostr storage:", err);
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Failed to retrieve content from Nostr"
      );
      setStatus("error");
    }
  };

  const handleRetry = async () => {
    setIsRetrying(true);
    setRetryCount((prev) => prev + 1);

    // Wait a bit before retrying to allow propagation
    await new Promise((resolve) => setTimeout(resolve, 2000));

    await verifyStorage();
    setIsRetrying(false);
  };

  const handlePreviewQueueItem = async (idx: number) => {
    const item = queueSummary[idx];
    if (!item) {
      return;
    }

    if (idx === effectiveQueueIndex) {
      setManualPreview(null);
      setManualPreviewError(null);
      return;
    }

    if (manualPreview?.index === idx) {
      setManualPreview(null);
      setManualPreviewError(null);
      setManualPreviewLoading(false);
      return;
    }

    setManualPreviewLoading(true);
    setManualPreviewError(null);
    try {
      const result = await fetchSubmission(item.neventId);
      if (!result || !result.content) {
        throw new Error("Content could not be retrieved from Nostr.");
      }
      const payload = buildPreviewPayload(
        result.content,
        result.metadata || {},
        item.contentHint
      );
      setItemPayloads((prev) => ({ ...prev, [item.neventId]: payload }));
      setManualPreview({
        index: idx,
        content: payload.content,
        metadata: payload.metadata,
        hint: payload.hint,
      });
      setManualPreviewError(null);
    } catch (err) {
      setManualPreviewError(
        err instanceof Error ? err.message : "Failed to load preview"
      );
    } finally {
      setManualPreviewLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (status !== "success") {
      setErrorMessage("Please verify storage before proceeding");
      return;
    }

    log.log("NostrStorageModal handleConfirm invoked", {
      status,
      hasPendingQueueItems,
      hasCurrentPayload,
      txStatus,
      queueLength: queueSummary.length,
      effectiveQueueIndex,
    });

    setManualPreview(null);
    setManualPreviewError(null);
    setManualPreviewLoading(false);
    setIsConfirming(true);
    setTxError(null);
    setTxHash(null);

    try {
      setTxStatus("submitting");
      const result = await onConfirm();
      log.log("NostrStorageModal handleConfirm onConfirm resolved", {
        resultType: typeof result,
        hasResult: !!result,
        hasPendingQueueItems,
      });
      if (typeof result === "string" && result.length > 0) {
        setTxHash(result);
        setTxStatus("submitted");
      } else {
        // Intermediate confirmation (e.g. additional campaign assets)
        setTxStatus("idle");
        if (!hasPendingQueueItems) {
          log.log(
            "NostrStorageModal handleConfirm closing modal after intermediate confirmation"
          );
          onClose();
        }
      }
      // When there are no further queue items, close the modal automatically.
      // Otherwise, the caller will reopen the modal with the next item.
    } catch (err) {
      log.error("Failed to confirm transaction:", err);
      const errorMsg =
        err instanceof Error ? err.message : "Failed to submit transaction";
      setTxError(errorMsg);
      setTxStatus("error");
      setErrorMessage(errorMsg);
    } finally {
      setIsConfirming(false);
    }
  };

  // Do not auto-close; user explicitly closes or clicks Finish

  const getStatusIcon = () => {
    switch (status) {
      case "storing":
      case "verifying":
        return <Loader2 className="w-5 h-5 animate-spin text-blue-500" />;
      case "success":
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case "error":
        return <XCircle className="w-5 h-5 text-red-500" />;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case "storing":
        return "Storing content on the Nostr network...";
      case "verifying":
        return "Verifying that the content is accessible on Nostr...";
      case "success":
        if (hasPendingQueueItems) {
          return "Current item verified. Continue with the remaining items.";
        }
        return queueSummary.length > 1
          ? "All items verified. You can proceed."
          : "Content successfully stored and verified.";
      case "error":
        return "Failed to verify storage";
      default:
        return "";
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[900px] lg:max-w-[1100px] xl:max-w-[1200px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="w-5 h-5" />
            Nostr Storage Verification
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Status Card */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                {getStatusIcon()}
                <div className="flex-1">
                  <p className="font-medium">{getStatusText()}</p>
                  {retryCount > 0 && (
                    <p className="text-sm text-muted-foreground">
                      Retry attempt: {retryCount}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Queue & storage details */}
          {queueSummary.length > 0 && (
            <Accordion
              type="multiple"
              value={openSections}
              onValueChange={(value: string[] | string) =>
                setOpenSections(
                  Array.isArray(value)
                    ? value
                    : value
                    ? [value]
                    : []
                )
              }
            >
              {queueSummary.length > 1 && (
                <AccordionItem value="queue">
                  <AccordionTrigger>
                    Items Awaiting Verification
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3">
                    {queueSummary.map((item, idx) => {
                      const hasPayload = !!itemPayloads[item.neventId];
                      const statusLabel =
                        idx < effectiveQueueIndex
                          ? "Verified"
                          : idx === effectiveQueueIndex
                          ? status === "success"
                            ? "Ready"
                            : "Verifying"
                          : hasPayload
                          ? "Fetched"
                          : "Pending";

                      const icon =
                        statusLabel === "Verified" ? (
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        ) : statusLabel === "Verifying" ? (
                          <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                        ) : statusLabel === "Ready" ? (
                          <Cloud className="w-4 h-4 text-blue-500" />
                        ) : statusLabel === "Fetched" ? (
                          <Eye className="w-4 h-4 text-indigo-500" />
                        ) : (
                          <Circle className="w-4 h-4 text-muted-foreground" />
                        );

                      const labelText = item.label || `Item ${idx + 1}`;
                      const isSelected = manualPreview?.index === idx;
                      const rowClasses = [
                        "flex items-center justify-between gap-3 rounded-lg border border-dashed border-muted/60 px-3 py-2 bg-muted/10",
                        isSelected
                          ? "border-blue-300 bg-blue-50 dark:bg-blue-950/30"
                          : "",
                      ];

                      return (
                        <div
                          key={`${item.neventId}-${idx}`}
                          className={rowClasses.join(" ").trim()}
                        >
                          <div className="flex items-center gap-2">
                            {icon}
                            <div>
                              <p className="text-sm font-medium text-foreground">
                                {labelText}
                              </p>
                              <p className="text-xs text-muted-foreground font-mono break-all">
                                {item.neventId}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-xs text-muted-foreground hover:text-foreground"
                              onClick={() =>
                                window.open(
                                  `https://njump.me/${item.neventId}`,
                                  "_blank"
                                )
                              }
                            >
                              <ExternalLink className="w-3 h-3 mr-1" />
                              View
                            </Button>
                            <span className="text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                              {statusLabel}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </AccordionContent>
                </AccordionItem>
              )}

              <AccordionItem value="details">
                <AccordionTrigger>Storage Details (optional)</AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-6">
                    {queueSummary.map((item, idx) => {
                      const labelText = item.label || `Item ${idx + 1}`;
                      const isCurrent = idx === effectiveQueueIndex;
                      const payload =
                        isCurrent && activePreview.content
                          ? {
                              content: activePreview.content,
                              metadata: activePreview.metadata,
                              hint: activePreview.hint,
                              quest: activePreview.quest,
                              tipping: activePreview.tipping,
                              parsed: activeRawParsed,
                            }
                          : itemPayloads[item.neventId];
                      const metadata = isCurrent
                        ? activeMetadata
                        : payload?.metadata || {};
                      const hint =
                        payload?.hint ||
                        (isCurrent ? activePreview.hint : "text");
                      const rawContent = isCurrent
                        ? activeRawContent
                        : payload?.content;
                      const rawParsed = isCurrent
                        ? activeRawParsed
                        : payload?.parsed;
                      const statusLabel =
                        idx < effectiveQueueIndex
                          ? "Verified"
                          : isCurrent
                          ? status === "success"
                            ? "Ready"
                            : "Verifying"
                          : payload?.content
                          ? "Fetched"
                          : "Pending";

                      return (
                        <Card
                          key={`${item.neventId}-${idx}`}
                          className="border-muted"
                        >
                          <CardHeader className="space-y-1">
                            <div className="flex items-center justify-between">
                              <div className="space-y-1">
                                <CardTitle className="text-sm font-semibold">
                                  {labelText}
                                </CardTitle>
                                <p className="text-xs text-muted-foreground font-mono break-all">
                                  {item.neventId}
                                </p>
                              </div>
                              <div className="text-right text-xs uppercase tracking-wide text-muted-foreground">
                                {statusLabel}
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <div className="flex flex-wrap items-center gap-2">
                              {!isCurrent && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handlePreviewQueueItem(idx)}
                                  disabled={
                                    manualPreviewLoading &&
                                    manualPreview?.index === idx
                                  }
                                >
                                  {manualPreviewLoading &&
                                  manualPreview?.index === idx ? (
                                    <>
                                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                      Fetching...
                                    </>
                                  ) : payload?.content ? (
                                    "Refetch"
                                  ) : (
                                    "Fetch Preview"
                                  )}
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  navigator.clipboard.writeText(item.neventId)
                                }
                              >
                                Copy ID
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  window.open(
                                    `https://njump.me/${item.neventId}`,
                                    "_blank"
                                  )
                                }
                              >
                                <ExternalLink className="w-4 h-4 mr-1" />
                                Open in njump
                              </Button>
                            </div>

                            {payload?.content ? (
                              <Tabs defaultValue="rendered" className="w-full">
                                <TabsList className="grid w-full grid-cols-2">
                                  <TabsTrigger value="rendered">
                                    <Eye className="w-4 h-4 mr-2" />
                                    Rendered
                                  </TabsTrigger>
                                  <TabsTrigger value="json">
                                    <Code className="w-4 h-4 mr-2" />
                                    Raw Data
                                  </TabsTrigger>
                                </TabsList>
                                <TabsContent value="rendered" className="mt-4">
                                  <div className="border rounded-lg p-4 max-h-[400px] overflow-auto bg-white dark:bg-gray-900 space-y-4">
                                    {renderPreviewContent(
                                      {
                                        content: payload.content,
                                        metadata,
                                        hint,
                                        quest:
                                          payload?.quest as typeof questSubmissionData,
                                        tipping:
                                          payload?.tipping as typeof tippingSubmissionData,
                                        label: labelText,
                                      },
                                      hint === "image",
                                      hint === "html"
                                    )}
                                  </div>
                                </TabsContent>
                                <TabsContent value="json" className="mt-4">
                                  <div className="relative">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="absolute top-2 right-2 z-10"
                                      onClick={() =>
                                        navigator.clipboard.writeText(
                                          rawParsed
                                            ? JSON.stringify(rawParsed, null, 2)
                                            : rawContent || ""
                                        )
                                      }
                                    >
                                      <Copy className="w-4 h-4" />
                                    </Button>
                                    <pre className="border rounded-lg p-4 max-h-96 overflow-auto bg-gray-50 dark:bg-gray-900 text-xs whitespace-pre-wrap break-words">
                                      <code className="block">
                                        {rawParsed
                                          ? JSON.stringify(rawParsed, null, 2)
                                          : rawContent}
                                      </code>
                                    </pre>
                                  </div>
                                </TabsContent>
                              </Tabs>
                            ) : (
                              <div className="space-y-2 rounded border border-dashed border-muted/60 bg-muted/10 p-4 text-sm text-muted-foreground">
                                <p>
                                  {isCurrent
                                    ? "Currently verifying this item on Nostr..."
                                    : "Content not yet retrieved from Nostr. Fetch a preview to view."}
                                </p>
                                {manualPreviewError &&
                                  manualPreview?.index === idx && (
                                    <p className="text-xs text-red-500">
                                      {manualPreviewError}
                                    </p>
                                  )}
                              </div>
                            )}

                            {Object.keys(metadata).length > 0 && (
                              <div className="space-y-2">
                                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                  Nostr Tags
                                </p>
                                <div className="grid gap-2 md:grid-cols-2">
                                  {Object.entries(metadata).map(
                                    ([key, value]) => (
                                      <div
                                        key={`${item.neventId}-${key}`}
                                        className="flex items-center justify-between gap-2 rounded border border-muted bg-muted/20 px-3 py-2"
                                      >
                                        <span className="text-[11px] font-mono uppercase text-muted-foreground">
                                          {key}
                                        </span>
                                        <span className="text-[11px] font-mono break-all text-foreground/80">
                                          {value}
                                        </span>
                                      </div>
                                    )
                                  )}
                                </div>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}
          {/* Transaction Status Display */}
          {txStatus !== "idle" && (
            <Card
              className={
                txStatus === "submitted"
                  ? "border-green-200 dark:border-green-800"
                  : txStatus === "error"
                  ? "border-red-200 dark:border-red-800"
                  : "border-blue-200 dark:border-blue-800"
              }
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  {txStatus === "submitting" && (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Submitting Transaction...
                    </>
                  )}
                  {txStatus === "submitted" && (
                    <>
                      <CheckCircle className="w-4 h-4 text-green-600" />
                      Transaction Submitted!
                    </>
                  )}
                  {txStatus === "error" && (
                    <>
                      <XCircle className="w-4 h-4 text-red-600" />
                      Transaction Failed
                    </>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {txStatus === "submitted" && (
                  <div className="space-y-3">
                    <p className="text-sm text-green-600 dark:text-green-400">
                      Transaction submitted to the blockchain successfully.
                    </p>
                    {txHash && (
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">
                          Transaction Hash:
                        </label>
                        <div className="flex items-center gap-2">
                          <code className="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded flex-1 overflow-x-auto font-mono">
                            {txHash}
                          </code>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              navigator.clipboard.writeText(txHash)
                            }
                          >
                            <Copy className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    )}
                    {getExplorerUrl(txHash) && (
                      <div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs"
                          onClick={() =>
                            window.open(getExplorerUrl(txHash)!, "_blank")
                          }
                        >
                          <ExternalLink className="w-3 h-3 mr-1" /> View on
                          Explorer
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                {txStatus === "error" && txError && (
                  <div className="space-y-2">
                    <p className="text-sm text-red-600 dark:text-red-400">
                      {txError}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Please try again or contact support if the issue persists.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Error Display */}
          {status === "error" && txStatus === "idle" && (
            <Alert className="border-red-200 bg-red-50 dark:bg-red-900/20">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-800 dark:text-red-200">
                {errorMessage}
                <div className="mt-2 text-sm">
                  This may be due to:
                  <ul className="list-disc list-inside mt-1">
                    <li>Slow relay propagation (try waiting a moment)</li>
                    <li>Relay connection issues</li>
                    <li>Event not accepted by relays</li>
                  </ul>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* External links moved into Storage Details accordion */}
        </div>

        <DialogFooter className="flex gap-2">
          {txStatus !== "submitted" ? (
            <>
              <Button
                variant="outline"
                onClick={onClose}
                disabled={
                  isConfirming || isRetrying || txStatus === "submitting"
                }
              >
                Cancel
              </Button>
              {status === "error" && (
                <Button
                  variant="outline"
                  onClick={handleRetry}
                  disabled={isRetrying}
                >
                  {isRetrying ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Retrying...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Retry Verification
                    </>
                  )}
                </Button>
              )}
              {status === "success" && (
                <Button
                  onClick={handleConfirm}
                  disabled={
                    isConfirming ||
                    txStatus === "submitting" ||
                    !hasCurrentPayload
                  }
                  className="bg-green-600 hover:bg-green-700"
                >
                  {isConfirming || txStatus === "submitting" ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Submitting Transaction...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Confirm & Submit
                    </>
                  )}
                </Button>
              )}
            </>
          ) : (
            <Button
              onClick={onClose}
              className="bg-primary hover:bg-primary/90"
            >
              Finish
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
