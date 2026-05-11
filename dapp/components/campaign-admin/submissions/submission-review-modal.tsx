"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SubmissionContentViewer } from "@/components/submission-content-viewer";
import {
  CheckCircle,
  Trophy,
  User,
  Mail,
  Twitter,
  MessageSquare,
  Clock,
  ExternalLink,
  AlertCircle,
  Copy,
} from "lucide-react";
import { UserSubmissionRecordLike, UserDataLike } from "ssri-ckboost/types";
import { useNostrFetch } from "@/hooks/use-nostr-fetch";
import { createScopedLogger, formatDateConsistent } from "ssri-ckboost";
import { QuestSubtask } from "@/types/submission";
import {
  buildQuestResponseEntries,
  resolveSubmissionContent,
} from "@/lib/utils/submission-export";

const log = createScopedLogger("SubmissionReviewModal");

interface SubmissionReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  submission: UserSubmissionRecordLike & { userTypeId: string };
  userData?: UserDataLike;
  userInfo: {
    name: string;
    email?: string;
    twitter?: string;
    discord?: string;
  };
  questId: number;
  questPoints: number;
  isApproved: boolean;
  quest?: {
    sub_tasks?: QuestSubtask[];
  };
}

export function SubmissionReviewModal({
  isOpen,
  onClose,
  submission,
  userData,
  userInfo,
  questId,
  questPoints,
  isApproved,
  quest,
}: SubmissionReviewModalProps) {
  const { fetchSubmission } = useNostrFetch();
  const [submissionContent, setSubmissionContent] = useState<string>("");
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [nostrEvents, setNostrEvents] = useState<
    Array<{
      neventId: string;
      eventId?: string;
      pubkey?: string;
      createdAt?: number;
      relays?: string[];
      error?: string;
    }>
  >([]);

  useEffect(() => {
    if (isOpen && submission.submission_content) {
      loadSubmissionContent();
    }
  }, [isOpen, submission.submission_content]);

  async function loadSubmissionContent() {
    setIsLoadingContent(true);
    setContentError(null);
    setNostrEvents([]);
    setSubmissionContent("");

    try {
      const content = submission.submission_content;

      if (!content) {
        setSubmissionContent("No submission content available");
        return;
      }

      log.log("Resolving submission content", content);
      const resolved = await resolveSubmissionContent(content, fetchSubmission);
      setSubmissionContent(
        resolved.resolvedContent ||
          resolved.rawContent ||
          "No submission content available"
      );
      setNostrEvents(resolved.events);
    } catch (err) {
      console.error("Failed to load submission content:", err);
      setContentError("Error loading submission content");
      setSubmissionContent("Failed to load content");
    } finally {
      setIsLoadingContent(false);
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    // Could add a toast notification here
  }

  const submissionTime = submission.submission_timestamp
    ? new Date(Number(submission.submission_timestamp))
    : null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review Submission</DialogTitle>
          <DialogDescription>
            Quest #{questId} - {questPoints} points
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Status */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Status:</span>
            {isApproved ? (
              <Badge className="bg-green-100 text-green-800">
                <CheckCircle className="w-3 h-3 mr-1" />
                Approved - {questPoints} points minted
              </Badge>
            ) : (
              <Badge className="bg-yellow-100 text-yellow-800">
                <Clock className="w-3 h-3 mr-1" />
                Pending Review
              </Badge>
            )}
          </div>

          {/* User Information */}
          <div className="border rounded-lg p-4 space-y-3">
            <h3 className="font-medium flex items-center gap-2">
              <User className="w-4 h-4" />
              User Information
            </h3>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">Name:</span>
                <p className="font-medium">{userInfo.name}</p>
              </div>

              {userInfo.email && (
                <div>
                  <span className="text-muted-foreground">Email:</span>
                  <p className="font-medium flex items-center gap-1">
                    <Mail className="w-3 h-3" />
                    {userInfo.email}
                  </p>
                </div>
              )}

              {userInfo.twitter && (
                <div>
                  <span className="text-muted-foreground">Twitter:</span>
                  <p className="font-medium">
                    <a
                      href={`https://twitter.com/${userInfo.twitter.replace(
                        "@",
                        ""
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:text-blue-600 flex items-center gap-1"
                    >
                      <Twitter className="w-3 h-3" />
                      {userInfo.twitter}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </p>
                </div>
              )}

              {userInfo.discord && (
                <div>
                  <span className="text-muted-foreground">Discord:</span>
                  <p className="font-medium flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" />
                    {userInfo.discord}
                  </p>
                </div>
              )}

              <div>
                <span className="text-muted-foreground">User Type ID:</span>
                <p className="font-mono text-xs flex items-center gap-1">
                  {submission.userTypeId.slice(0, 10)}...
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0"
                    onClick={() => copyToClipboard(submission.userTypeId)}
                  >
                    <Copy className="w-3 h-3" />
                  </Button>
                </p>
              </div>

              {userData && (
                <div>
                  <span className="text-muted-foreground">Total Points:</span>
                  <p className="font-medium flex items-center gap-1">
                    <Trophy className="w-3 h-3" />
                    {Number(userData.total_points_earned || 0)}
                  </p>
                </div>
              )}

              {submissionTime && (
                <div>
                  <span className="text-muted-foreground">Submitted:</span>
                  <p className="font-medium flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDateConsistent(submissionTime)}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Submission Content */}
          <div className="border rounded-lg p-4 space-y-3">
            <h3 className="font-medium">Submission Content</h3>

            {isLoadingContent ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Loading content...
                  </p>
                </div>
              </div>
            ) : contentError ? (
              <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
                <AlertCircle className="w-4 h-4" />
                <span className="text-sm">{contentError}</span>
              </div>
            ) : (
              <div className="space-y-3">
                {(() => {
                  const entries = buildQuestResponseEntries(
                    quest,
                    submissionContent
                  );
                  const hasRenderableContent = entries.some(
                    (entry) => entry.response.trim().length > 0
                  );

                  if (entries.length === 0 || !hasRenderableContent) {
                    const fallbackContent = submissionContent.trim();
                    if (fallbackContent) {
                      return (
                        <div className="border rounded-lg overflow-hidden">
                          <div className="bg-muted px-4 py-3 border-b">
                            <span className="text-sm font-semibold">
                              Response
                            </span>
                          </div>
                          <div className="p-4 bg-background">
                            <SubmissionContentViewer content={fallbackContent} />
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div className="text-center py-8 border rounded-lg bg-yellow-50 dark:bg-yellow-900/20">
                        <AlertCircle className="w-8 h-8 text-yellow-500 mx-auto mb-2" />
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          No submission content available.
                        </p>
                      </div>
                    );
                  }

                  return entries.map((entry, index) => (
                    <div
                      key={index}
                      className="border rounded-lg overflow-hidden"
                    >
                      <div className="bg-muted px-4 py-3 border-b space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold">
                            {entry.title || `Subtask ${index + 1}`}
                          </span>
                          {entry.type && (
                            <Badge variant="outline" className="text-xs">
                              {entry.type}
                            </Badge>
                          )}
                        </div>
                        <div className="space-y-1">
                          {entry.description && (
                            <p className="text-xs text-muted-foreground">
                              {entry.description}
                            </p>
                          )}
                          {entry.proofRequired && (
                            <p className="text-xs text-muted-foreground">
                              <span className="font-medium">
                                Required proof:
                              </span>{" "}
                              {entry.proofRequired}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="p-4 bg-background">
                        <div className="text-sm font-medium text-muted-foreground mb-2">
                          User Response:
                        </div>
                        <SubmissionContentViewer
                          content={entry.response || "Not provided"}
                        />
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}

            {nostrEvents.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <AlertCircle className="w-3 h-3" />
                Content fetched from Nostr event
              </div>
            )}

            {nostrEvents.length > 0 && (
              <div className="border rounded-lg p-3 bg-muted/40 space-y-2">
                <h4 className="text-sm font-semibold">
                  Linked Nostr Event{nostrEvents.length > 1 ? "s" : ""}
                </h4>
                <div className="space-y-2">
                  {nostrEvents.map((evt, idx) => (
                    <details
                      key={evt.neventId + idx}
                      className="border rounded-md bg-background"
                    >
                      <summary className="px-3 py-2 cursor-pointer text-sm font-medium flex items-center justify-between">
                        <span>
                          Event #{idx + 1}: {evt.neventId.slice(0, 20)}...
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {evt.error ? "Error" : "Details"}
                        </span>
                      </summary>
                      <div className="px-3 py-2 space-y-1 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <span className="font-medium text-foreground">
                            nevent:
                          </span>
                          <span className="break-all">{evt.neventId}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => copyToClipboard(evt.neventId)}
                          >
                            <Copy className="w-3 h-3" />
                          </Button>
                        </div>
                        {evt.eventId && (
                          <div>
                            <span className="font-medium text-foreground">
                              event id:
                            </span>{" "}
                            <span className="break-all">{evt.eventId}</span>
                          </div>
                        )}
                        {evt.pubkey && (
                          <div>
                            <span className="font-medium text-foreground">
                              pubkey:
                            </span>{" "}
                            <span className="break-all">{evt.pubkey}</span>
                          </div>
                        )}
                        {evt.createdAt && (
                          <div>
                            <span className="font-medium text-foreground">
                              created:
                            </span>{" "}
                            {formatDateConsistent(
                              new Date(evt.createdAt * 1000)
                            )}
                          </div>
                        )}
                        {evt.relays && evt.relays.length > 0 && (
                          <div>
                            <span className="font-medium text-foreground">
                              relays:
                            </span>{" "}
                            {evt.relays.join(", ")}
                          </div>
                        )}
                        {evt.error && (
                          <div className="text-destructive">{evt.error}</div>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
