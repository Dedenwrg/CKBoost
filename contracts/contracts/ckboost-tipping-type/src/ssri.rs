use alloc::vec::Vec;
use ckb_deterministic::{
    cell_classifier::RuleBasedClassifier, transaction_context::TransactionContext,
};
use ckb_std::ckb_types::packed::Transaction;
use ckboost_shared::{types::TippingData, Error};

/// CKBoost Tipping SSRI trait for tipping management operations
pub trait CKBoostTipping {
    fn update_tipping(
        tx: Option<Transaction>,
        tipping_data: TippingData,
    ) -> Result<Transaction, Error>;
    fn verify_update_tipping(
        context: &TransactionContext<RuleBasedClassifier>,
    ) -> Result<(), Error>;
}
