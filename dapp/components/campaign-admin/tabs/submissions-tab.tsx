"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Clock,
  CheckCircle,
  Trophy,
  RefreshCw,
  AlertCircle,
  Download,
  Loader2,
} from "lucide-react";
import { useCampaignAdmin } from "@/lib/providers/campaign-admin-provider";
import {
  CampaignDataLike,
  UserSubmissionRecordLike,
  UserDataLike,
} from "ssri-ckboost/types";
import { SubmissionList } from "../submissions/submission-list";
import { SubmissionStatsCards } from "../submissions/submission-stats-cards";
import { createScopedLogger } from "ssri-ckboost";
import { ccc } from "@ckb-ccc/connector-react";
import { useToast } from "@/components/ui/use-toast";
import { useNostrFetch } from "@/hooks/use-nostr-fetch";
import { buildQuestSubmissionExportData } from "@/lib/utils/submission-export";

const log = createScopedLogger("SubmissionsTab");

interface SubmissionsTabProps {
  campaignTypeId: ccc.Hex;
  isStaffReviewer?: boolean;
}

export function SubmissionsTab({
  campaignTypeId,
  isStaffReviewer = false,
}: SubmissionsTabProps) {
  const {
    campaignAdminService,
    campaign: campaignInstance,
    isLoadingCampaign: isServiceLoading,
    error: adminError,
  } = useCampaignAdmin(campaignTypeId);
  const [submissions, setSubmissions] =
    useState<
      Map<number, Array<UserSubmissionRecordLike & { userTypeId: string }>>
    >();
  const [userDetails, setUserDetails] = useState<Map<string, UserDataLike>>();
  const [campaignData, setCampaignData] = useState<CampaignDataLike | null>(
    null
  );
  const [stats, setStats] = useState<{
    totalSubmissions: number;
    pendingReview: number;
    approved: number;
  }>();
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<
    "all" | "pending" | "approved"
  >("all");
  const [selectedQuestFilter, setSelectedQuestFilter] = useState("all");
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();
  const { fetchSubmission } = useNostrFetch();

  const loadSubmissions = useCallback(async () => {
    if (!campaignAdminService) {
      setError("Campaign admin service not available");
      setIsLoading(false);
      return;
    }

    try {
      setError(null);
      const data = await campaignAdminService.fetchCampaignSubmissions(
        campaignTypeId
      );
      setSubmissions(data.submissions);
      setUserDetails(data.userDetails);
      setCampaignData(data.campaignData);
      setStats(data.stats);
      log.log("Loaded submissions", data.stats);
      log.log(
        "Campaign quests:",
        data.campaignData?.quests?.map((q) => ({
          id: q.quest_id,
          title: q.metadata?.title,
        }))
      );
    } catch (err) {
      console.error("Failed to load submissions:", err);
      setError("Failed to load submissions. Please try again.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [campaignAdminService, campaignTypeId]);

  useEffect(() => {
    if (!isServiceLoading && campaignAdminService) {
      loadSubmissions();
    }
  }, [campaignTypeId, isServiceLoading, campaignAdminService, loadSubmissions]);

  useEffect(() => {
    const hasSelectedQuest = campaignData?.quests?.some(
      (quest) => String(Number(quest.quest_id)) === selectedQuestFilter
    );

    if (selectedQuestFilter !== "all" && !hasSelectedQuest) {
      setSelectedQuestFilter("all");
    }
  }, [campaignData, selectedQuestFilter]);

  async function handleRefresh() {
    setIsRefreshing(true);
    await loadSubmissions();
  }

  const filteredSubmissions = useMemo(() => {
    if (!submissions || filterStatus === "all") {
      if (selectedQuestFilter === "all") {
        return submissions || new Map();
      }

      const questId = Number(selectedQuestFilter);
      const questSubmissions = submissions?.get(questId) || [];
      return new Map([[questId, questSubmissions]]);
    }

    const filtered = new Map<
      number,
      Array<UserSubmissionRecordLike & { userTypeId: string }>
    >();

    for (const [questId, questSubmissions] of submissions) {
      if (
        selectedQuestFilter !== "all" &&
        questId !== Number(selectedQuestFilter)
      ) {
        continue;
      }

      const quest = campaignData?.quests?.find(
        (q) => Number(q.quest_id) === questId
      );
      const approvedUserIds = quest?.accepted_submission_user_type_ids || [];

      const filteredSubmissions = questSubmissions.filter((submission) => {
        const isApproved = approvedUserIds.includes(submission.userTypeId);
        if (filterStatus === "approved") {
          return isApproved;
        } else if (filterStatus === "pending") {
          return !isApproved;
        }
        return true;
      });

      if (filteredSubmissions.length > 0) {
        filtered.set(questId, filteredSubmissions);
      }
    }

    return filtered;
  }, [campaignData, filterStatus, selectedQuestFilter, submissions]);

  const visibleQuests = useMemo(() => {
    if (!campaignData?.quests) {
      return [];
    }

    if (selectedQuestFilter === "all") {
      return campaignData.quests;
    }

    return campaignData.quests.filter(
      (quest) => Number(quest.quest_id) === Number(selectedQuestFilter)
    );
  }, [campaignData, selectedQuestFilter]);

  async function handleExportSelectedQuest() {
    if (!campaignData?.quests || selectedQuestFilter === "all") {
      return;
    }

    const selectedQuest = campaignData.quests.find(
      (quest) => Number(quest.quest_id) === Number(selectedQuestFilter)
    );

    if (!selectedQuest) {
      toast({
        title: "Quest not found",
        description: "Select a valid quest before exporting submissions.",
        variant: "destructive",
      });
      return;
    }

    setIsExporting(true);

    try {
      const { utils, writeFile } = await import("xlsx");
      const exportData = await buildQuestSubmissionExportData({
        campaignTitle: campaignData.metadata?.title || "Campaign",
        campaignTypeId,
        quest: selectedQuest,
        submissions: submissions?.get(Number(selectedQuest.quest_id)) || [],
        userDetails: userDetails || new Map(),
        fetchSubmission,
      });

      if (exportData.rows.length === 0) {
        toast({
          title: "No submissions to export",
          description: "The selected quest does not have any submissions yet.",
        });
        return;
      }

      const workbook = utils.book_new();
      const worksheet = utils.json_to_sheet(exportData.rows, {
        header: exportData.headers,
      });
      worksheet["!cols"] = exportData.headers.map((header) => {
        const maxValueLength = exportData.rows.reduce((max, row) => {
          const value = row[header];
          return Math.max(max, String(value ?? "").length);
        }, header.length);

        return {
          wch: Math.min(Math.max(maxValueLength + 2, 14), 60),
        };
      });

      utils.book_append_sheet(workbook, worksheet, exportData.sheetName);
      writeFile(workbook, exportData.filename, {
        compression: true,
      });

      toast({
        title: "Export ready",
        description: `Saved ${exportData.submissionCount} submission${
          exportData.submissionCount === 1 ? "" : "s"
        } for ${selectedQuest.metadata?.title || `Quest ${selectedQuest.quest_id}`}.${
          exportData.continuationRowCount > 0
            ? ` Added ${exportData.continuationRowCount} continuation row${
                exportData.continuationRowCount === 1 ? "" : "s"
              } to preserve text over Excel's 32,767-character cell limit.`
            : ""
        }`,
      });
    } catch (exportError) {
      log.error("Failed to export quest submissions", exportError);
      toast({
        title: "Export failed",
        description:
          exportError instanceof Error
            ? exportError.message
            : "Unable to export the selected quest submissions.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  }

  async function handleBatchApprove(
    questId: number,
    userTypeIds: string[]
  ): Promise<string> {
    if (!campaignAdminService || !submissions) {
      throw new Error("Service not available");
    }

    // Points are handled automatically by the smart contract based on quest configuration

    if (userTypeIds.length === 0) {
      throw new Error("No submissions selected for approval");
    }

    // Check if campaign instance is available
    if (!campaignInstance) {
      if (isServiceLoading) {
        throw new Error(
          "Campaign is still loading, please wait a moment and try again"
        );
      }
      if (adminError) {
        throw new Error(`Campaign error: ${adminError}`);
      }
      throw new Error("Campaign instance not available");
    }

    try {
      const txHash = isStaffReviewer
        ? await campaignAdminService.approveCompletionViaProxy(
            campaignTypeId,
            questId,
            userTypeIds as ccc.Hex[]
          )
        : await campaignAdminService.approveCompletion(
            campaignTypeId,
            questId,
            userTypeIds as ccc.Hex[]
          );

      // Store the transaction hash if needed
      if (txHash) {
        log.log("Batch approval transaction:", txHash);
      }

      // Refresh submissions after batch approval
      await loadSubmissions();
      return txHash;
    } catch (err) {
      console.error("Failed to batch approve submissions:", err);
      throw err; // Re-throw to be handled by the dialog
    }
  }

  if (isServiceLoading || isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">
            {isServiceLoading
              ? "Loading campaign..."
              : "Loading submissions..."}
          </p>
        </div>
      </div>
    );
  }

  if (error || adminError) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-red-500 mb-4">{error || adminError}</p>
          <Button onClick={handleRefresh}>Try Again</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with refresh button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Quest Submissions</h2>
          <p className="text-muted-foreground">
            Review and approve quest completions to mint Points rewards
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw
            className={`w-4 h-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <SubmissionStatsCards stats={stats} />

      {/* Filter Controls */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium mr-2">Status:</span>
              <Button
                variant={filterStatus === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterStatus("all")}
              >
                All
              </Button>
              <Button
                variant={filterStatus === "pending" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterStatus("pending")}
              >
                <Clock className="w-3 h-3 mr-1" />
                Pending ({stats?.pendingReview || 0})
              </Button>
              <Button
                variant={filterStatus === "approved" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterStatus("approved")}
              >
                <CheckCircle className="w-3 h-3 mr-1" />
                Approved ({stats?.approved || 0})
              </Button>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium shrink-0">Quest:</span>
                <Select
                  value={selectedQuestFilter}
                  onValueChange={setSelectedQuestFilter}
                >
                  <SelectTrigger className="w-full min-w-[240px]">
                    <SelectValue placeholder="Filter by quest" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All quests</SelectItem>
                    {(campaignData?.quests || []).map((quest) => (
                      <SelectItem
                        key={String(quest.quest_id)}
                        value={String(Number(quest.quest_id))}
                      >
                        {quest.metadata?.title || `Quest ${quest.quest_id}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={handleExportSelectedQuest}
                disabled={isExporting || selectedQuestFilter === "all"}
                className="sm:self-stretch"
              >
                {isExporting ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Download className="w-4 h-4 mr-2" />
                )}
                Export XLSX
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Submissions by Quest */}
      {campaignData?.quests && campaignData.quests.length > 0 ? (
        <SubmissionList
          quests={visibleQuests}
          submissions={filteredSubmissions}
          userDetails={userDetails || new Map()}
          onBatchApprove={handleBatchApprove}
          filterStatus={filterStatus}
        />
      ) : (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <Trophy className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                No quests have been created yet. Create quests first to receive
                submissions.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
