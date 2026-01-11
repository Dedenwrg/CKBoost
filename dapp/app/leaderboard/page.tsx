"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ccc } from "@ckb-ccc/connector-react";import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Crown,
  Trophy,
  Medal,
  Award,
  Star,
  RefreshCw,
  Activity,
  Clock,
  Info,
} from "lucide-react";
import { InMemoryLeaderboardCache, LeaderboardService } from "@/lib";
import type {
  LeaderboardEntry,
  LeaderboardStats,
  PointsMintRecord,
} from "@/lib";
import { useProtocol } from "@/lib/providers/protocol-provider";
import { createScopedLogger } from "ssri-ckboost";
import { PageLoading } from "@/components/ui/page-loading";

const log = createScopedLogger("LeaderboardPage");

const formatPoints = (value: string): string => {
  try {
    return BigInt(value).toLocaleString();
  } catch (error) {
    log.warn("Failed to format points value", { value, error });
    return value;
  }
};

const shorten = (value: string, head = 10, tail = 6): string => {
  if (!value || value.length <= head + tail) {
    return value;
  }
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
};

const getAvatarLabel = (identifier: string): string => {
  const sanitized = identifier.replace(/^0x/, "");
  const alphanumeric = sanitized.replace(/[^a-zA-Z0-9]/g, "");
  const label = alphanumeric.slice(0, 2) || sanitized.slice(0, 2) || "??";
  return label.toUpperCase();
};

const getRankIcon = (rank: number) => {
  if (rank === 1) return <Crown className="w-5 h-5 text-yellow-500" />;
  if (rank === 2) return <Trophy className="w-5 h-5 text-gray-400" />;
  if (rank === 3) return <Medal className="w-5 h-5 text-amber-600" />;
  return <Award className="w-5 h-5 text-purple-500" />;
};

const calculateTotals = (stats: LeaderboardStats | null) => {
  if (!stats) {
    return {
      totalMinted: 0n,
      uniqueRecipients: 0,
      transactionsTracked: 0,
    };
  }

  const totalMinted = stats.mintedTransactions.reduce(
    (acc, record) => acc + BigInt(record.totalMinted),
    0n
  );

  const recipientHashes = new Set<string>();
  stats.mintedTransactions.forEach((record) => {
    record.recipients.forEach((recipient) => {
      recipientHashes.add(recipient.lockHash.toLowerCase());
    });
  });

  return {
    totalMinted,
    uniqueRecipients: recipientHashes.size,
    transactionsTracked: stats.mintedTransactions.length,
  };
};

const getIdentifier = (entry: LeaderboardEntry): string => {
  return entry.address ?? entry.lockHash;
};

const getRecipientIdentifier = (
  record: PointsMintRecord["recipients"][number]
) => {
  return record.address ?? record.lockHash;
};

export default function Leaderboard() {
  const { client } = ccc.useCcc();
  const signer = ccc.useSigner();
  const {
    protocolCell,
    isLoading: isProtocolLoading,
    error: protocolError,
    userAddress,
  } = useProtocol();

  const cacheRef = useRef(new InMemoryLeaderboardCache());
  const [stats, setStats] = useState<LeaderboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [userLockHash, setUserLockHash] = useState<string | null>(null);

  const service = useMemo(() => {
    if (!client || !protocolCell) {
      return null;
    }

    return new LeaderboardService({
      client,
      protocolCell,
      cache: cacheRef.current,
    });
  }, [client, protocolCell]);

  useEffect(() => {
    let cancelled = false;

    const loadLockHash = async () => {
      if (!signer) {
        if (!cancelled) {
          setUserLockHash(null);
        }
        return;
      }

      try {
        const addressObj = await signer.getRecommendedAddressObj();
        const hash = addressObj.script.hash().toLowerCase();
        if (!cancelled) {
          setUserLockHash(hash);
        }
      } catch (err) {
        log.warn("Failed to derive user lock hash", err);
        if (!cancelled) {
          setUserLockHash(null);
        }
      }
    };

    loadLockHash();

    return () => {
      cancelled = true;
    };
  }, [signer]);

  useEffect(() => {
    if (!service) {
      return;
    }

    let cancelled = false;

    const loadStats = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await service.collectLeaderboardStats();
        if (!cancelled) {
          setStats(result);
          setLastUpdated(new Date());
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to load leaderboard";
        log.error("Leaderboard load failed", err);
        if (!cancelled) {
          setError(message);
          setStats(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadStats();

    return () => {
      cancelled = true;
    };
  }, [service]);

  const handleRefresh = useCallback(async () => {
    if (!service) {
      return;
    }

    setIsRefreshing(true);
    setError(null);

    try {
      const result = await service.collectLeaderboardStats();
      setStats(result);
      setLastUpdated(new Date());
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to refresh leaderboard";
      log.error("Leaderboard refresh failed", err);
      setError(message);
    } finally {
      setIsRefreshing(false);
    }
  }, [service]);

  const leaderboardEntries = useMemo(() => stats?.totals ?? [], [stats]);

  const leaderboardTop = useMemo(
    () => leaderboardEntries.slice(0, 10),
    [leaderboardEntries]
  );

  const recentTransactions = useMemo(() => {
    if (!stats) {
      return [] as PointsMintRecord[];
    }

    return [...stats.mintedTransactions].reverse().slice(0, 5);
  }, [stats]);

  const totalsSummary = useMemo(() => calculateTotals(stats), [stats]);

  const participantCount = leaderboardEntries.length;
  const protocolUnavailable = !protocolCell && !isProtocolLoading;
  const combinedError = error ?? (protocolUnavailable ? protocolError : null);
  const isInitialLoading = !stats && (isLoading || isProtocolLoading);

  const currentUserIndex = useMemo(() => {
    if (!leaderboardEntries.length) {
      return -1;
    }

    const addressLower = userAddress?.toLowerCase();
    const lockLower = userLockHash?.toLowerCase();

    return leaderboardEntries.findIndex((entry) => {
      if (addressLower && entry.address?.toLowerCase() === addressLower) {
        return true;
      }
      if (lockLower && entry.lockHash.toLowerCase() === lockLower) {
        return true;
      }
      return false;
    });
  }, [leaderboardEntries, userAddress, userLockHash]);

  const currentUserEntry =
    currentUserIndex >= 0 ? leaderboardEntries[currentUserIndex] : null;

  const currentUserRank = currentUserEntry ? currentUserIndex + 1 : null;
  const currentUserPoints = currentUserEntry
    ? formatPoints(currentUserEntry.totalMinted)
    : "0";
  const currentUserLabel = currentUserEntry
    ? shorten(getIdentifier(currentUserEntry), 14, 6)
    : userAddress
    ? shorten(userAddress, 14, 6)
    : "Wallet not connected";

  if (isInitialLoading) {
    return (
      <PageLoading
        title="Loading Leaderboard"
        description="Aggregating live Points minting stats from CKBoost validators."
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-green-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="text-4xl">🏆</div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                Leaderboard
              </h1>
            </div>
            <p className="text-lg text-muted-foreground">
              Track Points mints across the CKBoost protocol and celebrate the
              most active contributors.
            </p>
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

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <Card className="border-2 border-purple-200 bg-purple-50 dark:bg-purple-900/20 dark:border-purple-800">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Star className="w-5 h-5 text-purple-600" />
                    Your Position
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {isInitialLoading ? (
                    <div className="h-16 rounded-lg bg-white/70 dark:bg-gray-800/70 animate-pulse" />
                  ) : !userAddress ? (
                    <div className="text-sm text-muted-foreground">
                      Connect your wallet to track your Points minting progress.
                    </div>
                  ) : currentUserEntry ? (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="text-2xl font-bold text-purple-600">
                          #{currentUserRank}
                        </div>
                        <div>
                          <div className="font-medium">{currentUserLabel}</div>
                          <div className="text-sm text-muted-foreground">
                            {currentUserPoints} points minted
                          </div>
                        </div>
                      </div>
                      <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-800 dark:text-purple-100">
                        Your Rank
                      </Badge>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{currentUserLabel}</div>
                        <div className="text-sm text-muted-foreground">
                          No Points minted yet. Complete quests to join the
                          leaderboard.
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className="border-purple-300 text-purple-600 dark:border-purple-700 dark:text-purple-200"
                      >
                        Get Started
                      </Badge>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <CardTitle>Top Performers</CardTitle>
                  <div className="flex items-center gap-3">
                    {stats?.lastProcessedBlock && (
                      <span className="text-xs text-muted-foreground">
                        Last block tracked: #{stats.lastProcessedBlock}
                      </span>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRefresh}
                      disabled={!service || isRefreshing || isLoading}
                      className="flex items-center gap-1"
                    >
                      <RefreshCw
                        className={`w-4 h-4 ${
                          isRefreshing ? "animate-spin" : ""
                        }`}
                      />
                      Refresh
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {isInitialLoading ? (
                    <div className="space-y-3">
                      {Array.from({ length: 5 }).map((_, index) => (
                        <div
                          key={index}
                          className="h-16 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse"
                        />
                      ))}
                    </div>
                  ) : leaderboardTop.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      No Points mints recorded yet.
                    </div>
                  ) : (
                    leaderboardTop.map((entry, index) => {
                      const rank = index + 1;
                      const identifier = getIdentifier(entry);
                      const displayName = shorten(identifier, 16, 6);
                      const lockLabel = shorten(entry.lockHash, 14, 6);
                      const mintedPoints = formatPoints(entry.totalMinted);

                      return (
                        <div
                          key={`${entry.lockHash}-${rank}`}
                          className={`flex items-center justify-between p-4 rounded-lg border ${
                            rank <= 3
                              ? "bg-gradient-to-r from-yellow-50 to-orange-50 border-yellow-200 dark:from-yellow-900/20 dark:to-orange-900/20 dark:border-yellow-800"
                              : "bg-white dark:bg-gray-800"
                          }`}
                        >
                          <div className="flex items-center gap-4">
                            <div className="flex items-center justify-center w-10 h-10">
                              {getRankIcon(rank)}
                            </div>
                            <Avatar className="w-10 h-10">
                              <AvatarFallback className="bg-gradient-to-r from-purple-500 to-blue-500 text-white">
                                {getAvatarLabel(identifier)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <div className="font-semibold">{displayName}</div>
                              <div className="text-xs text-muted-foreground">
                                Lock: {lockLabel}
                              </div>
                            </div>
                          </div>

                          <div className="text-right">
                            <div className="font-bold text-lg">
                              {mintedPoints}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              Points minted
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader className="flex items-center gap-2">
                  <Activity className="w-5 h-5 text-green-600" />
                  <CardTitle>Leaderboard Metrics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Total Points minted
                    </span>
                    <span className="font-semibold">
                      {formatPoints(totalsSummary.totalMinted.toString())}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Unique recipients
                    </span>
                    <span className="font-semibold">
                      {totalsSummary.uniqueRecipients}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Transactions tracked
                    </span>
                    <span className="font-semibold">
                      {totalsSummary.transactionsTracked}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Participants ranked
                    </span>
                    <span className="font-semibold">{participantCount}</span>
                  </div>
                  {lastUpdated && (
                    <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                      <span>Last updated</span>
                      <span>{lastUpdated.toLocaleTimeString()}</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-blue-600" />
                  <CardTitle>Recent Minting Activity</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {isInitialLoading ? (
                    <div className="space-y-3">
                      {Array.from({ length: 3 }).map((_, index) => (
                        <div
                          key={index}
                          className="h-20 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse"
                        />
                      ))}
                    </div>
                  ) : recentTransactions.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      No minting transactions found yet.
                    </div>
                  ) : (
                    recentTransactions.map((record) => {
                      const topRecipients = record.recipients.slice(0, 3);
                      const extraRecipients =
                        record.recipients.length - topRecipients.length;

                      return (
                        <div
                          key={record.txHash}
                          className="p-4 rounded-lg border bg-gray-50 dark:bg-gray-800/50"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-semibold">
                              Tx {shorten(record.txHash, 10, 6)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Block{" "}
                              {record.blockNumber
                                ? `#${record.blockNumber}`
                                : "Pending"}
                            </span>
                          </div>
                          <div className="text-sm mb-2">
                            Total minted:{" "}
                            <span className="font-semibold">
                              {formatPoints(record.totalMinted)} points
                            </span>
                          </div>
                          <div className="space-y-1 text-xs">
                            {topRecipients.length === 0 ? (
                              <div className="text-muted-foreground">
                                No recipients recorded.
                              </div>
                            ) : (
                              topRecipients.map((recipient, idx) => (
                                <div
                                  key={`${record.txHash}-${recipient.lockHash}-${idx}`}
                                  className="flex items-center justify-between text-muted-foreground"
                                >
                                  <span>
                                    {shorten(
                                      getRecipientIdentifier(recipient),
                                      14,
                                      6
                                    )}
                                  </span>
                                  <span className="font-medium text-foreground">
                                    {formatPoints(recipient.mintedAmount)} pts
                                  </span>
                                </div>
                              ))
                            )}
                            {extraRecipients > 0 && (
                              <div className="text-[11px] text-muted-foreground">
                                + {extraRecipients} more recipient
                                {extraRecipients > 1 ? "s" : ""}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex items-center gap-2">
                  <Info className="w-5 h-5 text-blue-600" />
                  <CardTitle>Rules & Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm text-muted-foreground">
                  <div>
                    <h4 className="font-semibold text-foreground mb-2">
                      Points Overview
                    </h4>
                    <ul className="space-y-1">
                      <li>
                        • Points are minted when quests are approved by campaign
                        managers.
                      </li>
                      <li>
                        • Each minting transaction is tracked on-chain and
                        linked to recipient lock scripts.
                      </li>
                      <li>
                        • Leaderboard positions update automatically as new
                        Points are minted.
                      </li>
                    </ul>
                  </div>

                  <div>
                    <h4 className="font-semibold text-foreground mb-2">
                      Ranking Tips
                    </h4>
                    <ul className="space-y-1">
                      <li>
                        • Complete verified quests regularly to increase your
                        Points total.
                      </li>
                      <li>
                        • Stay connected to retain eligibility for rewards and
                        snapshots.
                      </li>
                      <li>
                        • Monitor minting activity to spot trending campaigns.
                      </li>
                    </ul>
                  </div>

                  <div className="text-xs pt-3 border-t">
                    Last processed block: {stats?.lastProcessedBlock ?? "—"}.
                    Leaderboard data refreshes whenever new Points cells are
                    detected.
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
