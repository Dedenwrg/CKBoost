// Main exports for the lib directory
// This file provides a clean API for importing from lib

// UI-specific types only (for forms, metrics, components)
export * from './types/index'

// Providers
export { CampaignProvider, useCampaigns, useCampaign } from './providers/campaign-provider'

// Services  
export { CampaignService } from './services/campaign-service'
export {
  AchievementService,
  type UserAchievement,
  type ClaimAchievementResult,
  type ClaimAchievementResponse,
  type FailedClaimResponse,
} from './services/achievement-service'
export type { AchievementQueryResponse } from '@/netlify/lib/achievement/types'

// Utils (campaign utilities)
export * from './utils/campaign-utils'
export { cellToCampaignDisplay, type CampaignDisplay } from './utils/campaign-utils'

// CKB Integration (for advanced users)
export * from './ckb/campaign-cells'

// Re-export commonly used SSRI types for convenience
export type { CampaignDataLike, QuestDataLike } from 'ssri-ckboost/types'
export { LeaderboardService, InMemoryLeaderboardCache } from './services/leaderboard-service'
export type {
  LeaderboardStats,
  LeaderboardEntry,
  PointsMintRecord,
  PointsMintRecipient,
  LeaderboardCacheSnapshot,
} from './types/leaderboard'
