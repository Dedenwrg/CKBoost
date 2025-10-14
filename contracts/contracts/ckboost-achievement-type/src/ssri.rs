use ckb_deterministic::{
    cell_classifier::RuleBasedClassifier, transaction_context::TransactionContext,
};
use ckb_std::ckb_types::packed::Transaction;
use ckboost_shared::{
    types::{String, UserData, UserVerificationData},
    Error,
};

/// CKBoost User SSRI trait for user management operations
pub trait CKBoostAchievement {
    fn claim_achievement(
        tx: Option<Transaction>,
        achievement_type: String,
    ) -> Result<Transaction, Error>;

    /// Verify verification data update transaction in Type Script
    /// This method is called automatically by the type script to validate transactions
    fn verify_claim_achievement(
        context: &TransactionContext<RuleBasedClassifier>,
    ) -> Result<(), Error>;
}
