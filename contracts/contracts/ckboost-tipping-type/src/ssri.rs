use alloc::vec::Vec;
use ckb_deterministic::{
    cell_classifier::RuleBasedClassifier, transaction_context::TransactionContext,
};
use ckb_std::ckb_types::packed::{Byte32Vec, Transaction};
use ckboost_shared::{
    types::{Byte32, CampaignData, TippingProposalData, UDTAsset},
    Error,
};

/// CKBoost Tipping SSRI trait for tipping management operations
pub trait CKBoostTipping {
    fn update_tipping_proposal(
        protocol_type_hash: Byte32,
        tipping_proposal_data: TippingProposalData,
    ) -> Result<(), Error>;
    fn verify_update_tipping_proposal(
        context: &TransactionContext<RuleBasedClassifier>,
    ) -> Result<(), Error>;
}
