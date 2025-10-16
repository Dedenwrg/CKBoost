"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ccc } from "@ckb-ccc/connector-react";
import {
  Award,
  Calendar,
  ExternalLink,
  Medal,
  Coins,
  ShieldCheck,
  Star,
} from "lucide-react";
import { ckboost } from "ssri-ckboost";
import { Navigation } from "@/components/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useCampaigns } from "@/lib/providers/campaign-provider";
import { CampaignData } from "ssri-ckboost/types";
import { extractTypeIdFromCampaignCell } from "@/lib/ckb/campaign-cells";
import { extractIdentityDisplayName } from "@/lib/utils/identity";
import { udtRegistry, type UDTToken } from "@/lib/services/udt-registry";

type PointsMintTransactionPayload = {
  txHash: string;
  blockNumber: string | null;
  txIndex: string | null;
  netPoints: string;
  outputs: Array<{ index: number; amount: string }>;
  inputs: Array<{ index: number; amount: string }>;
};

type PointsMintTransaction = PointsMintTransactionPayload & {
  timestamp: number | null;
};

type PointsMintResponse = {
  transactions: PointsMintTransactionPayload[];
};

type UserDataType = ReturnType<typeof ckboost.types.UserData.decode>;

export interface ProfileContentProps {
  context: "self" | "address";
  isLoading: boolean;
  loadError: string | null;
  userData: UserDataType | null;
  userTypeId: ccc.Hex | null;
  fallbackAddress?: string | null;
}

const shorten = (value: string | null | undefined, head = 8, tail = 6) => {
  if (!value) return "Unknown";
  if (value.length <= head + tail) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
};

const normalizeHex = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") return value;
  try {
    if (
      typeof value === "object" &&
      ArrayBuffer.isView(value as ArrayBufferView)
    ) {
      return ccc.hexFrom(value as ArrayLike<number>);
    }
    return ccc.hexFrom(ccc.bytesFrom(value as ccc.BytesLike));
  } catch {
    return null;
  }
};

const decodeSubmissionContent = (content: unknown): string | null => {
  if (!content) return null;
  if (typeof content === "string") {
    if (content.startsWith("0x")) {
      try {
        const decoded = new TextDecoder().decode(ccc.bytesFrom(content));
        return decoded.trim() || null;
      } catch {
        return content;
      }
    }
    return content.trim() || null;
  }
  if (
    typeof content === "object" &&
    ArrayBuffer.isView(content as ArrayBufferView)
  ) {
    try {
      return new TextDecoder().decode(content as Uint8Array);
    } catch {
      return null;
    }
  }
  return null;
};

const formatTimestamp = (
  value: number | bigint | string | null | undefined
): string => {
  if (value === undefined || value === null) return "Unknown";
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "Unknown";
  const millis = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  return new Date(millis).toLocaleString();
};

const formatPointsAmount = (points: ccc.NumLike | undefined | null): string => {
  try {
    const value = points ? BigInt(ccc.numFrom(points)) : 0n;
    return value.toLocaleString();
  } catch {
    return "0";
  }
};

const formatTimestampFromMillis = (value: number | null): string | null => {
  if (!value || Number.isNaN(value) || value <= 0) return null;
  return new Date(value).toLocaleString();
};

const numToBigInt = (value: unknown): bigint => {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0n;
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return 0n;
    try {
      if (trimmed.startsWith("0x") || trimmed.startsWith("-0x")) {
        return BigInt(trimmed);
      }
      return BigInt(trimmed);
    } catch {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        return BigInt(Math.trunc(numeric));
      }
      return 0n;
    }
  }

  try {
    const numeric = ccc.numFrom(value as ccc.NumLike);
    if (typeof numeric === "bigint") return numeric;
    if (typeof numeric === "number") {
      if (!Number.isFinite(numeric)) return 0n;
      return BigInt(Math.trunc(numeric));
    }
    const maybeToString = (numeric as unknown as { toString?: () => string })
      ?.toString;
    if (typeof maybeToString === "function") {
      return numToBigInt(maybeToString.call(numeric));
    }
  } catch {
    if (
      value &&
      typeof value === "object" &&
      "toString" in (value as Record<string, unknown>) &&
      typeof (value as { toString: () => string }).toString === "function"
    ) {
      try {
        return numToBigInt((value as { toString: () => string }).toString());
      } catch {
        return 0n;
      }
    }
  }

  return 0n;
};

const formatBigIntAmount = (value: bigint): string => {
  try {
    return value.toLocaleString();
  } catch {
    return value.toString();
  }
};

const formatNumberStringWithSeparators = (value: string): string => {
  const [wholePart, fractionalPart] = value.split(".");
  const hasNegative = wholePart.startsWith("-");
  const numericWhole = hasNegative ? wholePart.slice(1) : wholePart;
  const withSeparators = numericWhole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const formattedWhole = hasNegative ? `-${withSeparators}` : withSeparators;
  return fractionalPart && fractionalPart.length > 0
    ? `${formattedWhole}.${fractionalPart}`
    : formattedWhole;
};

const formatTokenAmount = (value: bigint, token: UDTToken | null): string => {
  if (token) {
    try {
      const formatted = udtRegistry.formatAmount(value, token);
      return formatNumberStringWithSeparators(formatted);
    } catch (error) {
      console.warn("Failed to format token amount", token.symbol, error);
    }
  }

  return formatBigIntAmount(value);
};

type RewardCategory = "quest" | "tipping" | "achievement" | "other";

type TokenRewardDetail = {
  symbol: string;
  amount: bigint;
  scriptHash: string | null;
  token: UDTToken | null;
};

type RewardEventDetail = {
  id: string;
  type: RewardCategory;
  title: string;
  subtitle?: string | null;
  link?: string | null;
  points: bigint;
  tokenRewards: TokenRewardDetail[];
};

type RewardTableRow = {
  txHash: string;
  blockNumber: string | null;
  formattedTimestamp: string;
  explorerUrl: string;
  events: RewardEventDetail[];
  totalPoints: bigint;
  totalTokens: TokenRewardDetail[];
  timestampValue: number;
};

const rewardCategoryStyles: Record<
  RewardCategory,
  { label: string; className: string }
> = {
  quest: {
    label: "Quest",
    className:
      "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200",
  },
  tipping: {
    label: "Tipping",
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200",
  },
  achievement: {
    label: "Achievement",
    className:
      "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200",
  },
  other: {
    label: "Reward",
    className:
      "bg-slate-100 text-slate-700 dark:bg-slate-600/30 dark:text-slate-200",
  },
};

export function ProfileContent({
  context,
  isLoading: externalLoading,
  loadError: externalError,
  userData,
  userTypeId,
  fallbackAddress,
}: ProfileContentProps) {
  const { client } = ccc.useCcc();
  const {
    campaigns,
    isLoading: campaignsLoading,
    error: campaignsError,
  } = useCampaigns();

  const isLoading = externalLoading || campaignsLoading;
  const loadError = externalError || campaignsError;
  const normalizedFallbackAddress = fallbackAddress || null;
  const [pointsTransactions, setPointsTransactions] = useState<
    PointsMintTransaction[]
  >([]);
  const [pointsLoading, setPointsLoading] = useState(false);
  const [pointsError, setPointsError] = useState<string | null>(null);
  const explorerBaseUrl =
    process.env.NEXT_PUBLIC_CKB_NETWORK === "mainnet"
      ? "https://explorer.nervos.org/transaction/"
      : "https://pudge.explorer.nervos.org/transaction/";

  const campaignMap = useMemo(() => {
    const map = new Map<
      string,
      {
        title: string;
        quests: Record<
          number,
          {
            title: string;
            points: bigint;
            tokens: TokenRewardDetail[];
          }
        >;
      }
    >();

    campaigns.forEach((cell) => {
      try {
        const typeId = extractTypeIdFromCampaignCell(cell);
        if (!typeId) return;
        const data = CampaignData.decode(cell.outputData);
        const quests: Record<
          number,
          {
            title: string;
            points: bigint;
            tokens: TokenRewardDetail[];
          }
        > = {};

        (data.quests || []).forEach((quest) => {
          const questId = Number(quest.quest_id);
          try {
            const questPoints = numToBigInt(quest.points ?? 0);
            const tokenRewards: TokenRewardDetail[] = [];

            (quest.rewards_on_completion || []).forEach((assetList) => {
              (assetList?.udt_assets || []).forEach((udtAsset) => {
                const amount = numToBigInt(udtAsset.amount ?? 0);
                if (amount === 0n) {
                  return;
                }

                try {
                  const script = ccc.Script.from(udtAsset.udt_script);
                  const scriptHash = script.hash().toLowerCase();
                  const tokenInfo =
                    udtRegistry.getTokenByScriptHash(scriptHash) ?? null;
                  const symbol = tokenInfo?.symbol ?? "UDT";

                  tokenRewards.push({
                    symbol,
                    amount,
                    scriptHash,
                    token: tokenInfo,
                  });
                } catch (tokenError) {
                  console.warn(
                    "Failed to derive UDT reward for profile",
                    tokenError
                  );
                  tokenRewards.push({
                    symbol: "UDT",
                    amount,
                    scriptHash: null,
                    token: null,
                  });
                }
              });
            });

            quests[questId] = {
              title: quest.metadata?.title || `Quest #${questId}`,
              points: questPoints,
              tokens: tokenRewards,
            };
          } catch (questError) {
            console.warn(
              "Failed to derive quest rewards for profile",
              questError
            );
            quests[questId] = {
              title: quest.metadata?.title || `Quest #${questId}`,
              points: numToBigInt(quest.points ?? 0),
              tokens: [],
            };
          }
        });

        map.set(typeId.toLowerCase(), {
          title: data.metadata?.title || "Unknown campaign",
          quests,
        });
      } catch (error) {
        console.warn("Failed to decode campaign cell for profile", error);
      }
    });

    return map;
  }, [campaigns]);

  const displayName = useMemo(() => {
    const identityName = extractIdentityDisplayName(
      userData?.verification_data?.identity_verification_data
    );
    if (identityName) {
      return identityName;
    }
    if (normalizedFallbackAddress) {
      return normalizedFallbackAddress;
    }
    if (userTypeId) {
      return userTypeId;
    }
    return "Unknown user";
  }, [normalizedFallbackAddress, userData, userTypeId]);

  const secondaryIdentifier = useMemo(() => {
    const candidate =
      normalizedFallbackAddress && normalizedFallbackAddress.trim().length > 0
        ? normalizedFallbackAddress
        : userTypeId ?? null;
    if (!candidate) return null;
    if (candidate === displayName) return null;
    return candidate;
  }, [displayName, normalizedFallbackAddress, userTypeId]);

  const telegramVerified = useMemo(() => {
    const value = userData?.verification_data?.telegram_personal_chat_id;
    if (value === undefined || value === null) return false;
    try {
      const numeric = BigInt(ccc.numFrom(value));
      return numeric > 0n;
    } catch {
      return false;
    }
  }, [userData]);

  const submissionEntries = useMemo(() => {
    if (!userData) return [];
    return [...(userData.submission_records || [])]
      .map((record, index) => {
        const campaignTypeId = normalizeHex(record.campaign_type_id);
        const questId = Number(record.quest_id);
        const submissionTimestamp = Number(record.submission_timestamp ?? 0);

        const campaignInfo = campaignTypeId
          ? campaignMap.get(campaignTypeId.toLowerCase())
          : undefined;

        const questInfo = campaignInfo?.quests?.[questId];
        const submissionContent = decodeSubmissionContent(
          record.submission_content
        );

        return {
          key: `${campaignTypeId ?? "unknown"}:${questId}:${index}`,
          campaignTypeId,
          campaignTitle: campaignInfo?.title || "Unknown campaign",
          questId,
          questTitle: questInfo?.title || `Quest #${questId}`,
          submissionTimestamp,
          submissionContent,
          points: questInfo?.points ?? 0n,
        };
      })
      .sort((a, b) => b.submissionTimestamp - a.submissionTimestamp);
  }, [userData, campaignMap]);

  useEffect(() => {
    if (!normalizedFallbackAddress) {
      setPointsTransactions([]);
      setPointsError(null);
      setPointsLoading(false);
      return;
    }

    let cancelled = false;

    const loadTransactions = async () => {
      setPointsLoading(true);
      setPointsError(null);

      try {
        const params = new URLSearchParams({
          address: normalizedFallbackAddress,
          limit: "50",
        });

        const response = await fetch(
          `/.netlify/functions/reward-history?${params.toString()}`
        );

        if (!response.ok) {
          const message = await response.text();
          throw new Error(message || "Failed to load reward transactions");
        }

        const data = (await response.json()) as PointsMintResponse;
        const transactions = data.transactions ?? [];

        if (transactions.length === 0) {
          if (!cancelled) {
            setPointsTransactions([]);
          }
          return;
        }

        let timestampMap = new Map<string, number>();

        if (client) {
          const blocks = Array.from(
            new Set(
              transactions
                .map((tx) => tx.blockNumber)
                .filter((bn): bn is string => Boolean(bn))
            )
          );

          if (blocks.length > 0) {
            const results = await Promise.all(
              blocks.map(async (bn) => {
                try {
                  const header = await client.getHeaderByNumber(BigInt(bn));
                  if (!header || header.timestamp === undefined) {
                    return null;
                  }
                  const rawTimestamp =
                    typeof header.timestamp === "bigint"
                      ? header.timestamp
                      : ccc.numFrom(header.timestamp ?? 0);
                  const numeric =
                    typeof rawTimestamp === "bigint"
                      ? Number(rawTimestamp)
                      : Number(rawTimestamp ?? 0);
                  return { block: bn, timestamp: numeric } as const;
                } catch (error) {
                  console.warn(
                    "Failed to load block header for reward transaction",
                    bn,
                    error
                  );
                  return null;
                }
              })
            );

            timestampMap = new Map(
              results
                .filter((item): item is { block: string; timestamp: number } =>
                  Boolean(item && item.timestamp)
                )
                .map((item) => [item.block, item.timestamp])
            );
          }
        }

        const withTimestamps: PointsMintTransaction[] = transactions.map(
          (tx) => ({
            ...tx,
            timestamp: tx.blockNumber
              ? timestampMap.get(tx.blockNumber) ?? null
              : null,
          })
        );

        if (!cancelled) {
          setPointsTransactions(withTimestamps);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to fetch reward transactions", error);
          setPointsTransactions([]);
          setPointsError(
            error instanceof Error
              ? error.message
              : "Failed to load reward transactions"
          );
        }
      } finally {
        if (!cancelled) {
          setPointsLoading(false);
        }
      }
    };

    loadTransactions();

    return () => {
      cancelled = true;
    };
  }, [normalizedFallbackAddress, client]);

  const rewardRows = useMemo<RewardTableRow[]>(() => {
    if (pointsTransactions.length === 0) return [];

    const transactionsAscending = [...pointsTransactions].sort((a, b) => {
      const aTime = a.timestamp ?? (a.blockNumber ? Number(a.blockNumber) : 0);
      const bTime = b.timestamp ?? (b.blockNumber ? Number(b.blockNumber) : 0);
      return aTime - bTime;
    });

    const submissionsAscending = [...submissionEntries].sort(
      (a, b) => a.submissionTimestamp - b.submissionTimestamp
    );

    let submissionCursor = 0;
    const rows: RewardTableRow[] = [];

    transactionsAscending.forEach((tx) => {
      const events: RewardEventDetail[] = [];
      const tokenTotals = new Map<string, TokenRewardDetail>();
      let remainingPoints = numToBigInt(tx.netPoints);

      const timestampLabel =
        formatTimestampFromMillis(tx.timestamp ?? null) ??
        (tx.blockNumber ? `Block #${tx.blockNumber}` : "Unknown");

      while (
        submissionCursor < submissionsAscending.length &&
        remainingPoints > 0n
      ) {
        const submission = submissionsAscending[submissionCursor];
        const campaignKey = submission.campaignTypeId?.toLowerCase();
        const questDetails = campaignKey
          ? campaignMap.get(campaignKey)?.quests?.[submission.questId]
          : undefined;

        const questPoints = questDetails?.points ?? submission.points ?? 0n;

        if (questPoints <= 0n) {
          submissionCursor += 1;
          continue;
        }

        if (questPoints > remainingPoints) {
          break;
        }

        const questTokens = questDetails?.tokens ?? [];
        questTokens.forEach((token) => {
          const key = (token.scriptHash ?? `symbol:${token.symbol}`)
            .toLowerCase()
            .trim();
          const existing = tokenTotals.get(key);
          if (existing) {
            const shouldReplaceSymbol =
              existing.symbol === "UDT" && token.symbol !== "UDT";
            tokenTotals.set(key, {
              ...existing,
              symbol: shouldReplaceSymbol ? token.symbol : existing.symbol,
              amount: existing.amount + token.amount,
              token: existing.token ?? token.token ?? null,
            });
          } else {
            tokenTotals.set(key, {
              symbol: token.symbol,
              amount: token.amount,
              scriptHash: token.scriptHash,
              token: token.token ?? null,
            });
          }
        });

        events.push({
          id: `${tx.txHash}:${submission.key}`,
          type: "quest",
          title: questDetails?.title ?? submission.questTitle,
          subtitle: submission.campaignTitle,
          link: submission.campaignTypeId
            ? `/campaign/${submission.campaignTypeId}?quest=${submission.questId}`
            : null,
          points: questPoints,
          tokenRewards: questTokens.map((token) => ({ ...token })),
        });

        remainingPoints -= questPoints;
        submissionCursor += 1;
      }

      if (events.length === 0) {
        events.push({
          id: `${tx.txHash}:fallback`,
          type: "other",
          title: "Reward distribution",
          subtitle: null,
          link: null,
          points: remainingPoints,
          tokenRewards: [],
        });
      } else if (remainingPoints > 0n) {
        events.push({
          id: `${tx.txHash}:residual`,
          type: "other",
          title: "Additional reward",
          subtitle: null,
          link: null,
          points: remainingPoints,
          tokenRewards: [],
        });
      }

      const totalPoints = numToBigInt(tx.netPoints);
      const totalTokens = Array.from(tokenTotals.values());

      rows.push({
        txHash: tx.txHash,
        blockNumber: tx.blockNumber ?? null,
        formattedTimestamp: timestampLabel,
        explorerUrl: `${explorerBaseUrl}${tx.txHash}`,
        events,
        totalPoints,
        totalTokens,
        timestampValue:
          tx.timestamp ?? (tx.blockNumber ? Number(tx.blockNumber) : 0),
      });
    });

    return rows.sort((a, b) => b.timestampValue - a.timestampValue);
  }, [pointsTransactions, submissionEntries, campaignMap, explorerBaseUrl]);

  const totalPoints = formatPointsAmount(userData?.total_points_earned ?? 0);
  const totalSubmissions = userData?.submission_records?.length ?? 0;
  const lastActivity = formatTimestamp(userData?.last_activity_timestamp);
  const lookupIdentifier = normalizedFallbackAddress ?? userTypeId ?? null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-purple-50/60 to-white dark:from-gray-950 dark:via-gray-900 dark:to-gray-950">
      <Navigation />
      <main className="container mx-auto px-4 py-10 space-y-8">
        <header className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">
            Community Profile
          </h1>
          <p className="text-muted-foreground">
            Review on-chain identity, achievements, and contribution history.
          </p>
        </header>

        {isLoading ? (
          <div className="space-y-6">
            <Skeleton className="h-36 rounded-xl" />
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              <Skeleton className="h-32 rounded-xl" />
              <Skeleton className="h-32 rounded-xl" />
              <Skeleton className="h-32 rounded-xl" />
            </div>
            <Skeleton className="h-72 rounded-xl" />
          </div>
        ) : loadError ? (
          <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
            <CardHeader>
              <CardTitle className="text-red-600 dark:text-red-300">
                Unable to load profile
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {loadError}
            </CardContent>
          </Card>
        ) : !userData ? (
          <Card className="border-dashed border-2 border-purple-200 dark:border-purple-800 bg-white/70 dark:bg-gray-900/60">
            <CardHeader>
              <CardTitle>
                {context === "self"
                  ? "No profile data yet"
                  : "No profile data for this address"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-muted-foreground text-sm">
              <p>
                {context === "self"
                  ? "We could not find a user cell for your connected wallet. Submit a quest or complete a verification step to create your profile."
                  : `We could not find a user cell for ${
                      lookupIdentifier ?? "this address"
                    }. The participant might not have interacted with CKBoost yet.`}
              </p>
              {context === "self" ? (
                <div className="flex flex-wrap gap-3">
                  <Link href="/identity">
                    <Badge variant="secondary" className="px-3 py-1">
                      Go to Identity Center
                    </Badge>
                  </Link>
                  <Link href="/">
                    <Badge variant="outline" className="px-3 py-1">
                      Explore Campaigns
                    </Badge>
                  </Link>
                </div>
              ) : (
                <div className="flex flex-wrap gap-3">
                  <Link href="/">
                    <Badge variant="secondary" className="px-3 py-1">
                      Explore Campaigns
                    </Badge>
                  </Link>
                  <Link href="/leaderboard">
                    <Badge variant="outline" className="px-3 py-1">
                      View Leaderboard
                    </Badge>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            <Card className="overflow-hidden border-purple-200 dark:border-purple-800 shadow-sm">
              <CardHeader className="bg-gradient-to-r from-purple-600/90 to-indigo-600/90 text-white">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center text-xl font-semibold">
                      {displayName?.charAt(0)?.toUpperCase() ?? "?"}
                    </div>
                    <div>
                      <h2 className="text-2xl font-semibold leading-tight break-words">
                        {displayName}
                      </h2>
                      {secondaryIdentifier && (
                        <p className="text-sm text-white/80 break-words">
                          {secondaryIdentifier}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-sm">
                    {userTypeId && (
                      <Badge
                        variant="secondary"
                        className="bg-white/20 text-white break-words"
                      >
                        Type ID: {userTypeId}
                      </Badge>
                    )}
                    {telegramVerified ? (
                      <Badge
                        variant="secondary"
                        className="bg-emerald-500/80 text-white flex items-center gap-1"
                      >
                        <ShieldCheck className="w-4 h-4" />
                        Telegram verified
                      </Badge>
                    ) : (
                      <Badge
                        variant="secondary"
                        className="bg-yellow-400/80 text-gray-900"
                      >
                        Telegram pending
                      </Badge>
                    )}
                    <Badge
                      variant="secondary"
                      className="bg-white/20 text-white flex items-center gap-1"
                    >
                      <Calendar className="w-4 h-4" />
                      Last activity: {lastActivity}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-6 p-6 md:grid-cols-3">
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Total Points</p>
                  <div className="flex items-center gap-2 text-2xl font-semibold">
                    <Medal className="w-5 h-5 text-amber-500" />
                    {totalPoints}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Aggregated from approved quests and tipping rewards.
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Quests Submitted
                  </p>
                  <div className="flex items-center gap-2 text-2xl font-semibold">
                    <Award className="w-5 h-5 text-purple-500" />
                    {totalSubmissions}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Includes all submissions awaiting review and approved.
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Profile Progress
                  </p>
                  <div className="flex items-center gap-2 text-2xl font-semibold">
                    <Star className="w-5 h-5 text-indigo-500" />
                    {telegramVerified ? "Verified" : "In progress"}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Complete additional verification methods to unlock more
                    campaigns.
                  </p>
                </div>
              </CardContent>
            </Card>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold">Public Achievements</h3>
                <Badge variant="outline" className="flex items-center gap-1">
                  <Star className="w-4 h-4" />
                  Visible to campaign moderators
                </Badge>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Medal className="w-5 h-5 text-amber-500" />
                      Points Earned
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-2xl font-semibold">{totalPoints}</p>
                    <p className="text-xs text-muted-foreground">
                      Reflects total approved contributions across all
                      campaigns.
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Award className="w-5 h-5 text-purple-500" />
                      Active Campaigns
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-2xl font-semibold">
                      {
                        new Set(
                          submissionEntries
                            .map((entry) => entry.campaignTitle)
                            .filter(Boolean)
                        ).size
                      }
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Number of campaigns this user has contributed to.
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <ShieldCheck className="w-5 h-5 text-emerald-500" />
                      Verification Status
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex flex-wrap gap-2 text-sm">
                      <Badge
                        variant={telegramVerified ? "default" : "secondary"}
                        className="flex items-center gap-1"
                      >
                        Telegram
                        {telegramVerified ? " linked" : " pending"}
                      </Badge>
                      <Badge variant="outline">
                        Additional methods coming soon
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Verification unlocks advanced campaigns and community
                      trust badges.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </section>

            <Separator />

            {/* <section className="space-y-3"> */}
            {/* <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-purple-500" />
                  Contribution Log
                </h3>
                <p className="text-sm text-muted-foreground">
                  {submissionEntries.length} submission
                  {submissionEntries.length === 1 ? "" : "s"} recorded on-chain.
                </p>
              </div>

              <Card className="overflow-hidden border-gray-200 dark:border-gray-800">
                {submissionEntries.length === 0 ? (
                  <CardContent className="py-10 text-center text-sm text-muted-foreground">
                    No contributions tracked yet. Explore active campaigns and
                    share your work!
                  </CardContent>
                ) : (
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[180px]">Submitted</TableHead>
                          <TableHead>Campaign</TableHead>
                          <TableHead>Quest</TableHead>
                          <TableHead className="w-[120px]">Points</TableHead>
                          <TableHead>Notes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {submissionEntries.map((entry) => (
                          <TableRow key={entry.key}>
                            <TableCell className="font-medium">
                              {formatTimestamp(entry.submissionTimestamp)}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="font-medium">
                                  {entry.campaignTitle}
                                </span>
                                {entry.campaignTypeId && (
                                  <span className="text-xs text-muted-foreground">
                                    {shorten(entry.campaignTypeId)}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span>{entry.questTitle}</span>
                                <span className="text-xs text-muted-foreground">
                                  Quest #{entry.questId}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="px-3 py-1">
                                {formatBigIntAmount(entry.points)}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {entry.submissionContent ? (
                                <span className="line-clamp-2 text-sm">
                                  {entry.submissionContent}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground italic">
                                  No additional notes provided
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableCaption className="flex items-center gap-2">
                        <ExternalLink className="w-4 h-4" />
                        For raw submission payloads, view the associated user
                        cell history on a block explorer.
                      </TableCaption>
                    </Table>
                  </CardContent> */}
            {/* )} */}
            {/* </Card> */}
            {/* </section> */}

            <Separator />

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold flex items-center gap-2">
                  <Coins className="w-5 h-5 text-amber-500" />
                  Reward Transactions
                </h3>
                <p className="text-sm text-muted-foreground">
                  {rewardRows.length} reward
                  {rewardRows.length === 1 ? "" : "s"} detected on-chain.
                </p>
              </div>

              <Card className="overflow-hidden border-gray-200 dark:border-gray-800">
                {pointsLoading ? (
                  <CardContent className="space-y-4 p-6">
                    <Skeleton className="h-6 w-1/3" />
                    <Skeleton className="h-6 w-full" />
                    <Skeleton className="h-6 w-2/3" />
                  </CardContent>
                ) : pointsError ? (
                  <CardContent className="py-6 text-sm text-red-600 dark:text-red-400">
                    {pointsError}
                  </CardContent>
                ) : rewardRows.length === 0 ? (
                  <CardContent className="py-10 text-center text-sm text-muted-foreground">
                    No reward transactions recorded yet. Complete quests or
                    receive tips to start earning on-chain points.
                  </CardContent>
                ) : (
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[180px]">Earned</TableHead>
                          <TableHead className="min-w-[220px]">Event</TableHead>
                          <TableHead>Transaction</TableHead>
                          <TableHead className="text-right min-w-[200px]">
                            Rewards
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rewardRows.map((row) => (
                          <TableRow key={row.txHash}>
                            <TableCell className="font-medium">
                              {row.formattedTimestamp}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-2">
                                {row.events.map((event) => {
                                  const meta =
                                    rewardCategoryStyles[event.type] ??
                                    rewardCategoryStyles.other;

                                  return (
                                    <div
                                      key={event.id}
                                      className="flex items-start gap-2"
                                    >
                                      <Badge
                                        variant="secondary"
                                        className={`px-2 py-0.5 text-xs font-medium ${meta.className}`}
                                      >
                                        {meta.label}
                                      </Badge>
                                      <div className="flex flex-col text-sm">
                                        {event.link ? (
                                          <Link
                                            href={event.link}
                                            className="font-medium text-indigo-600 hover:underline dark:text-indigo-300"
                                          >
                                            {event.title}
                                          </Link>
                                        ) : (
                                          <span className="font-medium">
                                            {event.title}
                                          </span>
                                        )}
                                        {event.subtitle && (
                                          <span className="text-xs text-muted-foreground">
                                            {event.subtitle}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                <a
                                  href={row.explorerUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline break-all"
                                >
                                  <span>{row.txHash}</span>
                                  <ExternalLink className="w-4 h-4" />
                                </a>
                                {row.blockNumber && (
                                  <span className="text-xs text-muted-foreground">
                                    Block #{row.blockNumber}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex flex-wrap justify-end gap-2">
                                {row.totalPoints > 0n && (
                                  <Badge
                                    variant="outline"
                                    className="px-3 py-1"
                                  >
                                    +{formatBigIntAmount(row.totalPoints)}{" "}
                                    Points
                                  </Badge>
                                )}
                                {row.totalTokens.map((token) => (
                                  <Badge
                                    key={`${row.txHash}-${
                                      token.scriptHash ?? token.symbol
                                    }`}
                                    variant="secondary"
                                    className="px-3 py-1"
                                  >
                                    +
                                    {formatTokenAmount(
                                      token.amount,
                                      token.token
                                    )}{" "}
                                    {token.symbol}
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                )}
              </Card>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
