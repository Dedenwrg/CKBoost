export interface StaffApprovalRequestPayload {
  txHex: string;
  campaignTypeId: string;
  questId: number;
  userTypeIds: string[];
}

export interface StaffApprovalResponseSuccess {
  success: true;
  txHex: string;
}

export interface StaffApprovalResponseError {
  success: false;
  error: string;
  message?: string;
}

export type StaffApprovalResponse =
  | StaffApprovalResponseSuccess
  | StaffApprovalResponseError;
