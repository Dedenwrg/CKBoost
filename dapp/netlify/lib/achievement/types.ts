export interface AchievementQuerySuccessResponse {
  success: true;
  completedAchievements: number;
  /**
   * Achievements that would be granted if the provided transaction is submitted.
   */
  grantable: string[];
  alreadyClaimed: string[];
}

export interface AchievementQueryErrorResponse {
  success: false;
  error: string;
  message: string;
}

export type AchievementQueryResponse =
  | AchievementQuerySuccessResponse
  | AchievementQueryErrorResponse;
