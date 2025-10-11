use alloc::vec::Vec;
use ckb_deterministic::cell_classifier::RuleBasedClassifier;
use ckb_deterministic::debug_trace;
use ckb_std::ckb_constants::Source;
use ckb_std::high_level::{load_script, load_witness_args};
use ckboost_shared::protocol_data::get_protocol_data;
use ckboost_shared::types::{
    Byte32Vec, CampaignData, ConnectedTypeID, ProtocolData, TippingData, Transaction,
};
use ckboost_shared::ProtocolDataExt;
use ckboost_shared::{transaction_context::TransactionContext, Error};
use molecule::prelude::Entity;

pub struct CKBoostProtocolLock;

use crate::ssri::{CKBoostProtocol, CKBoostTipping};
use crate::{recipes, ssri::CKBoostCampaign};

impl CKBoostCampaign for CKBoostProtocolLock {
    fn update_campaign(
        _tx: Option<Transaction>,
        _campaign_data: CampaignData,
    ) -> Result<Transaction, Error> {
        debug_trace!("CKBoostFundingLock::update_campaign - Not implemented for lock script");
        // Lock scripts don't typically build transactions for campaign updates
        // This is handled by the type script
        Err(Error::SSRIMethodsNotImplemented)
    }

    fn verify_update_campaign(
        context: &TransactionContext<RuleBasedClassifier>,
    ) -> Result<(), Error> {
        debug_trace!("CKBoostProtocolLock::verify_update_campaign - Starting validation");
        let args = load_script()?.args();
        let connected_type_id = ConnectedTypeID::from_slice(&args.raw_data())
            .map_err(|e| Error::InvalidConnectedTypeId)?;
        let connected_key = connected_type_id.connected_key();
        let mut connected_key_u832 = [0u8; 32];
        connected_key_u832.copy_from_slice(&connected_key.raw_data());
        let output_campaign_cell_vec = context
            .output_cells
            .get_custom("campaign")
            .ok_or(Error::CellCountViolation)?;
        if output_campaign_cell_vec.len() != 1 {
            return Err(Error::CellCountViolation);
        }
        let output_campaign_cell = &output_campaign_cell_vec[0];

        let input_campaign_cell_vec = context
            .input_cells
            .get_custom("campaign")
            .ok_or(Error::CellCountViolation)?;
        if input_campaign_cell_vec.len() == 1 {
            let input_campaign_cell = &input_campaign_cell_vec[0];
            if input_campaign_cell.type_hash != output_campaign_cell.type_hash {
                return Err(Error::ProtocolCellNotFound);
            }
        } else if input_campaign_cell_vec.len() > 1 {
            return Err(Error::CellCountViolation);
        }
        let protocol_data = get_protocol_data().map_err(|e| Error::InvalidProtocolData)?;
        let campaign_data = CampaignData::from_slice(&output_campaign_cell.data)
            .map_err(|e| Error::InvalidCampaignData)?;
        let admin_lock_hash_vec = protocol_data.protocol_config().admin_lock_hash_vec();
        let staff_lock_hash_vec = campaign_data.staff_lock_hash_vec();
        let output_campaign_cell_connected_type_id =
            ConnectedTypeID::from_slice(&output_campaign_cell.lock.args().raw_data())
                .map_err(|e| Error::InvalidConnectedTypeId)?;
        if output_campaign_cell_connected_type_id
            .connected_key()
            .as_slice()
            != connected_key_u832.as_slice()
        {
            debug_trace!(
                "Output campaign cell connected type id mismatch: {:?}",
                output_campaign_cell_connected_type_id
            );
            debug_trace!("Connected key: {:?}", connected_key_u832);
            return Err(Error::InvalidConnectedTypeId);
        }
        let proxy_ckb_cells = context.input_cells.get_simple_ckb();
        // If any proxy ckb cell is the connectedTypeId.type_id or in the admin_lock_hash_vec, return Ok
        for proxy_ckb_cell in proxy_ckb_cells {
            if proxy_ckb_cell.lock_hash == connected_key_u832
                || admin_lock_hash_vec
                    .clone()
                    .into_iter()
                    .any(|h| h.as_slice() == proxy_ckb_cell.lock_hash.as_slice())
                || staff_lock_hash_vec
                    .clone()
                    .into_iter()
                    .any(|h| h.as_slice() == proxy_ckb_cell.lock_hash.as_slice())
            {
                return Ok(());
            }
        }
        return Err(Error::InvalidConnectedTypeId);
    }

    fn approve_completion(
        _tx: Option<Transaction>,
        _campaign_data: CampaignData,
        _quest_id: u32,
        _user_type_ids: Byte32Vec,
    ) -> Result<Transaction, Error> {
        debug_trace!("CKBoostFundingLock::approve_completion - Not implemented for lock script");
        // Lock scripts don't build approval transactions
        // This is handled by the type script
        Err(Error::SSRIMethodsNotImplemented)
    }

    fn verify_approve_completion(
        context: &TransactionContext<RuleBasedClassifier>,
    ) -> Result<(), Error> {
        debug_trace!("CKBoostFundingLock::verify_approve_completion - Starting validation");

        // For lock script, we validate that an approved user is claiming rewards
        // This checks the approval proof in the transaction
        recipes::approve_completion::validate_approve_completion(context).map_err(|e| e.into())
    }
}

impl CKBoostProtocol for CKBoostProtocolLock {
    fn update_protocol(
        _tx: Option<Transaction>,
        _protocol_data: ProtocolData,
    ) -> Result<Transaction, Error> {
        debug_trace!("CKBoostProtocolLock::update_protocol - Not implemented for lock script");
        Err(Error::SSRIMethodsNotImplemented)
    }

    fn verify_update_protocol(
        context: &TransactionContext<RuleBasedClassifier>,
    ) -> Result<(), Error> {
        debug_trace!("CKBoostProtocolLock::verify_update_protocol - Starting validation");
        let args = load_script()?.args();
        let connected_type_id = ConnectedTypeID::from_slice(&args.raw_data())
            .map_err(|e| Error::InvalidConnectedTypeId)?;
        let connected_key = connected_type_id.connected_key();
        let mut connected_key_u832 = [0u8; 32];
        connected_key_u832.copy_from_slice(&connected_key.raw_data());
        let output_protocol_cell_vec = context
            .output_cells
            .get_custom("protocol")
            .ok_or(Error::CellCountViolation)?;
        if output_protocol_cell_vec.len() != 1 {
            return Err(Error::CellCountViolation);
        }
        let output_protocol_cell = &output_protocol_cell_vec[0];

        let input_protocol_cell_vec = context
            .input_cells
            .get_custom("protocol")
            .ok_or(Error::CellCountViolation)?;
        if input_protocol_cell_vec.len() == 1 {
            let input_protocol_cell = &input_protocol_cell_vec[0];
            if input_protocol_cell.type_hash != output_protocol_cell.type_hash {
                return Err(Error::ProtocolCellNotFound);
            }
        } else if input_protocol_cell_vec.len() > 1 {
            return Err(Error::CellCountViolation);
        }
        let protocol_data = ProtocolData::from_slice(&output_protocol_cell.data)
            .map_err(|e| Error::InvalidProtocolData)?;
        let admin_lock_hash_vec = protocol_data.protocol_config().admin_lock_hash_vec();
        if output_protocol_cell.type_hash != Some(connected_key_u832) {
            return Err(Error::InvalidConnectedTypeId);
        }
        let proxy_ckb_cells = context.input_cells.get_simple_ckb();
        // If any proxy ckb cell is the connectedTypeId.type_id or in the admin_lock_hash_vec, return Ok
        for proxy_ckb_cell in proxy_ckb_cells {
            if proxy_ckb_cell.lock_hash == connected_key_u832
                || admin_lock_hash_vec
                    .clone()
                    .into_iter()
                    .any(|h| h.as_slice() == proxy_ckb_cell.lock_hash.as_slice())
            {
                return Ok(());
            }
        }
        return Err(Error::InvalidConnectedTypeId);
    }
}

impl CKBoostTipping for CKBoostProtocolLock {
    fn update_tipping(
        _tx: Option<Transaction>,
        _tipping_data: TippingData,
    ) -> Result<Transaction, Error> {
        debug_trace!("CKBoostProtocolLock::update_tipping - Not implemented for lock script");
        Err(Error::SSRIMethodsNotImplemented)
    }

    fn verify_update_tipping(
        context: &TransactionContext<RuleBasedClassifier>,
    ) -> Result<(), Error> {
        todo!()
    }

    fn grant_tipping_reward(
        tx: Option<Transaction>,
        tipping_data: ckboost_shared::types::TippingData,
    ) -> Result<Transaction, Error> {
        todo!()
    }

    fn verify_grant_tipping_reward(
        context: &TransactionContext<RuleBasedClassifier>,
    ) -> Result<(), Error> {
        todo!()
    }
}

// Helper functions for lock validation
impl CKBoostProtocolLock {
    /// Check if an approved user is claiming rewards
    pub fn is_approved_user_claiming(campaign_type_id: &[u8]) -> Result<bool, Error> {
        debug_trace!("Checking if approved user is claiming");

        // Check if there's approval data in any witness
        let mut index = 0;
        loop {
            match load_witness_args(index, Source::Input) {
                Ok(witness_args) => {
                    // Check if output_type contains approval proof
                    match witness_args.output_type().to_opt() {
                        Some(output_type) => {
                            // Parse approval proof from output_type field
                            // Format: [method_name][quest_id][user_type_ids]
                            let proof_data = output_type.raw_data();
                            if proof_data.starts_with(b"CKBoostCampaign.approve_completion") {
                                debug_trace!("Found approval proof in witness");
                                return Ok(true);
                            }
                        }
                        None => {
                            // No output_type data in this witness
                        }
                    }
                }
                Err(ckb_std::error::SysError::IndexOutOfBound) => {
                    break;
                }
                Err(_e) => {
                    // Continue checking other witnesses
                }
            }
            index += 1;
        }

        Ok(false)
    }
}
