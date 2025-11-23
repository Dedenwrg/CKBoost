"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  Heart,
  MessageSquare,
  Share2,
  Send,
  MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface Comment {
  neventId: string;
  author: string;
  content: string;
  timestamp: string;
  likes: number;
  isLiked: boolean;
  link?: string;
  isTip?: boolean;
  tipAmount?: string;
  tipTxHash?: string;
}

interface SocialInteractionsProps {
  tipping_type_id: string;
  initialLikes: number;
  initialComments: Comment[];
  isLiked?: boolean;
  onLike?: (tipping_type_id: string) => void;
  onComment?: (
    tipping_type_id: string,
    comment: string
  ) => Promise<boolean | void> | boolean | void;
  onShare?: (tipping_type_id: string) => void;
  previewCount?: number;
  pageSize?: number;
  commentEnabled?: boolean;
  commentDisabledLabel?: string;
  onConnectWallet?: () => void | Promise<void>;
  draftComment?: string;
  onDraftCommentChange?: (value: string) => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
  totalComments?: number;
}

export function SocialInteractions({
  tipping_type_id,
  initialLikes,
  initialComments,
  isLiked = false,
  onLike,
  onComment,
  onShare,
  previewCount = 3,
  pageSize = 5,
  commentEnabled = true,
  commentDisabledLabel,
  onConnectWallet,
  draftComment,
  onDraftCommentChange,
  hasMore = false,
  onLoadMore,
  isLoadingMore = false,
  totalComments,
}: SocialInteractionsProps) {
  const getExplorerUrl = (hash?: string) => {
    if (!hash) return null;
    const network = process.env.NEXT_PUBLIC_CKB_NETWORK || "mainnet";
    const base =
      network === "testnet"
        ? "https://pudge.explorer.nervos.org/transaction/"
        : "https://explorer.nervos.org/transaction/";
    return `${base}${hash}`;
  };

  const formatTxHash = (hash?: string | null) => {
    if (!hash) return "";
    return hash.length <= 18 ? hash : `${hash.slice(0, 10)}…${hash.slice(-6)}`;
  };

  console.log("SocialInteractions props:", {
    totalComments,
    commentsLength: initialComments.length,
    hasMore,
    pageSize,
  });
  const [liked, setLiked] = useState(isLiked);
  const [likes, setLikes] = useState(initialLikes);
  const [comments, setComments] = useState(initialComments);
  const [internalComment, setInternalComment] = useState("");
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [showPagedComments, setShowPagedComments] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSizeState, setPageSizeState] = useState(pageSize);
  const pendingPageAdvance = useRef(false);
  const prevCommentsLength = useRef(initialComments.length);

  const effectiveTotalComments = totalComments ?? comments.length;
  const totalPages = Math.max(
    1,
    Math.ceil(effectiveTotalComments / pageSizeState)
  );

  const pagedComments = comments.slice(
    (currentPage - 1) * pageSizeState,
    currentPage * pageSizeState
  );
  const isLoadingInitial = isLoadingMore && comments.length === 0;

  const previewComments = comments.slice(0, previewCount);

  const visibleComments = showPagedComments ? pagedComments : previewComments;

  useEffect(() => {
    setLiked(isLiked);
  }, [isLiked]);

  useEffect(() => {
    setLikes(initialLikes);
  }, [initialLikes]);

  useEffect(() => {
    setComments(initialComments);
    prevCommentsLength.current = initialComments.length;
  }, [initialComments]);

  const commentValue = draftComment ?? internalComment;
  const setCommentValue = onDraftCommentChange ?? setInternalComment;

  useEffect(() => {
    if (draftComment === undefined) {
      return;
    }
    setInternalComment(draftComment);
  }, [draftComment]);

  const handleLike = () => {
    const newLikedState = !liked;
    setLiked(newLikedState);
    setLikes((prev) => (newLikedState ? prev + 1 : prev - 1));
    onLike?.(tipping_type_id);
  };

  const handleComment = async () => {
    if (!commentEnabled) {
      if (onConnectWallet) {
        await onConnectWallet();
      }
      return;
    }
    if (!commentValue.trim()) return;

    setIsSubmittingComment(true);
    setCommentError(null);

    try {
      let shouldClearInput = true;
      if (onComment) {
        const result = await onComment(tipping_type_id, commentValue);
        if (result === false) {
          shouldClearInput = false;
        }
      } else {
        const comment: Comment = {
          neventId: Date.now().toString(),
          author: "CurrentUser",
          content: commentValue,
          timestamp: "now",
          likes: 0,
          isLiked: false,
        };
        setComments((prev) => [comment, ...prev]);
      }
      if (shouldClearInput) {
        setCommentValue("");
      }
    } catch (err) {
      setCommentError(
        err instanceof Error
          ? err.message
          : "Failed to post comment. Please try again."
      );
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleCommentLike = (commentNeventId: string) => {
    setComments((prev) =>
      prev.map((comment) =>
        comment.neventId === commentNeventId
          ? {
              ...comment,
              isLiked: !comment.isLiked,
              likes: comment.isLiked ? comment.likes - 1 : comment.likes + 1,
            }
          : comment
      )
    );
  };

  const handleShare = () => {
    // Copy link to clipboard
    navigator.clipboard.writeText(
      `${window.location.origin}/proposal/${tipping_type_id}`
    );
    onShare?.(tipping_type_id);
  };

  const handleNextPage = () => {
    const nextCommentsStartIndex = currentPage * pageSizeState;
    const remainingAfterNext = comments.length - nextCommentsStartIndex;

    if (nextCommentsStartIndex < comments.length) {
      setCurrentPage((prev) => prev + 1);

      if (
        hasMore &&
        onLoadMore &&
        !isLoadingMore &&
        remainingAfterNext <= pageSizeState
      ) {
        onLoadMore();
      }
    } else if (hasMore && onLoadMore && !isLoadingMore) {
      pendingPageAdvance.current = true;
      onLoadMore();
    }
  };

  useEffect(() => {
    if (pendingPageAdvance.current && showPagedComments) {
      if (comments.length > prevCommentsLength.current) {
        setCurrentPage((prev) => prev + 1);
        pendingPageAdvance.current = false;
      } else if (!isLoadingMore) {
        // No new comments arrived; clear pending to avoid getting stuck
        pendingPageAdvance.current = false;
      }
    }
    prevCommentsLength.current = comments.length;
  }, [comments.length, showPagedComments, isLoadingMore]);

  return (
    <div className="space-y-4">
      {/* Action Bar */}
      <div className="flex items-center justify-between pt-2 border-t">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLike}
            className={`flex items-center gap-2 ${
              liked
                ? "text-red-600 hover:text-red-700"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Heart className={`w-4 h-4 ${liked ? "fill-current" : ""}`} />
            <span>{likes}</span>
          </Button>

          <div className="flex items-center gap-2 text-muted-foreground">
            <MessageSquare className="w-4 h-4" />
            <span>{effectiveTotalComments}</span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleShare}
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
          >
            <Share2 className="w-4 h-4" />
            <span>Share</span>
          </Button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>Report content</DropdownMenuItem>
            <DropdownMenuItem>Copy link</DropdownMenuItem>
            <DropdownMenuItem>Save for later</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Comments Section */}
      <div className="space-y-4">
        <Separator />

        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <Avatar className="w-8 h-8">
              <AvatarFallback className="bg-gradient-to-br from-purple-200 to-blue-200 text-sm">
                U
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 space-y-2">
              <Textarea
                placeholder="Write a comment..."
                value={commentValue}
                onChange={(e) => setCommentValue(e.target.value)}
                rows={2}
                disabled={!commentEnabled}
                className={`resize-none ${
                  !commentEnabled ? "opacity-60 cursor-not-allowed" : ""
                }`}
                readOnly={!commentEnabled}
              />
              <div className="flex justify-between items-center gap-3 text-xs text-muted-foreground">
                {showPagedComments && (
                  <div className="flex items-center gap-2">
                    <span>Per page:</span>
                    <Input
                      type="number"
                      min={1}
                      className="w-16 h-8 text-xs"
                      value={pageSizeState}
                      onChange={(e) => {
                        const next = Math.max(1, Number(e.target.value) || 1);
                        setPageSizeState(next);
                        setCurrentPage(1);
                      }}
                    />
                  </div>
                )}
                <div className="flex-1 text-right">
                  <Button
                    size="sm"
                    onClick={handleComment}
                    disabled={
                      (commentEnabled && !commentValue.trim()) ||
                      isSubmittingComment
                    }
                  >
                    {isSubmittingComment ? (
                      <>
                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2"></div>
                        Posting...
                      </>
                    ) : (
                      <>
                        <Send className="w-3 h-3 mr-2" />
                        {commentEnabled
                          ? "Comment"
                          : commentDisabledLabel || "Connect wallet"}
                      </>
                    )}
                  </Button>
                </div>
              </div>
              {commentError && (
                <p className="text-xs text-destructive text-right">
                  {commentError}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {isLoadingInitial
            ? Array.from({ length: Math.max(3, pageSizeState) }).map(
                (_, idx) => (
                  <div
                    key={`skeleton-${idx}`}
                    className="flex items-start gap-3"
                  >
                    <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-32 bg-muted rounded animate-pulse" />
                      <div className="h-10 w-full bg-muted rounded animate-pulse" />
                    </div>
                  </div>
                )
              )
            : visibleComments.map((comment) => (
                <div key={comment.neventId} className="flex items-start gap-3">
                  <Avatar className="w-8 h-8">
                    <AvatarFallback className="bg-gradient-to-br from-green-200 to-blue-200 text-sm">
                      {comment.author.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 space-y-1">
                    <div
                      className={`rounded-lg p-3 ${
                        comment.isTip
                          ? "bg-amber-50 dark:bg-amber-950/40 border border-amber-200/70"
                          : "bg-muted"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">
                          {comment.author}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {comment.timestamp}
                        </span>
                        {comment.isTip && (
                          <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                            💰 Tip: {comment.tipAmount} CKB
                          </span>
                        )}
                      </div>
                      <p className="text-sm whitespace-pre-line">
                        {comment.content}
                      </p>
                      {comment.link && (
                        <div className="mt-1 flex items-center gap-2 text-xs">
                          <a
                            href={comment.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 dark:text-blue-400"
                          >
                            View on njump.me ↗
                          </a>
                          {comment.tipTxHash &&
                            getExplorerUrl(comment.tipTxHash) && (
                              <>
                                <span className="text-muted-foreground">•</span>
                                <a
                                  href={getExplorerUrl(comment.tipTxHash)!}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:text-blue-800 dark:text-blue-400"
                                >
                                  Personal Tipping Tx:{" "}
                                  {formatTxHash(comment.tipTxHash)}
                                </a>
                              </>
                            )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 px-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCommentLike(comment.neventId)}
                        className={`h-6 px-2 text-xs ${
                          comment.isLiked
                            ? "text-red-600"
                            : "text-muted-foreground"
                        }`}
                      >
                        <Heart
                          className={`w-3 h-3 mr-1 ${
                            comment.isLiked ? "fill-current" : ""
                          }`}
                        />
                        {comment.likes > 0 && comment.likes}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs text-muted-foreground"
                      >
                        Reply
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
          {(effectiveTotalComments > previewCount || hasMore) &&
            !showPagedComments && (
              <div className="flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowPagedComments(true);
                    setCurrentPage(1);
                  }}
                  className="text-xs"
                >
                  Load more comments
                </Button>
              </div>
            )}

          {showPagedComments && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <Button
                variant="ghost"
                size="sm"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              >
                Previous
              </Button>
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={
                  (currentPage === totalPages && !hasMore) || isLoadingMore
                }
                onClick={handleNextPage}
              >
                {isLoadingMore ? "Loading..." : "Next"}
              </Button>
            </div>
          )}
        </div>

        {effectiveTotalComments === 0 && !isLoadingInitial && (
          <div className="text-center py-8 text-muted-foreground">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No comments yet. Be the first to comment!</p>
          </div>
        )}
      </div>
    </div>
  );
}
