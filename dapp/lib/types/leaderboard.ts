// Shared leaderboard data contracts between services and UI
import { ccc } from "@ckb-ccc/connector-react";

export interface PointsMintRecipient {
  outputIndex: number;
  lock: ccc.ScriptLike;
  lockHash: ccc.Hex;
  mintedAmount: string;
  totalOutputAmount: string;
  address?: string;
}

export interface PointsMintRecord {
  txHash: ccc.Hex;
  blockNumber?: string;
  totalMinted: string;
  recipients: PointsMintRecipient[];
}

export interface LeaderboardCacheSnapshot {
  lastProcessedBlock: string;
  mintedTransactions: PointsMintRecord[];
}

export interface LeaderboardEntry {
  lockHash: ccc.Hex;
  address?: string;
  totalMinted: string;
  lock: ccc.ScriptLike;
}

export interface LeaderboardStats {
  lastProcessedBlock: string;
  mintedTransactions: PointsMintRecord[];
  totals: LeaderboardEntry[];
}
