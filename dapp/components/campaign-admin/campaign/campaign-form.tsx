"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Upload, X } from "lucide-react";
import { MarkdownEditor } from "@/components/markdown-editor";

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
              {coverImage?.isLoading ? (
                <p>Loading cover image from Nostr...</p>
              ) : coverImage?.dataUrl ? (
                <div className="space-y-2">
                  <img
                    src={coverImage.dataUrl}
                    alt="Campaign cover preview"
                    className="max-h-48 w-full rounded-md object-cover"
                  />
                  {coverImage.neventId && (
                    <div>
                      Stored via Nostr event{" "}
                      <span className="font-mono">
                        {coverImage.neventId.slice(0, 18)}…
                      </span>
                    </div>
                  )}
                </div>
              ) : coverImage?.neventId ? (
                <p>
                  Image stored via Nostr event{" "}
                  <span className="font-mono">
                    {coverImage.neventId.slice(0, 18)}…
                  </span>
                  . Content not loaded yet.
                </p>
              ) : (
                <p>No cover image selected yet.</p>
              )}
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
