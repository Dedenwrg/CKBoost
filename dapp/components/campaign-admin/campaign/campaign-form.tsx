"use client";

import React, { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Upload, X } from "lucide-react";
import { MarkdownEditor } from "@/components/markdown-editor";
import { CampaignCard } from "@/components/campaign-card";
import type { CampaignDisplay } from "@/lib";
import { ccc } from "@ckb-ccc/connector-react";

const DIFFICULTY_LABELS = ["beginner", "medium", "advanced"] as const;

const buildVerificationRequirements = (level: string) => ({
  telegram: level === "telegram",
  kyc: level === "kyc",
  did: level === "did",
  manualReview: level === "manual",
  twitter: level === "twitter",
  discord: level === "discord",
  reddit: level === "reddit",
  excludeManualReview: false,
});

const verificationLevelToBitmask = (level: string): number => {
  const map: Record<string, number> = {
    none: 0,
    telegram: 1,
    kyc: 2,
    did: 4,
    manual: 8,
    twitter: 16,
    discord: 32,
    reddit: 64,
  };
  return map[level] ?? 0;
};

interface CampaignFormData {
  title: string;
  shortDescription: string;
  longDescription: string;
  categories: string[];
  startDate: string;
  endDate: string;
  difficulty: number;
  verificationLevel: string;
  rules: string[];
}

interface CampaignFormProps {
  campaignData: CampaignFormData;
  onChange: (data: CampaignFormData) => void;
  isCreateMode: boolean;
  readOnly?: boolean;
  coverImage?: {
    dataUrl?: string;
    neventId?: string;
    isLoading?: boolean;
  };
  onCoverImageChange?: (dataUrl: string | null) => void;
  onCoverImageClear?: () => void;
  longDescriptionNeventId?: string | null;
}

export function CampaignForm({
  campaignData,
  onChange,
  isCreateMode,
  readOnly = false,
  coverImage,
  onCoverImageChange,
  onCoverImageClear,
  longDescriptionNeventId,
}: CampaignFormProps) {
  const previewCampaign = useMemo<CampaignDisplay>(() => {
    const now = Date.now();
    const start = campaignData.startDate
      ? new Date(campaignData.startDate)
      : new Date(now);
    const end = campaignData.endDate
      ? new Date(campaignData.endDate)
      : new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
    const previewImage =
      coverImage?.dataUrl || coverImage?.neventId || "/placeholder.svg";

    let statusLabel = "active";
    if (now >= end.getTime()) {
      statusLabel = "completed";
    } else if (now < start.getTime()) {
      statusLabel = "upcoming";
    } else if (end.getTime() - now <= 30 * 24 * 60 * 60 * 1000) {
      statusLabel = "ending-soon";
    }

    const verificationLevel = campaignData.verificationLevel || "none";
    const metadata = {
      title: campaignData.title || "Untitled Campaign",
      short_description: campaignData.shortDescription || "",
      long_description: campaignData.longDescription || "",
      total_rewards: {
        points_amount: BigInt(0),
        ckb_amount: BigInt(0),
        nft_assets: [],
        udt_assets: [],
      },
      verification_requirements: [
        verificationLevelToBitmask(verificationLevel),
      ],
      last_updated: BigInt(Math.floor(Date.now() / 1000)),
      categories: campaignData.categories || [],
      difficulty: BigInt(campaignData.difficulty ?? 0),
      image_url: previewImage,
    };

    const preview = {
      endorser_lock_hash: "0x",
      staff_lock_hash_vec: [],
      created_at: BigInt(Math.floor(Date.now() / 1000)),
      starting_time: BigInt(Math.floor(start.getTime() / 1000)),
      ending_time: BigInt(Math.floor(end.getTime() / 1000)),
      rules: campaignData.rules || [],
      metadata,
      status: statusLabel,
      quests: [],
      participants_count: BigInt(0),
      total_completions: BigInt(0),
      id: "preview-campaign-card",
      typeHash: "preview-campaign-card",
      typeId: null,
      isExpired: now >= end.getTime(),
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      createdAt: new Date().toISOString(),
      questsCount: 0,
      questsCompleted: 0,
      totalRewards: {
        points: ccc.numFrom(0),
        tokens: [],
      },
      verificationRequirements: buildVerificationRequirements(verificationLevel),
      difficulty: DIFFICULTY_LABELS[campaignData.difficulty] ?? "beginner",
      cell: {} as ccc.Cell,
      title: campaignData.title || "Untitled Campaign",
      shortDescription: campaignData.shortDescription || "",
      categories: campaignData.categories || [],
      endorserName: "Pending Endorser",
      endorserLockHash: null,
      endorser: null,
      image: previewImage,
    } as CampaignDisplay;

    return preview;
  }, [campaignData, coverImage?.dataUrl, coverImage?.neventId]);

  const handleChange = (field: keyof CampaignFormData, value: unknown) => {
    onChange({
      ...campaignData,
      [field]: value,
    });
  };

  const handleAddCategory = () => {
    if (readOnly) return;
    const category = prompt("Enter category name:");
    if (category) {
      handleChange("categories", [...campaignData.categories, category]);
    }
  };

  const handleRemoveCategory = (index: number) => {
    if (readOnly) return;
    handleChange(
      "categories",
      campaignData.categories.filter((_, i) => i !== index)
    );
  };

  const handleAddRule = () => {
    if (readOnly) return;
    handleChange("rules", [...campaignData.rules, ""]);
  };

  const handleRuleChange = (index: number, value: string) => {
    const newRules = [...campaignData.rules];
    newRules[index] = value;
    handleChange("rules", newRules);
  };

  const handleRemoveRule = (index: number) => {
    if (readOnly) return;
    handleChange(
      "rules",
      campaignData.rules.filter((_, i) => i !== index)
    );
  };

  const handleCoverImageSelect = (files: FileList | null) => {
    if (!onCoverImageChange || readOnly) return;
    const file = files?.[0];
    if (!file) {
      onCoverImageChange(null);
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      onCoverImageChange(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-6">
      {/* Basic Information */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Basic Information</h3>

        <div>
          <Label htmlFor="title">Campaign Title</Label>
          <Input
            id="title"
            value={campaignData.title}
            disabled={readOnly}
            onChange={(e) => handleChange('title', e.target.value)}
            placeholder="Enter campaign title"
          />
        </div>

        <div>
          <Label htmlFor="shortDescription">Short Description</Label>
          <textarea
            id="shortDescription"
            rows={2}
            value={campaignData.shortDescription}
            disabled={readOnly}
            onChange={(e) => handleChange('shortDescription', e.target.value)}
            placeholder="Brief description for campaign cards"
            className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          ></textarea>
        </div>

        <div>
          <Label htmlFor="longDescription">Long Description</Label>
          <MarkdownEditor
            id="longDescription"
            value={campaignData.longDescription}
            onChange={(value) => handleChange("longDescription", value)}
            placeholder="Detailed campaign description and instructions"
            height={320}
            disabled={readOnly}
          />
          {longDescriptionNeventId && (
            <p className="mt-2 text-xs text-muted-foreground">
              Long description stored via Nostr event{" "}
              <span className="font-mono">
                {longDescriptionNeventId.slice(0, 18)}…
              </span>
            </p>
          )}
        </div>

        <div>
          <Label>Categories</Label>
          <div className="flex flex-wrap gap-2 mb-2">
            {campaignData.categories.map((category, index) => (
              <Badge
                key={index}
                variant="secondary"
                className={readOnly ? "cursor-default" : "cursor-pointer"}
                onClick={() => !readOnly && handleRemoveCategory(index)}
              >
                {category} ×
              </Badge>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddCategory}
              disabled={readOnly}
              className="border-dashed"
            >
              <Plus className="w-3 h-3 mr-1" />
              Add Category
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Cover Image</Label>
          <div className="flex flex-col gap-3 rounded-lg border border-dashed p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm text-muted-foreground">
                Upload a hero image that will be shown on the campaign landing
                page. Images are stored via Nostr and referenced on-chain.
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="relative"
                  disabled={readOnly}
                  onClick={() => {
                    const input = document.getElementById(
                      "campaign-cover-image"
                    ) as HTMLInputElement | null;
                    input?.click();
                  }}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Choose Image
                </Button>
                {onCoverImageClear && coverImage?.dataUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onCoverImageClear}
                    disabled={readOnly}
                  >
                    <X className="w-4 h-4 mr-2" />
                    Clear
                  </Button>
                )}
              </div>
            </div>
            <input
              id="campaign-cover-image"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) =>
                handleCoverImageSelect(event.target.files ?? null)
              }
              disabled={readOnly}
            />
            <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
              <div className="space-y-3">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Campaign Card Preview
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    This is the exact card layout used on the public campaign list.
                  </p>
                </div>
                <div
                  className="w-full max-w-[420px] pointer-events-none"
                  aria-hidden="true"
                >
                  <CampaignCard campaign={previewCampaign} />
                </div>
                {coverImage?.isLoading && (
                  <p className="text-muted-foreground">
                    Loading cover image from Nostr...
                  </p>
                )}
                {coverImage?.neventId && (
                  <p>
                    Stored via Nostr event{" "}
                    <span className="font-mono">
                      {coverImage.neventId.slice(0, 18)}…
                    </span>
                    {!coverImage?.dataUrl && !coverImage?.isLoading
                      ? " . Content not loaded yet."
                      : ""}
                  </p>
                )}
                {!coverImage?.dataUrl && !coverImage?.neventId && (
                  <p>No cover image selected yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Campaign Settings */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Campaign Settings</h3>
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="startDate">Start Date</Label>
            <Input
              id="startDate"
              type="datetime-local"
              value={campaignData.startDate}
              disabled={readOnly}
              onChange={(e) => handleChange('startDate', e.target.value)}
            />
          </div>
          
          <div>
            <Label htmlFor="endDate">End Date</Label>
            <Input
              id="endDate"
              type="datetime-local"
              value={campaignData.endDate}
              disabled={readOnly}
              onChange={(e) => handleChange('endDate', e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="difficulty">Difficulty Level</Label>
            <select
              id="difficulty"
              className="w-full p-2 border rounded-md"
              value={campaignData.difficulty}
              disabled={readOnly}
              onChange={(e) => handleChange('difficulty', parseInt(e.target.value))}
            >
              <option value={0}>Beginner</option>
              <option value={1}>Intermediate</option>
              <option value={2}>Advanced</option>
            </select>
          </div>
          
          <div>
            <Label htmlFor="verificationLevel">Verification Level</Label>
            <select
              id="verificationLevel"
              className="w-full p-2 border rounded-md"
              value={campaignData.verificationLevel}
              disabled={readOnly}
              onChange={(e) => handleChange('verificationLevel', e.target.value)}
            >
              <option value="none">None</option>
              <option value="telegram">Telegram</option>
              <option value="twitter">Twitter</option>
              <option value="discord">Discord</option>
              <option value="manual">Manual Review</option>
            </select>
          </div>
        </div>
      </div>

      {/* Campaign Rules */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Campaign Rules</h3>
          <Button
            type="button"
            onClick={handleAddRule}
            variant="link"
            className="px-0 text-sm"
            disabled={readOnly}
          >
            <Plus className="w-4 h-4 inline mr-1" />
            Add Rule
          </Button>
        </div>
        
        <div className="space-y-2">
          {campaignData.rules.map((rule, index) => (
            <div key={index} className="flex gap-2">
              <Input
                value={rule}
                disabled={readOnly}
                onChange={(e) => handleRuleChange(index, e.target.value)}
                placeholder={`Rule ${index + 1}`}
              />
              <Button
                type="button"
                onClick={() => handleRemoveRule(index)}
                className="px-3 py-1 text-sm text-destructive hover:bg-destructive/10 rounded"
                variant="ghost"
                disabled={readOnly}
              >
                Remove
              </Button>
            </div>
          ))}
          {campaignData.rules.length === 0 && (
            <p className="text-sm text-muted-foreground">No rules added yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
