"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ccc } from "@ckb-ccc/connector-react";
import {
  Award,
  Calendar,
  ExternalLink,
  Medal,
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

export function ProfileContent({
  context,
  isLoading: externalLoading,
  loadError: externalError,
  userData,
  userTypeId,
  fallbackAddress,
}: ProfileContentProps) {
  const {
    campaigns,
    isLoading: campaignsLoading,
    error: campaignsError,
  } = useCampaigns();

  const isLoading = externalLoading || campaignsLoading;
  const loadError = externalError || campaignsError;
  const normalizedFallbackAddress = fallbackAddress || null;

  const campaignMap = useMemo(() => {
    const map = new Map<
      string,
      {
        title: string;
        quests: Record<number, { title: string; points: number }>;
      }
    >();

    campaigns.forEach((cell) => {
      try {
        const typeId = extractTypeIdFromCampaignCell(cell);
        if (!typeId) return;
        const data = CampaignData.decode(cell.outputData);
        const quests: Record<number, { title: string; points: number }> = {};
        (data.quests || []).forEach((quest) => {
          const questId = Number(quest.quest_id);
          quests[questId] = {
            title: quest.metadata?.title || `Quest #${questId}`,
            points: Number(quest.points ?? 0),
          };
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
          points: questInfo?.points ?? 0,
        };
      })
      .sort((a, b) => b.submissionTimestamp - a.submissionTimestamp);
  }, [userData, campaignMap]);

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

            <section className="space-y-3">
              <div className="flex items-center justify-between">
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
                                {entry.points.toLocaleString()}
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
