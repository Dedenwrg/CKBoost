// Utilities for autosaving campaign creation drafts with versioning in localStorage
// Now backed by a generic, reusable draft store.

import { createDraftStore, type DraftVersion } from "@/lib/utils/draft-storage"

export type DraftFundingEntry = { scriptHash: string; amount: string }

export interface CampaignCreateDraftPayload {
  // Keep this shape loose to avoid tight coupling with UI types
  campaignData: Record<string, unknown>
  // Quests as plain objects (QuestDataLike-compatible shape)
  quests: Array<Record<string, unknown>>
  // Map cannot be serialized directly, so we store entries
  initialFunding: DraftFundingEntry[] // [ { scriptHash, amount (decimal string) } ]
  ckbInitialFunding: string // decimal string
}

// Build a canonical object with ordered keys to stabilize signatures
function canonicalizeDraft(payload: CampaignCreateDraftPayload): unknown {
  const canonicalQuests = (payload.quests || []).map((q) => {
    const obj = q as Record<string, unknown>
    return {
      // Typical quest fields in explicit order if present
      quest_id: obj["quest_id"] ?? null,
      metadata: obj["metadata"] ?? null,
      points: obj["points"] ?? null,
      rewards_on_completion: Array.isArray(obj["rewards_on_completion"]) ? (obj["rewards_on_completion"] as unknown[]) : [],
      accepted_submission_user_type_ids: Array.isArray(obj["accepted_submission_user_type_ids"]) ? (obj["accepted_submission_user_type_ids"] as unknown[]) : [],
      completion_deadline: obj["completion_deadline"] ?? null,
      status: obj["status"] ?? null,
      sub_tasks: Array.isArray(obj["sub_tasks"]) ? (obj["sub_tasks"] as unknown[]) : [],
      completion_count: (obj["completion_count"] as unknown) ?? 0,
    }
  })

  const canonicalFunding = [...(payload.initialFunding || [])]
    .map((e) => ({ scriptHash: e.scriptHash, amount: String(e.amount) }))
    .sort((a, b) => a.scriptHash.localeCompare(b.scriptHash))

  const cd = (payload.campaignData || {}) as Record<string, unknown>
  // Order key fields commonly used in the form; include rest as-is to avoid data loss
  const rest: Record<string, unknown> = { ...cd }
  const title = typeof cd["title"] === "string" ? (cd["title"] as string) : ""
  const shortDescription = typeof cd["shortDescription"] === "string" ? (cd["shortDescription"] as string) : ""
  const longDescription = typeof cd["longDescription"] === "string" ? (cd["longDescription"] as string) : ""
  const categories = Array.isArray(cd["categories"]) ? (cd["categories"] as unknown[]) : []
  const startDate = typeof cd["startDate"] === "string" ? (cd["startDate"] as string) : ""
  const endDate = typeof cd["endDate"] === "string" ? (cd["endDate"] as string) : ""
  const difficulty = typeof cd["difficulty"] === "number" ? (cd["difficulty"] as number) : 0
  const verificationLevel = typeof cd["verificationLevel"] === "string" ? (cd["verificationLevel"] as string) : "none"
  const rules = Array.isArray(cd["rules"]) ? (cd["rules"] as unknown[]) : []

  // remove known fields from rest so they don't get duplicated
  delete rest["title"]
  delete rest["shortDescription"]
  delete rest["longDescription"]
  delete rest["categories"]
  delete rest["startDate"]
  delete rest["endDate"]
  delete rest["difficulty"]
  delete rest["verificationLevel"]
  delete rest["rules"]

  return {
    campaignData: {
      title,
      shortDescription,
      longDescription,
      categories,
      startDate,
      endDate,
      difficulty,
      verificationLevel,
      rules,
      // Preserve any extra fields while keeping canonical order above
      ...rest,
    },
    quests: canonicalQuests,
    initialFunding: canonicalFunding,
    ckbInitialFunding: String(payload.ckbInitialFunding ?? "0"),
  }
}

const store = createDraftStore<CampaignCreateDraftPayload>({
  storageKey: "ckboost_campaign_create",
  versionLimit: 10,
  canonicalize: canonicalizeDraft,
})

export function loadCreateDraft(): CampaignCreateDraftPayload | null {
  return store.load()
}

export function getCreateDraftHistory(): DraftVersion<CampaignCreateDraftPayload>[] {
  return store.history()
}

export function saveCreateDraft(payload: CampaignCreateDraftPayload): {
  saved: boolean
  skipped: boolean
  versions: number
} {
  return store.save(payload)
}

export function clearCreateDraft(): void {
  return store.clear()
}
