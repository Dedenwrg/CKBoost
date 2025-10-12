use ckboost_shared::{
    transaction_context::{RuleBasedClassifier, TransactionContext},
    types::{Byte32Vec, CampaignData, ProtocolData, TippingData, Transaction},
    Error,
};

pub trait CKBoostCampaign {
    /// Create or update a campaign
    ///
    /// # Arguments
    ///
    /// * `tx` - Optional existing transaction to build upon
    /// * `campaign_data` - The campaign configuration and metadata
    ///
    /// # Returns
    ///
    /// Returns a transaction with the campaign cell created/updated
    fn update_campaign(
        tx: Option<Transaction>,
        campaign_data: CampaignData,
    ) -> Result<Transaction, Error>;

    /// Verify campaign update/creation transaction in Type Script
    /// This method is called automatically by the type script to validate transactions
    fn verify_update_campaign(
        context: &TransactionContext<RuleBasedClassifier>,
    ) -> Result<(), Error>;

    /// Approve quest completion and distribute rewards
    ///
    /// # Arguments
    ///
    /// * `tx` - Optional existing transaction to build upon
    /// * `campaign_data` - The current campaign data
    /// * `quest_id` - The ID of the quest being approved
    /// * `user_type_ids` - List of user type IDs to approve
    ///
    /// # Returns
    ///
    /// Returns a transaction with the quest completion processed
    fn approve_completion(
        tx: Option<Transaction>,
        campaign_data: CampaignData,
        quest_id: u32,
        user_type_ids: Byte32Vec,
    ) -> Result<Transaction, Error>;

    /// Verify quest completion approval transaction in Type Script
    /// This method is called automatically by the type script to validate transactions
    fn verify_approve_completion(
        context: &TransactionContext<RuleBasedClassifier>,
    ) -> Result<(), Error>;
}

pub trait CKBoostTipping {
    fn update_tipping(
        tx: Option<Transaction>,
        tipping_data: TippingData,
    ) -> Result<Transaction, Error>;
    fn verify_update_tipping(
        context: &TransactionContext<RuleBasedClassifier>,
    ) -> Result<(), Error>;
}

pub trait CKBoostProtocol {
    // If the context script cannot locate the protocol cell, will try to create a new one.
    // #[ssri_method(level = "script", transaction = true)]
    fn update_protocol(
        tx: Option<Transaction>,
        protocol_data: ProtocolData,
    ) -> Result<Transaction, Error>;
    fn verify_update_protocol(
        context: &TransactionContext<RuleBasedClassifier>,
    ) -> Result<(), Error>;
}
