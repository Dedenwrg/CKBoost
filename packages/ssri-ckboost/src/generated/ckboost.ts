// Auto-generated TypeScript types for CKBoost molecule schema
// This file uses CCC and mol types directly where available

import { mol, ccc } from "@ckb-ccc/core";

// CKBoost molecule codec implementations
export const BytesOptVec = mol.vector(mol.BytesOpt);
export const ProposalShortId = mol.array(mol.Uint8, 10);
export const RawHeader = mol.struct({
  version: mol.Uint32,
  compact_target: mol.Uint32,
  timestamp: mol.Uint64,
  number: mol.Uint64,
  epoch: mol.Uint64,
  parent_hash: mol.Byte32,
  transactions_root: mol.Byte32,
  proposals_hash: mol.Byte32,
  extra_hash: mol.Byte32,
  dao: mol.Byte32
});
export const ProposalShortIdVec = mol.vector(ProposalShortId);
export const CellbaseWitness = mol.table({
  lock: ccc.Script,
  message: mol.Bytes
});
export const CellDepVecOpt = mol.option(mol.vector(ccc.CellDep));
export const Byte32VecOpt = mol.option(mol.Byte32Vec);
export const RecipeArgument = mol.table({
  arg_type: mol.Uint8,
  data: mol.Bytes
});
export const RecipeArgumentVec = mol.vector(RecipeArgument);
export const TransactionRecipe = mol.table({
  method_path: mol.Bytes,
  arguments: RecipeArgumentVec,
  cell_deps: CellDepVecOpt,
  header_deps: Byte32VecOpt
});
export const StringVec = mol.vector(mol.String);
export const UDTAsset = mol.table({
  udt_script: ccc.Script,
  amount: mol.Uint128
});
export const UDTAssetVec = mol.vector(UDTAsset);
export const AssetList = mol.table({
  points_amount: mol.Uint128,
  ckb_amount: mol.Uint128,
  nft_assets: mol.vector(ccc.Script),
  udt_assets: UDTAssetVec
});
export const AssetListVec = mol.vector(AssetList);
export const QuestSubTaskData = mol.table({
  id: mol.Uint8,
  title: mol.String,
  type: mol.String,
  description: mol.String,
  proof_required: mol.String
});
export const QuestSubTaskDataVec = mol.vector(QuestSubTaskData);
export const QuestMetadata = mol.table({
  title: mol.String,
  short_description: mol.String,
  long_description: mol.String,
  requirements: mol.String,
  difficulty: mol.Uint8,
  time_estimate: mol.Uint32
});
export const QuestData = mol.table({
  quest_id: mol.Uint32,
  metadata: QuestMetadata,
  rewards_on_completion: AssetListVec,
  accepted_submission_user_type_ids: mol.Byte32Vec,
  completion_deadline: mol.Uint64,
  status: mol.Uint8,
  sub_tasks: QuestSubTaskDataVec,
  points: mol.Uint128,
  completion_count: mol.Uint32
});
export const QuestDataVec = mol.vector(QuestData);
export const EndorserInfo = mol.table({
  endorser_lock_hash: mol.Byte32,
  endorser_name: mol.String,
  endorser_description: mol.String,
  website: mol.String,
  social_links: mol.vector(mol.String),
  verified: mol.Uint8
});
export const EndorserInfoVec = mol.vector(EndorserInfo);
export const CampaignMetadata = mol.table({
  title: mol.String,
  short_description: mol.String,
  long_description: mol.String,
  total_rewards: AssetList,
  verification_requirements: mol.Uint8Vec,
  last_updated: mol.Uint64,
  categories: mol.vector(mol.String),
  difficulty: mol.Uint8,
  image_url: mol.String
});
export const CampaignData = mol.table({
  endorser_lock_hash: mol.Byte32,
  staff_lock_hash_vec: mol.Byte32Vec,
  created_at: mol.Uint64,
  starting_time: mol.Uint64,
  ending_time: mol.Uint64,
  rules: mol.vector(mol.String),
  metadata: CampaignMetadata,
  status: mol.Uint8,
  quests: QuestDataVec,
  participants_count: mol.Uint32,
  total_completions: mol.Uint32
});
export const CampaignDataVec = mol.vector(CampaignData);
export const TippingMetadata = mol.table({
  contribution_title: mol.String,
  contribution_type_tags: mol.vector(mol.String),
  short_description: mol.String,
  long_description: mol.String,
  creation_timestamp: mol.Uint64
});
export const TippingData = mol.table({
  target_lock_hash: mol.Byte32,
  proposer_lock_hash: mol.Byte32,
  supporter_lock_hashes: mol.Byte32Vec,
  metadata: TippingMetadata,
  rewards: AssetList,
  status: mol.String,
  granted_at: mol.Uint64
});
export const TippingDataVec = mol.vector(TippingData);
export const TippingConfig = mol.table({
  approval_requirement_thresholds: mol.Uint128Vec,
  expiration_duration: mol.Uint64
});
export const ScriptCodeHashes = mol.table({
  ckb_boost_protocol_type_code_hash: mol.Byte32,
  ckb_boost_protocol_lock_code_hash: mol.Byte32,
  ckb_boost_campaign_type_code_hash: mol.Byte32,
  ckb_boost_funding_lock_code_hash: mol.Byte32,
  ckb_boost_user_type_code_hash: mol.Byte32,
  ckb_boost_points_udt_type_code_hash: mol.Byte32,
  ckb_boost_tipping_type_code_hash: mol.Byte32,
  ckb_boost_achievements_type_code_hash: mol.Byte32,
  accepted_udt_type_scripts: mol.vector(ccc.Script),
  accepted_dob_type_scripts: mol.vector(ccc.Script)
});
export const ProtocolConfig = mol.table({
  admin_lock_hash_vec: mol.Byte32Vec,
  script_code_hashes: ScriptCodeHashes,
  streak_bonus_interval: mol.Uint64,
  streak_bonus_amount: mol.Uint128,
  achievements_type_hashes: mol.Byte32Vec
});
export const ProtocolData = mol.table({
  campaigns_approved: mol.Byte32Vec,
  tippings_approved: mol.Byte32Vec,
  tipping_config: TippingConfig,
  endorsers_whitelist: EndorserInfoVec,
  last_updated: mol.Uint64,
  protocol_config: ProtocolConfig
});
export const AchievementRecord = mol.table({
  receiver_user_type_hash: mol.Byte32,
  granted_at: mol.Uint64
});
export const AchievementRecordVec = mol.vector(AchievementRecord);
export const AchievementData = mol.table({
  achievement_title: mol.String,
  achievement_metadata: mol.String,
  receiver_user_record_vec: AchievementRecordVec
});
export const AchievementDataVec = mol.vector(AchievementData);
export const UserVerificationData = mol.table({
  telegram_personal_chat_id: mol.Uint128,
  identity_verification_data: mol.Bytes
});
export const UserSubmissionRecord = mol.table({
  campaign_type_id: mol.Byte32,
  quest_id: mol.Uint32,
  submission_timestamp: mol.Uint64,
  submission_content: mol.String
});
export const UserSubmissionRecordVec = mol.vector(UserSubmissionRecord);
export const UserData = mol.table({
  verification_data: UserVerificationData,
  total_points_earned: mol.Uint128,
  last_activity_timestamp: mol.Uint64,
  submission_records: UserSubmissionRecordVec,
  profile_data: mol.BytesVec,
  last_bonus_streak_at: mol.Uint64
});
export const ConnectedTypeID = mol.table({
  type_id: mol.Byte32,
  connected_key: mol.Byte32
});

// CKB client block type aliases
export type Header = ccc.ClientBlockHeaderLike;
export type UncleBlock = ccc.ClientBlockUncleLike;
export type UncleBlockVec = UncleBlock[];

// "Like" types for flexible input (similar to CCC pattern)
// Type aliases for vector types used in option types
export type CellDepVecLike = ccc.CellDepLike[];
export type Byte32VecLike = ccc.HexLike[];

export interface RawHeaderLike {
  version: ccc.NumLike;
  compact_target: ccc.NumLike;
  timestamp: ccc.NumLike;
  number: ccc.NumLike;
  epoch: ccc.NumLike;
  parent_hash: ccc.HexLike;
  transactions_root: ccc.HexLike;
  proposals_hash: ccc.HexLike;
  extra_hash: ccc.HexLike;
  dao: ccc.HexLike;
}

export interface CellbaseWitnessLike {
  lock: ccc.ScriptLike;
  message: ccc.BytesLike;
}

export interface RecipeArgumentLike {
  arg_type: ccc.NumLike;
  data: ccc.BytesLike;
}

export interface TransactionRecipeLike {
  method_path: ccc.BytesLike;
  arguments: RecipeArgumentLike[];
  cell_deps: ccc.CellDepLike[] | null;
  header_deps: ccc.HexLike[] | null;
}

export interface UDTAssetLike {
  udt_script: ccc.ScriptLike;
  amount: ccc.NumLike;
}

export interface AssetListLike {
  points_amount: ccc.NumLike;
  ckb_amount: ccc.NumLike;
  nft_assets: ccc.ScriptLike[];
  udt_assets: UDTAssetLike[];
}

export interface QuestSubTaskDataLike {
  id: ccc.NumLike;
  title: string;
  type: string;
  description: string;
  proof_required: string;
}

export interface QuestMetadataLike {
  title: string;
  short_description: string;
  long_description: string;
  requirements: string;
  difficulty: ccc.NumLike;
  time_estimate: ccc.NumLike;
}

export interface QuestDataLike {
  quest_id: ccc.NumLike;
  metadata: QuestMetadataLike;
  rewards_on_completion: AssetListLike[];
  accepted_submission_user_type_ids: ccc.HexLike[];
  completion_deadline: ccc.NumLike;
  status: ccc.NumLike;
  sub_tasks: QuestSubTaskDataLike[];
  points: ccc.NumLike;
  completion_count: ccc.NumLike;
}

export interface EndorserInfoLike {
  endorser_lock_hash: ccc.HexLike;
  endorser_name: string;
  endorser_description: string;
  website: string;
  social_links: string[];
  verified: ccc.NumLike;
}

export interface CampaignMetadataLike {
  title: string;
  short_description: string;
  long_description: string;
  total_rewards: AssetListLike;
  verification_requirements: ccc.NumLike[];
  last_updated: ccc.NumLike;
  categories: string[];
  difficulty: ccc.NumLike;
  image_url: string;
}

export interface CampaignDataLike {
  endorser_lock_hash: ccc.HexLike;
  staff_lock_hash_vec: ccc.HexLike[];
  created_at: ccc.NumLike;
  starting_time: ccc.NumLike;
  ending_time: ccc.NumLike;
  rules: string[];
  metadata: CampaignMetadataLike;
  status: ccc.NumLike;
  quests: QuestDataLike[];
  participants_count: ccc.NumLike;
  total_completions: ccc.NumLike;
}

export interface TippingMetadataLike {
  contribution_title: string;
  contribution_type_tags: string[];
  short_description: string;
  long_description: string;
  creation_timestamp: ccc.NumLike;
}

export interface TippingDataLike {
  target_lock_hash: ccc.HexLike;
  proposer_lock_hash: ccc.HexLike;
  supporter_lock_hashes: ccc.HexLike[];
  metadata: TippingMetadataLike;
  rewards: AssetListLike;
  status: string;
  granted_at: ccc.NumLike;
}

export interface TippingConfigLike {
  approval_requirement_thresholds: ccc.NumLike[];
  expiration_duration: ccc.NumLike;
}

export interface ScriptCodeHashesLike {
  ckb_boost_protocol_type_code_hash: ccc.HexLike;
  ckb_boost_protocol_lock_code_hash: ccc.HexLike;
  ckb_boost_campaign_type_code_hash: ccc.HexLike;
  ckb_boost_funding_lock_code_hash: ccc.HexLike;
  ckb_boost_user_type_code_hash: ccc.HexLike;
  ckb_boost_points_udt_type_code_hash: ccc.HexLike;
  ckb_boost_tipping_type_code_hash: ccc.HexLike;
  ckb_boost_achievements_type_code_hash: ccc.HexLike;
  accepted_udt_type_scripts: ccc.ScriptLike[];
  accepted_dob_type_scripts: ccc.ScriptLike[];
}

export interface ProtocolConfigLike {
  admin_lock_hash_vec: ccc.HexLike[];
  script_code_hashes: ScriptCodeHashesLike;
  streak_bonus_interval: ccc.NumLike;
  streak_bonus_amount: ccc.NumLike;
  achievements_type_hashes: ccc.HexLike[];
}

export interface ProtocolDataLike {
  campaigns_approved: ccc.HexLike[];
  tippings_approved: ccc.HexLike[];
  tipping_config: TippingConfigLike;
  endorsers_whitelist: EndorserInfoLike[];
  last_updated: ccc.NumLike;
  protocol_config: ProtocolConfigLike;
}

export interface AchievementRecordLike {
  receiver_user_type_hash: ccc.HexLike;
  granted_at: ccc.NumLike;
}

export interface AchievementDataLike {
  achievement_title: string;
  achievement_metadata: string;
  receiver_user_record_vec: AchievementRecordLike[];
}

export interface UserVerificationDataLike {
  telegram_personal_chat_id: ccc.NumLike;
  identity_verification_data: ccc.BytesLike;
}

export interface UserSubmissionRecordLike {
  campaign_type_id: ccc.HexLike;
  quest_id: ccc.NumLike;
  submission_timestamp: ccc.NumLike;
  submission_content: string;
}

export interface UserDataLike {
  verification_data: UserVerificationDataLike;
  total_points_earned: ccc.NumLike;
  last_activity_timestamp: ccc.NumLike;
  submission_records: UserSubmissionRecordLike[];
  profile_data: ccc.BytesLike[];
  last_bonus_streak_at: ccc.NumLike;
}

export interface ConnectedTypeIDLike {
  type_id: ccc.HexLike;
  connected_key: ccc.HexLike;
}

