"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Calendar,
  Users,
  Trophy,
  Coins,
  Clock,
  Shield,
  MessageCircle,
  FileText,
  Fingerprint,
  User,
  CheckCircle,
  AlertTriangle,
  X,
  MessageSquare,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";

import { CampaignCoverImage } from "@/components/campaign-cover-image";
import { getDaysUntilEnd, type CampaignDisplay } from "@/lib";
import { formatDateConsistent } from "ssri-ckboost";
import { udtRegistry } from "@/lib/services/udt-registry";
import { useCampaignCoverImage } from "@/hooks/use-campaign-cover-image";

interface CampaignCardProps {
  campaign: CampaignDisplay;
  onCategoryClick?: (category: string) => void;
  onDifficultyClick?: (difficulty: string) => void;
  onStatusClick?: (status: string) => void;
  selectedCategories?: string[];
  selectedDifficulties?: string[];
  selectedStatuses?: string[];
}

// Mock current user verification status - in real app, this would come from authentication
const CURRENT_USER_VERIFICATION = {
  telegram: true,
  kyc: false,
  did: false,
  manualReview: false,
  twitter: false,
  discord: true,
  reddit: false,
};

// Helper function to check if user meets verification requirements based on new logic
const meetsVerificationRequirements = (
  requirements: Record<string, boolean> | undefined
) => {
  if (!requirements) return true;

  // Check if campaign refuses manual review
  const refusesManualReview = requirements.excludeManualReview || false;

  // Check each requirement individually
  if (requirements.telegram && !CURRENT_USER_VERIFICATION.telegram) {
    return false;
  }

  if (requirements.twitter && !CURRENT_USER_VERIFICATION.twitter) {
    return false;
  }

  if (requirements.discord && !CURRENT_USER_VERIFICATION.discord) {
    return false;
  }

  if (requirements.reddit && !CURRENT_USER_VERIFICATION.reddit) {
    return false;
  }

  // For identity verification (KYC or DID), user needs to have at least one if either is required
  if (requirements.kyc || requirements.did) {
    const hasIdentityVerification =
      CURRENT_USER_VERIFICATION.kyc || CURRENT_USER_VERIFICATION.did;
    if (!hasIdentityVerification) {
      return false;
    }
  }

  // Manual review requirement (only if KYC/DID not available and not excluded)
  if (
    requirements.manualReview &&
    !refusesManualReview &&
    !requirements.kyc &&
    !requirements.did &&
    !CURRENT_USER_VERIFICATION.manualReview
  ) {
    return false;
  }

  return true;
};

export function CampaignCard({
  campaign,
  onCategoryClick,
  onDifficultyClick,
  onStatusClick,
  selectedCategories = [],
  selectedDifficulties = [],
  selectedStatuses = [],
}: CampaignCardProps) {
  const capitalizeFirstLetter = (str: string) => {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  };

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty.toLowerCase()) {
      case "beginner":
      case "easy":
        return "bg-green-100 dark:bg-green-800 text-green-800 dark:text-green-100";
      case "medium":
        return "bg-cyan-100 dark:bg-cyan-800 text-cyan-900 dark:text-cyan-100";
      case "advanced":
        return "bg-red-100 dark:bg-red-800 text-red-800 dark:text-red-100";
      default:
        return "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case "active":
        return "bg-green-100 dark:bg-green-800 text-green-800 dark:text-green-100";
      case "ending-soon":
        return "bg-orange-100 dark:bg-orange-800 text-orange-800 dark:text-orange-100";
      case "upcoming":
        return "bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-100";
      case "completed":
        return "bg-yellow-100 dark:bg-yellow-800 text-yellow-900 dark:text-yellow-100";
      default:
        return "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100";
    }
  };

  const getProgressPercentage = () => {
    // Time-based progress between start and end dates
    const start = new Date(campaign.startDate).getTime();
    const end = new Date(campaign.endDate).getTime();
    const now = Date.now();
    const totalDuration = Math.max(0, end - start);
    const elapsed = Math.max(0, Math.min(now - start, totalDuration));
    return totalDuration > 0 ? (elapsed / totalDuration) * 100 : 0;
  };

  const isExpired = campaign.isExpired;
  const { src: coverImageSrc, isLoading: coverImageLoading } =
    useCampaignCoverImage(campaign.image);

  return (
    <div className="relative w-full max-w-[420px] md:w-[420px] justify-self-center">
      {/* Four corner square indents - positioned outside the card */}
      {/* Top-left: no border */}
      <div 
        className="absolute -top-1 -left-1 w-4 h-4 bg-black dark:bg-black z-20"
      />
      {/* Top-right: left border (inset) */}
      <div 
        className="absolute -top-1 -right-1 w-4 h-4 bg-black dark:bg-black z-20"
        style={{
          boxShadow: "inset 1px 0 0 0 #1F2937",
        }}
      />
      {/* Bottom-right: top and left border (inset) */}
      <div 
        className="absolute -bottom-1 -right-1 w-4 h-4 bg-black dark:bg-black z-20"
        style={{
          boxShadow: "inset 1px 0 0 0 #1F2937, inset 0 1px 0 0 #1F2937",
        }}
      />
      {/* Bottom-left: top border (inset) */}
      <div 
        className="absolute -bottom-1 -left-1 w-4 h-4 bg-black dark:bg-black z-20"
        style={{
          boxShadow: "inset 0 1px 0 0 #1F2937",
        }}
      />
    <Card 
      className="overflow-hidden hover:shadow-lg transition-shadow flex flex-col h-full w-full bg-black dark:bg-black border-gray-800 dark:border-gray-800 relative z-10"
      style={{
        borderRadius: "8px",
      }}
    >
      <CampaignCoverImage
        src={coverImageSrc}
        alt={campaign.title}
        isLoading={coverImageLoading}
        className="bg-gradient-to-r from-purple-100 to-blue-100 dark:from-purple-900/20 dark:to-blue-900/20"
      >
        <div className="absolute top-4 left-4 flex gap-2">
          <Badge
            className={`${getStatusColor(campaign.status)} ${
              onStatusClick ? "cursor-pointer hover:opacity-80" : ""
            } ${
              selectedStatuses.includes(campaign.status)
                ? "ring-2 ring-white ring-offset-2"
                : ""
            }`}
            onClick={
              onStatusClick
                ? (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onStatusClick(campaign.status);
                  }
                : undefined
            }
          >
            {capitalizeFirstLetter(campaign.status)}
          </Badge>
          <Badge
            className={`${getDifficultyColor(campaign.difficulty)} ${
              onDifficultyClick ? "cursor-pointer hover:opacity-80" : ""
            } ${
              selectedDifficulties.includes(campaign.difficulty.toLowerCase())
                ? "ring-2 ring-white ring-offset-2"
                : ""
            }`}
            onClick={
              onDifficultyClick
                ? (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDifficultyClick(campaign.difficulty.toLowerCase());
                  }
                : undefined
            }
          >
            {capitalizeFirstLetter(campaign.difficulty)}
          </Badge>
        </div>
        <div className="absolute top-4 right-4">
          {isExpired ? (
            <Badge
              variant="outline"
              className="bg-white/90 dark:bg-gray-900/70 text-red-600 dark:text-red-300 border-red-200 dark:border-red-500"
            >
              <AlertTriangle className="w-3 h-3 mr-1" />
              Event ended
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="bg-white/90 dark:bg-gray-800 dark:text-gray-200"
            >
              <Clock className="w-3 h-3 mr-1" />
              {getDaysUntilEnd(campaign.endDate)}d left
            </Badge>
          )}
        </div>
      </CampaignCoverImage>

      <CardHeader className="flex-shrink-0 max-w-[420px] bg-black dark:bg-black">
        <div className="flex items-start justify-between width-full">
          <div className="flex-1 w-full">
            <CardTitle className="text-lg mb-2 break-words whitespace-normal w-full text-white">
              {campaign.title}
            </CardTitle>
            <p className="text-sm text-gray-400 mb-3 break-words whitespace-normal">
              {campaign.shortDescription}
            </p>
            <div className="text-xs text-gray-400 break-words whitespace-normal">
              Endorsed by {campaign.endorserName}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col justify-between bg-black dark:bg-black">
        {/* Main content */}
        <div className="space-y-4">
          {/* Categories */}
          <div className="flex flex-wrap gap-1">
            {campaign.categories.slice(0, 3).map((category) => {
              const isSelected = selectedCategories.includes(
                category.toLowerCase()
              );
              return (
                <Badge
                  key={category}
                  variant="outline"
                  className={`text-xs rounded-full ${
                    onCategoryClick ? "cursor-pointer hover:opacity-80" : ""
                  } bg-black border border-white text-white`}
                  onClick={
                    onCategoryClick
                      ? (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onCategoryClick(category.toLowerCase());
                        }
                      : undefined
                  }
                >
                  {category}
                </Badge>
              );
            })}
            {campaign.categories.length > 3 && (
              <Badge
                variant="outline"
                className="text-xs rounded-full bg-black border border-white text-white"
              >
                +{campaign.categories.length - 3}
              </Badge>
            )}
          </div>

          {/* Progress (time-based, consistent with campaign detail) */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-white">
              <span>Campaign Progress</span>
              <span>{getProgressPercentage().toFixed(0)}%</span>
            </div>
            <div 
              className="relative w-full overflow-hidden transition-all"
              style={{
                height: "17px",
                borderRadius: "99px",
                background: "linear-gradient(180deg, #313131 0%, #535353 100%)",
                boxShadow: "0 1px 1.7px 0 rgba(0, 0, 0, 0.25) inset",
              }}
            >
              <div 
                className="h-full transition-all"
                style={{
                  width: `${getProgressPercentage()}%`,
                  height: "17px",
                  borderRadius: "99px",
                  background: "linear-gradient(180deg, #00FFC3 0%, #00B88D 100%)",
                  boxShadow: "3px 0 3.9px 0 rgba(0, 0, 0, 0.14), 0 2px 2px 0 #FFF inset",
                }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-400">
              <span>Started: {formatDateConsistent(campaign.startDate)}</span>
              <span>Ends: {formatDateConsistent(campaign.endDate)}</span>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-2 text-white">
              <Users className="w-4 h-4 text-blue-400" />
              <span>{Number(campaign.total_completions || 0)} completions</span>
            </div>
            <div className="flex items-center gap-2 text-white">
              <Calendar className="w-4 h-4 text-orange-400" />
              <span>
                Ends {new Date(campaign.endDate).toLocaleDateString()}
              </span>
            </div>
          </div>

          {/* Rewards */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <Trophy className="w-4 h-4 text-yellow-400" />
              <span>Total Rewards per User</span>
            </div>
            <div className="flex items-center gap-4 text-sm text-white">
              <div className="flex items-center gap-1">
                <Trophy className="w-3 h-3 text-yellow-400" />
                <span>{campaign.totalRewards.points.toString()} Points</span>
              </div>
              {campaign.totalRewards.tokens.map((token, index) => {
                // Get token info from registry to format amount properly
                const tokenInfo = udtRegistry.getTokenBySymbol(token.symbol);
                const formattedAmount = tokenInfo
                  ? udtRegistry.formatAmount(Number(token.amount), tokenInfo)
                  : `${Number(token.amount) / 10 ** 8}`;

                return (
                  <div key={index} className="flex items-center gap-1">
                    <Coins className="w-3 h-3 text-green-400" />
                    <span>
                      {formattedAmount} {token.symbol}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* No Verification Message */}
          {campaign.verificationRequirements &&
            !campaign.verificationRequirements.telegram &&
            !campaign.verificationRequirements.kyc &&
            !campaign.verificationRequirements.did &&
            !campaign.verificationRequirements.manualReview &&
            !campaign.verificationRequirements.twitter &&
            !campaign.verificationRequirements.discord &&
            !campaign.verificationRequirements.reddit && (
              <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-blue-800 dark:text-blue-200">
                    <div className="font-medium mb-1">
                      No Verification Required!
                    </div>
                    <div>
                      You can start completing tasks immediately and collect
                      rewards after verifying your Telegram account.
                    </div>
                  </div>
                </div>
              </div>
            )}

          {/* Verification Requirements */}
          {campaign.verificationRequirements && (
            <div className="space-y-2">
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {/* Telegram */}
                  {campaign.verificationRequirements.telegram && (
                    <div
                      className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
                        CURRENT_USER_VERIFICATION.telegram
                          ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200"
                          : "bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200"
                      }`}
                    >
                      <div className="w-3 h-3 rounded-full bg-blue-500 flex items-center justify-center">
                        <div className="w-2 h-2 bg-white rounded-full"></div>
                      </div>
                      <span>Requires Telegram</span>
                      {CURRENT_USER_VERIFICATION.telegram ? (
                        <CheckCircle className="w-3 h-3 text-green-600" />
                      ) : (
                        <AlertTriangle className="w-3 h-3 text-red-600" />
                      )}
                    </div>
                  )}

                  {/* Twitter/X */}
                  {campaign.verificationRequirements.twitter && (
                    <div
                      className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
                        CURRENT_USER_VERIFICATION.twitter
                          ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200"
                          : "bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200"
                      }`}
                    >
                      <X
                        className={`w-3 h-3 ${
                          CURRENT_USER_VERIFICATION.twitter
                            ? "text-green-600"
                            : "text-black dark:text-white"
                        }`}
                      />
                      <span>Requires X</span>
                      {CURRENT_USER_VERIFICATION.twitter ? (
                        <CheckCircle className="w-3 h-3 text-green-600" />
                      ) : (
                        <AlertTriangle className="w-3 h-3 text-red-600" />
                      )}
                    </div>
                  )}

                  {/* Discord */}
                  {campaign.verificationRequirements.discord && (
                    <div
                      className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
                        CURRENT_USER_VERIFICATION.discord
                          ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200"
                          : "bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200"
                      }`}
                    >
                      <div className="w-3 h-3 rounded bg-indigo-500 flex items-center justify-center">
                        <div className="w-2 h-1 bg-white rounded"></div>
                      </div>
                      <span>Requires Discord</span>
                      {CURRENT_USER_VERIFICATION.discord ? (
                        <CheckCircle className="w-3 h-3 text-green-600" />
                      ) : (
                        <AlertTriangle className="w-3 h-3 text-red-600" />
                      )}
                    </div>
                  )}

                  {/* Reddit */}
                  {campaign.verificationRequirements.reddit && (
                    <div
                      className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
                        CURRENT_USER_VERIFICATION.reddit
                          ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200"
                          : "bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200"
                      }`}
                    >
                      <div className="w-3 h-3 rounded-full bg-orange-500 flex items-center justify-center">
                        <div className="w-1.5 h-1.5 bg-white rounded-full"></div>
                      </div>
                      <span>Requires Reddit</span>
                      {CURRENT_USER_VERIFICATION.reddit ? (
                        <CheckCircle className="w-3 h-3 text-green-600" />
                      ) : (
                        <AlertTriangle className="w-3 h-3 text-red-600" />
                      )}
                    </div>
                  )}

                  {/* Manual Review - only if KYC/DID not available and not excluded */}
                  {campaign.verificationRequirements.manualReview &&
                    !campaign.verificationRequirements.kyc &&
                    !campaign.verificationRequirements.did && (
                      <div
                        className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
                          CURRENT_USER_VERIFICATION.manualReview
                            ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200"
                            : "bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200"
                        }`}
                      >
                        <User
                          className={`w-3 h-3 ${
                            CURRENT_USER_VERIFICATION.manualReview
                              ? "text-green-600"
                              : "text-orange-600"
                          }`}
                        />
                        <span>Requires Manual Review</span>
                        {CURRENT_USER_VERIFICATION.manualReview ? (
                          <CheckCircle className="w-3 h-3 text-green-600" />
                        ) : (
                          <AlertTriangle className="w-3 h-3 text-red-600" />
                        )}
                      </div>
                    )}

                  {/* Identity Verification - KYC OR DID - Show last since it's longer */}
                  {(campaign.verificationRequirements.kyc ||
                    campaign.verificationRequirements.did) && (
                    <div
                      className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
                        CURRENT_USER_VERIFICATION.kyc ||
                        CURRENT_USER_VERIFICATION.did
                          ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200"
                          : "bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200"
                      }`}
                    >
                      <Shield
                        className={`w-3 h-3 ${
                          CURRENT_USER_VERIFICATION.kyc ||
                          CURRENT_USER_VERIFICATION.did
                            ? "text-green-600"
                            : "text-purple-600"
                        }`}
                      />
                      <span>Requires Identity (KYC or DID)</span>
                      {CURRENT_USER_VERIFICATION.kyc ||
                      CURRENT_USER_VERIFICATION.did ? (
                        <CheckCircle className="w-3 h-3 text-green-600" />
                      ) : (
                        <AlertTriangle className="w-3 h-3 text-red-600" />
                      )}
                    </div>
                  )}
                </div>

                {/* Verification Status - only show if there are actual requirements */}
                {(() => {
                  // Check if there are any actual verification requirements
                  const hasRequirements =
                    campaign.verificationRequirements.telegram ||
                    campaign.verificationRequirements.kyc ||
                    campaign.verificationRequirements.did ||
                    campaign.verificationRequirements.manualReview ||
                    campaign.verificationRequirements.twitter ||
                    campaign.verificationRequirements.discord ||
                    campaign.verificationRequirements.reddit;

                  if (!hasRequirements) {
                    return null; // Don't show verification status for campaigns with no requirements
                  }

                  const isEligible = meetsVerificationRequirements(
                    campaign.verificationRequirements
                  );

                  if (!isEligible) {
                    return (
                      <div className="text-xs text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-900/40 p-2 rounded">
                        ⚠️ Complete required verifications to participate
                      </div>
                    );
                  } else {
                    return (
                      <div className="text-xs text-green-600 dark:text-green-300 bg-green-50 dark:bg-green-900/40 p-2 rounded">
                        ✅ You meet all verification requirements
                      </div>
                    );
                  }
                })()}

                {/* Verification Logic Explanation */}
                {(campaign.verificationRequirements.kyc ||
                  campaign.verificationRequirements.did) && (
                  <div className="text-xs text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/40 p-2 rounded">
                    💡 Having either KYC or DID verification satisfies identity
                    requirements
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Action Button - Always at bottom */}
        <div className="mt-4 pt-4">
          <Link
            href={`/campaign/${campaign.typeId || campaign.typeHash || ""}`}
            className="block"
          >
            <Button
              size="lg"
              aria-label={
                isExpired
                  ? "View campaign details"
                  : "Go to campaign and start completing quests"
              }
              variant={isExpired ? "outline" : undefined}
              className={
                isExpired
                  ? "w-full border-dashed border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
                  : "w-full rounded-full text-white font-semibold shadow-lg border-0 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 hover:opacity-90 transition-opacity"
              }
              style={
                !isExpired
                  ? {
                      backgroundColor: "#0000FF",
                    }
                  : undefined
              }
            >
              {isExpired ? (
                "View Details"
              ) : (
                <>
                  Get Started! <ArrowRight className="w-4 h-4 ml-1 inline" />
                </>
              )}
            </Button>
          </Link>
          {isExpired && (
            <p className="text-xs text-center text-muted-foreground mt-2">
              Ended on {formatDateConsistent(campaign.endDate)}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
    </div>
  );
}
