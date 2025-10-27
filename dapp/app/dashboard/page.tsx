"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ccc } from "@ckb-ccc/connector-react";
import { CampaignData, type CampaignDataLike } from "ssri-ckboost/types";
import { Navigation } from "@/components/navigation";
import { AchievementsSection } from "@/components/dashboard/achievements-section";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Trophy,
  Target,
  Users,
  TrendingUp,
  Calendar,
  CheckCircle,
  Shield,
  Settings,
  UserCog,
  FileText,
  Activity,
  Clock,
  Coins,
} from "lucide-react";
import { createScopedLogger, formatDateConsistent } from "ssri-ckboost";
import { useProtocol } from "@/lib/providers/protocol-provider";
import { useUser } from "@/lib/providers/user-provider";
import { useCampaigns } from "@/lib";
import { extractTypeIdFromCampaignCell } from "@/lib/ckb/campaign-cells";
import type { UserSubmissionRecordLike } from "ssri-ckboost/types";
import { udtRegistry } from "@/lib/services/udt-registry";
import { extractIdentityDisplayName } from "@/lib/utils/identity";

const log = createScopedLogger("DashboardPage");

interface SubmissionDisplayEntry {
  key: string;
  campaignTypeId: string;
  campaignTitle: string;
  questId: number;
  questTitle: string;
  points: number;
  status: "pending" | "approved";
  submissionTimestamp: number | null;
  deadlineTimestamp: number | null;
}

const shorten = (
  value: string | null | undefined,
  head = 8,
  tail = 4
): string => {
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
  } catch (error) {
    log.warn("Failed to normalise hex value", { value, error });
    return null;
  }
};

const toMillis = (
  value: number | bigint | string | undefined | null
): number | null => {
  if (value === undefined || value === null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  // Heuristic: values greater than year 3000 in seconds will already be ms
  return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
};

const readUdtAmount = (data: ccc.Hex): bigint => {
  if (!data || data === "0x" || data.length < 34) {
    return 0n;
  }
  const slice = data.slice(0, 34);
  const bytes = ccc.bytesFrom(slice);
  return ccc.numLeFromBytes(bytes);
};

const formatPoints = (
  value: number | bigint | string | undefined | null
): string => {
  if (value === undefined || value === null) return "0";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return numeric.toLocaleString();
};

const buildSubmissionEntries = (
  submissions: UserSubmissionRecordLike[] | undefined,
  campaignMap: Map<string, CampaignDataLike>,
  userTypeId: string | null
): SubmissionDisplayEntry[] => {
  if (!submissions || submissions.length === 0) return [];

  return submissions.flatMap((submission, index) => {
    const campaignTypeId = normalizeHex(submission.campaign_type_id);
    if (!campaignTypeId) {
      return [];
    }

    const campaignData = campaignMap.get(campaignTypeId.toLowerCase());
    const questId = Number(submission.quest_id);
    const quest = campaignData?.quests?.find(
      (item) => Number(item.quest_id) === questId
    );

    const acceptedIds = quest?.accepted_submission_user_type_ids || [];
    const isApproved = userTypeId
      ? acceptedIds.some(
          (candidate) =>
            normalizeHex(candidate)?.toLowerCase() === userTypeId.toLowerCase()
        )
      : false;

    const questTitle = quest?.metadata?.title || `Quest #${questId}`;
    const campaignTitle = campaignData?.metadata?.title || "Unknown campaign";
    const points = Number(quest?.points ?? 0);
    const submissionTimestamp = toMillis(
      Number(submission.submission_timestamp)
    );
    const deadlineTimestamp = toMillis(Number(quest?.completion_deadline));

    return [
      {
        key: `${campaignTypeId}:${questId}:${index}`,
        campaignTypeId,
        campaignTitle,
        questId,
        questTitle,
        points,
        status: isApproved ? "approved" : "pending",
        submissionTimestamp,
        deadlineTimestamp,
      },
    ];
  });
};

const getActivityIcon = (status: "pending" | "approved") => {
  if (status === "approved") {
    return <CheckCircle className="w-4 h-4 text-green-600" />;
  }
  return <Clock className="w-4 h-4 text-blue-600" />;
};

const formatActivityText = (entry: SubmissionDisplayEntry): string => {
  if (entry.status === "approved") {
    return `Quest "${entry.questTitle}" approved (+${entry.points} points)`;
  }
  return `Quest "${entry.questTitle}" awaiting review`;
};

export default function Dashboard() {
  const {
    userAddress,
    isAdmin,
    isEndorser,
    protocolData,
    protocolCell,
    error: protocolError,
    isLoading: protocolLoading,
  } = useProtocol();
  const signer = ccc.useSigner();
  const { client } = ccc.useCcc();
  const {
    currentUserData,
    currentUserTypeId,
    isLoading: userLoading,
    error: userError,
  } = useUser();
  const {
    campaigns,
    isLoading: campaignsLoading,
    error: campaignsError,
  } = useCampaigns();

  const [pointsBalance, setPointsBalance] = useState<bigint | null>(null);
  const [tokenBalances, setTokenBalances] = useState<
    Array<{
      key: string;
      symbol: string;
      formatted: string;
      raw: bigint;
      scriptHash: string;
      isPoints: boolean;
    }>
  >([]);
  const [tokenBalancesLoading, setTokenBalancesLoading] = useState(false);

  const displayName = useMemo(() => {
    const identityName = extractIdentityDisplayName(
      currentUserData?.verification_data?.identity_verification_data
    );
    if (identityName) {
      return identityName;
    }
    if (userAddress) {
      return userAddress;
    }
    if (currentUserTypeId) {
      return currentUserTypeId;
    }
    return "Unknown user";
  }, [currentUserData, userAddress, currentUserTypeId]);

  const isVerified = useMemo(() => {
    if (!currentUserData) return false;
    const telegramId = Number(
      currentUserData.verification_data?.telegram_personal_chat_id || 0
    );
    const identityBytes =
      currentUserData.verification_data?.identity_verification_data || "";
    return (
      telegramId > 0 ||
      (typeof identityBytes === "string" && identityBytes.length > 0)
    );
  }, [currentUserData]);

  const campaignMap = useMemo(() => {
    const map = new Map<string, CampaignDataLike>();
    campaigns.forEach((cell) => {
      try {
        const typeId = extractTypeIdFromCampaignCell(cell);
        if (!typeId) {
          return;
        }
        const campaignData = CampaignData.decode(
          cell.outputData
        ) as CampaignDataLike;
        map.set(typeId.toLowerCase(), campaignData);
      } catch (error) {
        log.warn("Failed to decode campaign data", error);
      }
    });
    return map;
  }, [campaigns]);

  const submissionEntries = useMemo(
    () =>
      buildSubmissionEntries(
        currentUserData?.submission_records,
        campaignMap,
        currentUserTypeId
      ),
    [currentUserData, campaignMap, currentUserTypeId]
  );

  const approvedSubmissions = useMemo(
    () => submissionEntries.filter((entry) => entry.status === "approved"),
    [submissionEntries]
  );
  const pendingSubmissions = useMemo(
    () => submissionEntries.filter((entry) => entry.status === "pending"),
    [submissionEntries]
  );
  const campaignsParticipated = useMemo(() => {
    const unique = new Set(
      submissionEntries.map((entry) => entry.campaignTypeId.toLowerCase())
    );
    return unique.size;
  }, [submissionEntries]);

  const upcomingDeadlines = useMemo(() => {
    const now = Date.now();
    return pendingSubmissions
      .filter(
        (entry) => entry.deadlineTimestamp && entry.deadlineTimestamp > now
      )
      .sort((a, b) => a.deadlineTimestamp! - b.deadlineTimestamp!)
      .slice(0, 5);
  }, [pendingSubmissions]);

  const recentActivity = useMemo(() => {
    return [...submissionEntries]
      .filter((entry) => entry.submissionTimestamp)
      .sort((a, b) => b.submissionTimestamp! - a.submissionTimestamp!)
      .slice(0, 6);
  }, [submissionEntries]);

  useEffect(() => {
    if (!signer || !client || !protocolCell || !protocolData) {
      setPointsBalance(null);
      setTokenBalances([]);
      return;
    }

    let cancelled = false;

    const loadTokenBalances = async () => {
      setTokenBalancesLoading(true);
      try {
        const protocolTypeScript = protocolCell.cellOutput.type;
        if (!protocolTypeScript) {
          if (!cancelled) {
            setPointsBalance(0n);
            setTokenBalances([]);
          }
          return;
        }

        const protocolTypeHash = protocolTypeScript.hash();
        const lockScript = (await signer.getRecommendedAddressObj()).script;

        const gatherAmountForScript = async (
          script: ccc.Script
        ): Promise<bigint> => {
          let total = 0n;
          const collector = client.findCells({
            script: lockScript,
            scriptType: "lock" as const,
            scriptSearchMode: "exact" as const,
            filter: {
              script,
            },
            withData: true,
          });

          for await (const cell of collector) {
            total += readUdtAmount(cell.outputData as ccc.Hex);
          }

          return total;
        };

        const balancesMap = new Map<
          string,
          { raw: bigint; script: ccc.Script; isPoints: boolean }
        >();

        const scriptHashes = protocolData.protocol_config?.script_code_hashes;
        const pointsCodeHash =
          scriptHashes?.ckb_boost_points_udt_type_code_hash;

        if (pointsCodeHash) {
          const pointsScript = ccc.Script.from({
            codeHash: pointsCodeHash,
            hashType: "type" as ccc.HashType,
            args: protocolTypeHash,
          });
          const amount = await gatherAmountForScript(pointsScript);
          const hash = pointsScript.hash().toLowerCase();
          balancesMap.set(hash, {
            raw: amount,
            script: pointsScript,
            isPoints: true,
          });
          if (!cancelled) {
            setPointsBalance(amount);
          }
        } else if (!cancelled) {
          setPointsBalance(0n);
        }

        const acceptedUdts = scriptHashes?.accepted_udt_type_scripts ?? [];

        for (const scriptLike of acceptedUdts) {
          try {
            const script = ccc.Script.from(scriptLike);
            const amount = await gatherAmountForScript(script);
            const hash = script.hash().toLowerCase();
            const existing = balancesMap.get(hash);
            if (existing) {
              balancesMap.set(hash, {
                ...existing,
                raw: amount,
              });
            } else if (amount > 0n) {
              balancesMap.set(hash, {
                raw: amount,
                script,
                isPoints: false,
              });
            }
          } catch (error) {
            log.warn("Failed to process accepted UDT script", error);
          }
        }

        if (!cancelled) {
          const entries: Array<{
            key: string;
            symbol: string;
            formatted: string;
            raw: bigint;
            scriptHash: string;
            isPoints: boolean;
          }> = [];

          balancesMap.forEach((value, hash) => {
            const scriptHash = hash;
            const tokenInfo = udtRegistry.getTokenByScriptHash(scriptHash);
            const symbol = value.isPoints
              ? "Points"
              : tokenInfo?.symbol ?? shorten(scriptHash, 6, 6);
            let formatted: string;
            if (value.isPoints) {
              formatted = value.raw.toLocaleString();
            } else if (tokenInfo) {
              formatted = udtRegistry.formatAmount(value.raw, tokenInfo);
            } else {
              formatted = value.raw.toString();
            }

            if (value.isPoints || value.raw > 0n) {
              entries.push({
                key: scriptHash,
                symbol,
                formatted,
                raw: value.raw,
                scriptHash,
                isPoints: value.isPoints,
              });
            }
          });

          entries.sort((a, b) => {
            if (a.isPoints !== b.isPoints) {
              return a.isPoints ? -1 : 1;
            }
            if (a.raw === b.raw) {
              return a.symbol.localeCompare(b.symbol);
            }
            return a.raw > b.raw ? -1 : 1;
          });

          setTokenBalances(entries);
        }
      } catch (error) {
        log.warn("Failed to load user token balances", error);
        if (!cancelled) {
          setTokenBalances([]);
          setPointsBalance((prev) => prev ?? 0n);
        }
      } finally {
        if (!cancelled) {
          setTokenBalancesLoading(false);
        }
      }
    };

    loadTokenBalances();

    return () => {
      cancelled = true;
    };
  }, [signer, client, protocolCell, protocolData]);

  const loading = userLoading || campaignsLoading || protocolLoading;
  const combinedError = userError || campaignsError || protocolError;
  const pointsBalanceDisplay = useMemo(() => {
    if (!userAddress) {
      return "—";
    }
    if (pointsBalance === null) {
      return tokenBalancesLoading ? "—" : "0";
    }
    return pointsBalance.toLocaleString();
  }, [userAddress, pointsBalance, tokenBalancesLoading]);

  const [questFilter, setQuestFilter] = useState<"pending" | "approved">(
    "pending"
  );

  const renderQuestList = (
    entries: SubmissionDisplayEntry[],
    status: "pending" | "approved"
  ) => {
    if (loading) {
      return (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="h-20 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse"
            />
          ))}
        </div>
      );
    }

    if (entries.length === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          <Target className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>
            {status === "pending"
              ? "No quests waiting for review"
              : "No approved quests yet"}
          </p>
          <Link href="/">
            <Button className="mt-4">Browse Campaigns</Button>
          </Link>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {entries.map((entry) => {
          const submittedAt = entry.submissionTimestamp
            ? formatDateConsistent(new Date(entry.submissionTimestamp))
            : "Unknown";
          const deadlineDate = entry.deadlineTimestamp
            ? formatDateConsistent(new Date(entry.deadlineTimestamp))
            : null;
          let deadlineBadge: React.ReactNode = null;
          if (deadlineDate) {
            const daysLeft = Math.max(
              0,
              Math.ceil(
                (entry.deadlineTimestamp! - Date.now()) / (1000 * 60 * 60 * 24)
              )
            );
            deadlineBadge = (
              <Badge variant={daysLeft <= 3 ? "destructive" : "secondary"}>
                {daysLeft}d left
              </Badge>
            );
          }

          return (
            <div key={entry.key} className="border rounded-lg p-4 space-y-4">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-base">
                    {entry.questTitle}
                  </h3>
                  <div className="text-sm text-muted-foreground">
                    Campaign: {entry.campaignTitle}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Submitted {submittedAt}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      entry.status === "approved" ? "secondary" : "outline"
                    }
                    className={
                      entry.status === "approved"
                        ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200"
                        : "border-blue-300 text-blue-600 dark:border-blue-500 dark:text-blue-200"
                    }
                  >
                    {entry.status === "approved"
                      ? "Approved"
                      : "Pending Review"}
                  </Badge>
                  {deadlineBadge}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Points reward</span>
                  <span className="font-semibold">
                    {formatPoints(entry.points)} pts
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>Quest #{entry.questId}</span>
                  {deadlineDate && <span>Deadline {deadlineDate}</span>}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <Progress
                  value={entry.status === "approved" ? 100 : 40}
                  className="h-2 w-3/4"
                />
                <Link
                  href={`/campaign/${entry.campaignTypeId}/quest/${entry.questId}`}
                >
                  <Button variant="outline" size="sm">
                    View Quest
                  </Button>
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-green-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <Navigation />

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-7xl mx-auto">
          <div className="mb-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="text-4xl">🎯</div>
                  <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                    Welcome back, {displayName}
                  </h1>
                </div>
                <p className="text-lg text-muted-foreground">
                  Track your submissions and monitor quest approvals in real
                  time.
                </p>
              </div>

              {!isVerified && userAddress && (
                <Link href="/identity">
                  <Button className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-600 text-white">
                    <Shield className="w-4 h-4" />
                    Verify Identity
                  </Button>
                </Link>
              )}
            </div>

            {(isAdmin || isEndorser) && (
              <Card className="mb-6 bg-gradient-to-r from-orange-50 to-red-50 border-orange-200 dark:from-orange-900/20 dark:to-red-900/20 dark:border-orange-800">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-orange-800 dark:text-orange-200">
                    <Settings className="w-5 h-5" />
                    Admin Quick Access
                  </CardTitle>
                  <CardDescription className="text-sm text-orange-900/80 dark:text-orange-100/70">
                    Jump to the management tools that match your current
                    permissions.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    {isAdmin && (
                      <div className="rounded-lg border border-orange-200 bg-white/70 p-4 shadow-sm dark:border-orange-800/60 dark:bg-orange-950/30">
                        <div className="flex items-start gap-3">
                          <Shield className="w-5 h-5 text-orange-700 dark:text-orange-200" />
                          <div>
                            <h3 className="font-semibold text-orange-900 dark:text-orange-100">
                              Platform Administration
                            </h3>
                            <p className="text-sm text-orange-800/80 dark:text-orange-100/70">
                              Manage protocol-wide settings and approvals.
                            </p>
                          </div>
                        </div>
                        <div className="mt-4">
                          <Link href="/platform-admin">
                            <Button
                              variant="outline"
                              className="w-full justify-start bg-white/80 text-orange-900 hover:bg-orange-100 dark:bg-transparent dark:text-orange-100"
                            >
                              <Settings className="w-4 h-4 mr-2" />
                              Platform Admin Dashboard
                            </Button>
                          </Link>
                        </div>
                      </div>
                    )}

                    {(isAdmin || isEndorser) && (
                      <div className="rounded-lg border border-orange-200 bg-white/70 p-4 shadow-sm dark:border-orange-800/60 dark:bg-orange-950/30">
                        <div className="flex items-start gap-3">
                          <UserCog className="w-5 h-5 text-orange-700 dark:text-orange-200" />
                          <div>
                            <h3 className="font-semibold text-orange-900 dark:text-orange-100">
                              Campaign Administration
                            </h3>
                            <p className="text-sm text-orange-800/80 dark:text-orange-100/70">
                              Review quests, manage teams, and track tipping.
                            </p>
                          </div>
                        </div>
                        <div className="mt-4">
                          <Link href="/campaign-admin">
                            <Button
                              variant="outline"
                              className="w-full justify-start bg-white/80 text-orange-900 hover:bg-orange-100 dark:bg-transparent dark:text-orange-100"
                            >
                              <UserCog className="w-4 h-4 mr-2" />
                              Campaign Admin Dashboard
                            </Button>
                          </Link>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {combinedError && (
            <Card className="mb-8 border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-800">
              <CardContent className="py-4">
                <div className="text-sm text-red-700 dark:text-red-200">
                  {combinedError}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Points Balance
                </CardTitle>
                <Trophy className="h-4 w-4 text-yellow-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{pointsBalanceDisplay}</div>
                <p className="text-xs text-muted-foreground">
                  On-chain Points UDT balance
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Approved Quests
                </CardTitle>
                <CheckCircle className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {approvedSubmissions.length}
                </div>
                <p className="text-xs text-muted-foreground">
                  {pendingSubmissions.length} pending review
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Pending Reviews
                </CardTitle>
                <Activity className="h-4 w-4 text-blue-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {pendingSubmissions.length}
                </div>
                <p className="text-xs text-muted-foreground">
                  Waiting for campaign managers
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Campaigns Joined
                </CardTitle>
                <Users className="h-4 w-4 text-purple-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {campaignsParticipated}
                </div>
                <p className="text-xs text-muted-foreground">
                  Unique campaigns contributed
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2">
              <Card>
                <CardHeader className="flex flex-col gap-4">
                  <div className="flex items-center gap-2">
                    <Target className="w-5 h-5 text-blue-600" />
                    <CardTitle>Your Quests</CardTitle>
                  </div>
                  <Tabs
                    value={questFilter}
                    onValueChange={(value) =>
                      setQuestFilter(value as "pending" | "approved")
                    }
                  >
                    <TabsList>
                      <TabsTrigger value="pending">
                        Pending Review ({pendingSubmissions.length})
                      </TabsTrigger>
                      <TabsTrigger value="approved">
                        Approved ({approvedSubmissions.length})
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="pending" className="mt-4">
                      {renderQuestList(pendingSubmissions, "pending")}
                    </TabsContent>
                    <TabsContent value="approved" className="mt-4">
                      {renderQuestList(approvedSubmissions, "approved")}
                    </TabsContent>
                  </Tabs>
                </CardHeader>
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Coins className="w-5 h-5 text-purple-600" />
                    Token Balances
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!userAddress ? (
                    <div className="text-sm text-muted-foreground">
                      Connect your wallet to view balances.
                    </div>
                  ) : tokenBalancesLoading ? (
                    <div className="space-y-3">
                      {Array.from({ length: 3 }).map((_, index) => (
                        <div
                          key={index}
                          className="h-10 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse"
                        />
                      ))}
                    </div>
                  ) : tokenBalances.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      No token balances found.
                    </div>
                  ) : (
                    tokenBalances.map((token) => (
                      <div
                        key={token.key}
                        className="flex items-center justify-between"
                      >
                        <div className="flex flex-col">
                          <span className="font-medium">{token.symbol}</span>
                          {!token.isPoints && (
                            <span className="text-xs text-muted-foreground">
                              {shorten(token.scriptHash, 6, 6)}
                            </span>
                          )}
                        </div>
                        <span className="font-semibold">{token.formatted}</span>
                      </div>
                    ))
                  )}
                  <div className="text-xs text-muted-foreground">
                    Balances are calculated from on-chain UDT cells held by your
                    wallet.
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-orange-600" />
                    Upcoming Deadlines
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {upcomingDeadlines.length === 0 ? (
                    <div className="text-center py-4 text-muted-foreground text-sm">
                      No upcoming deadlines
                    </div>
                  ) : (
                    upcomingDeadlines.map((entry) => {
                      const deadline = entry.deadlineTimestamp
                        ? formatDateConsistent(
                            new Date(entry.deadlineTimestamp)
                          )
                        : "Unknown";
                      const daysLeft = entry.deadlineTimestamp
                        ? Math.max(
                            0,
                            Math.ceil(
                              (entry.deadlineTimestamp - Date.now()) /
                                (1000 * 60 * 60 * 24)
                            )
                          )
                        : null;

                      return (
                        <div
                          key={`deadline-${entry.key}`}
                          className="flex items-center justify-between p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg"
                        >
                          <div>
                            <div className="font-medium text-sm">
                              {entry.questTitle}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Due {deadline}
                            </div>
                          </div>
                          {daysLeft !== null && (
                            <Badge
                              variant={
                                daysLeft <= 3 ? "destructive" : "secondary"
                              }
                            >
                              {daysLeft}d left
                            </Badge>
                          )}
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-blue-600" />
                    Recent Activity
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {recentActivity.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      No submissions yet. Complete a quest to see it here.
                    </div>
                  ) : (
                    recentActivity.map((entry) => (
                      <div
                        key={`activity-${entry.key}`}
                        className="flex items-start gap-3"
                      >
                        {getActivityIcon(entry.status)}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm">
                            {formatActivityText(entry)}
                          </div>
                          {entry.submissionTimestamp && (
                            <div className="text-xs text-muted-foreground">
                              {formatDateConsistent(
                                new Date(entry.submissionTimestamp)
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="mt-8">
            <AchievementsSection />
          </div>
        </div>
      </main>
    </div>
  );
}
