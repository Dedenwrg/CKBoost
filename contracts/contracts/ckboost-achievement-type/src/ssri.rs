use ckb_deterministic::{
    cell_classifier::RuleBasedClassifier, transaction_context::TransactionContext,
};
use ckb_std::ckb_types::packed::Transaction;
use ckboost_shared::{
    types::{AchievementDataVec, String},
    Error,
};

/// CKBoost User SSRI trait for user management operations
pub trait CKBoostAchievement {
    fn update_achievement(
        tx: Option<Transaction>,
        achievement_data: AchievementDataVec,
    ) -> Result<Transaction, Error>;

    fn claim_achievement(tx: Option<Transaction>) -> Result<Transaction, Error>;

    /// Verify verification data update transaction in Type Script
    /// This method is called automatically by the type script to validate transactions
    fn verify_update_achievement(
        context: &TransactionContext<RuleBasedClassifier>,
    ) -> Result<(), Error>;

    fn verify_claim_achievement(
        context: &TransactionContext<RuleBasedClassifier>,
    ) -> Result<(), Error>;
}
