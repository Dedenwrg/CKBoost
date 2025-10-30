extern crate alloc;

pub mod helper {
    use ckb_deterministic::debug_trace;
    use ckb_deterministic::errors::Error as DeterministicError;
    use ckb_std::ckb_constants::Source;
    use ckb_std::high_level::{load_cell_data, load_cell_type_hash};
    use ckboost_shared::types::CampaignData;
    use molecule::prelude::Entity;

    /// Validate user is in the approved list for a quest
    pub fn validate_user_in_approved_list(
        campaign_data: &CampaignData,
        quest_id: u32,
        user_type_id: &[u8],
    ) -> Result<(), DeterministicError> {
        // Find the quest by ID
        let quests = campaign_data.quests();
        for i in 0..quests.len() {
            let quest = quests.get(i).unwrap();
            if quest.quest_id().as_slice() == &quest_id.to_le_bytes() {
                // Check if user is in approved list
                let approved_users = quest.accepted_submission_user_type_ids();
                for j in 0..approved_users.len() {
                    let approved_user = approved_users.get(j).unwrap();
                    if approved_user.as_slice() == user_type_id {
                        debug_trace!("User is approved for quest {}", quest_id);
                        return Ok(());
                    }
                }
            }
        }
        debug_trace!("User not found in approved list for quest {}", quest_id);
        Err(DeterministicError::CellRelationshipRuleViolation)
    }
}

pub mod approve_completion {
    use ckb_deterministic::assertions::expect;
    use ckb_deterministic::cell_classifier::RuleBasedClassifier;
    use ckb_deterministic::debug_trace;
    use ckb_deterministic::errors::Error as DeterministicError;
    use ckb_std::high_level::load_script;
    use ckboost_shared::transaction_context::TransactionContext;

    /// Validate that the campaign admin is unlocking funds
    /// This is valid when the campaign cell itself is being spent
    pub fn validate_approve_completion(
        context: &TransactionContext<RuleBasedClassifier>,
    ) -> Result<(), DeterministicError> {
        debug_trace!("Validating admin unlock");

        // Check that a campaign cell exists in inputs
        // This means the campaign admin (who owns the campaign cell) is signing the transaction
        let input_campaign_cells = context.input_cells.get_custom("campaign");
        let script = load_script()?;
        let args = script.args().raw_data();
        let mut args_u832 = [0u8; 32];
        args_u832.copy_from_slice(args.as_ref());

        match input_campaign_cells {
            Some(cells) => {
                debug_trace!("Campaign cell found in inputs - admin unlock is valid");
                debug_trace!("Campaign cell count: {}", cells.len());
                let campaign_cell = &cells[0];
                let campaign_cell_type_hash = campaign_cell.type_hash.as_ref().unwrap();
                expect(campaign_cell_type_hash).to_equal(&args_u832)?;
                Ok(())
            }
            None => {
                debug_trace!("No campaign cell in inputs - admin unlock is invalid");
                Err(DeterministicError::CellRelationshipRuleViolation)
            }
        }
    }
}

pub mod update_tipping {
    use ckb_deterministic::cell_classifier::RuleBasedClassifier;
    use ckb_deterministic::debug_trace;
    use ckb_deterministic::errors::Error as DeterministicError;
    use ckb_deterministic::transaction_recipe::TransactionRecipeExt;
    use ckb_std::ckb_constants::Source;
    use ckb_std::high_level::load_cell_capacity;
    use ckb_std::high_level::load_witness_args;
    use ckboost_shared::cell_collector::get_udt_identifier;
    use ckboost_shared::transaction_context::TransactionContext;
    use ckboost_shared::types::TippingDataReader;
    use molecule::prelude::Entity;
    use molecule::prelude::Reader;

    pub fn validate_update_tipping(
        context: &TransactionContext<RuleBasedClassifier>,
    ) -> Result<(), DeterministicError> {
        let input_tipping_cells = context.input_cells.get_custom("tipping");
        let output_tipping_cells = context.output_cells.get_custom("tipping");
        match input_tipping_cells {
            Some(cells) => match cells.get(0) {
                Some(cell) => {
                    let tipping_data = TippingDataReader::from_slice(&cell.data)
                        .map_err(|_| DeterministicError::Encoding);
                    match tipping_data {
                        Ok(tipping_data) => {
                            let status = tipping_data.status().to_entity();
                            if status.raw_data().to_vec() == b"granted" {
                                debug_trace!("Tipping status is granted - update is invalid");
                                return Err(DeterministicError::BusinessRuleViolation);
                            }
                        }
                        Err(_) => {
                            debug_trace!("Failed to decode tipping data from input cell");
                            return Err(DeterministicError::Encoding);
                        }
                    }
                }
                None => {
                    debug_trace!("Missing tipping cell in input");
                    return Err(DeterministicError::CellCountViolation);
                }
            },
            None => {
                debug_trace!("Missing tipping cell in input");
                return Err(DeterministicError::CellCountViolation);
            }
        }

        match output_tipping_cells {
            Some(cells) => match cells.get(0) {
                Some(cell) => {
                    let tipping_data = TippingDataReader::from_slice(&cell.data)
                        .map_err(|_| DeterministicError::Encoding);
                    match tipping_data {
                        Ok(output_tipping_data) => {
                            let status = output_tipping_data.status().to_entity();
                            if status.raw_data().to_vec() != b"granted" {
                                debug_trace!("Tipping status is not granted - update is invalid");
                                debug_trace!("  Status Hex: {:?}", status.raw_data());
                                debug_trace!("  Expected Status String: {:?}", b"granted");

                                return Err(DeterministicError::BusinessRuleViolation);
                            }
                            // Check rewards distribution
                            let rewards = output_tipping_data.rewards().to_entity();

                            let mut raw_ckb_amount = [0u8; 16];
                            raw_ckb_amount.copy_from_slice(rewards.ckb_amount().as_slice());
                            let ckb_amount = u128::from_le_bytes(raw_ckb_amount);

                            let target_lock_hash =
                                output_tipping_data.target_lock_hash().to_entity();
                            let target_lock_bytes = target_lock_hash.as_slice();

                            // Validate points rewards (if any)
                            let mut raw_points_amount = [0u8; 16];
                            raw_points_amount.copy_from_slice(rewards.points_amount().as_slice());
                            let points_amount = u128::from_le_bytes(raw_points_amount);
                            let has_points_reward = points_amount > 0;
                            if has_points_reward {
                                debug_trace!("Automatic execution: Points reward expected");
                                let points_cells = context.output_cells.get_custom("points").ok_or_else(|| {
                                    debug_trace!(
                                        "BusinessRuleViolation: Points reward expected but no points outputs found"
                                    );
                                    DeterministicError::BusinessRuleViolation
                                })?;

                                let points_rewarded = points_cells
                                    .iter()
                                    .filter(|cell| cell.lock_hash.as_slice() == target_lock_bytes)
                                    .try_fold(0u128, |acc, cell| {
                                        load_cell_capacity(cell.index, cell.source)
                                            .map(|capacity| acc + capacity as u128)
                                            .map_err(|err| {
                                                debug_trace!(
                                                    "BusinessRuleViolation: Failed to load points cell capacity: {:?}",
                                                    err
                                                );
                                                DeterministicError::BusinessRuleViolation
                                            })
                                    })?;

                                if points_rewarded < points_amount {
                                    debug_trace!("BusinessRuleViolation: Points reward expected but target lock has not enough points output");
                                    return Err(DeterministicError::BusinessRuleViolation);
                                }
                            }

                            // Validate CKB rewards (if any)
                            if ckb_amount > 0 {
                                debug_trace!("Automatic execution: CKB reward expected");
                                let output_simple_ckb = context.output_cells.get_simple_ckb();
                                let input_simple_ckb = context.input_cells.get_simple_ckb();

                                let output_target_capacity: u128 = output_simple_ckb
                                    .iter()
                                    .filter(|cell| cell.lock_hash.as_slice() == target_lock_bytes)
                                    .try_fold(0u128, |acc, cell| {
                                        load_cell_capacity(cell.index, cell.source)
                                            .map(|capacity| acc + capacity as u128)
                                            .map_err(|err| {
                                                debug_trace!(
                                                    "BusinessRuleViolation: Failed to load output cell capacity: {:?}",
                                                    err
                                                );
                                                DeterministicError::CellRelationshipRuleViolation
                                            })
                                    })?;
                                let input_target_capacity: u128 = input_simple_ckb
                                    .iter()
                                    .filter(|cell| cell.lock_hash.as_slice() == target_lock_bytes)
                                    .try_fold(0u128, |acc, cell| {
                                        load_cell_capacity(cell.index, cell.source)
                                            .map(|capacity| acc + capacity as u128)
                                            .map_err(|err| {
                                                debug_trace!(
                                                    "BusinessRuleViolation: Failed to load input cell capacity: {:?}",
                                                    err
                                                );
                                                DeterministicError::CellRelationshipRuleViolation
                                            })
                                    })?;

                                if output_target_capacity <= input_target_capacity {
                                    debug_trace!(
                                            "BusinessRuleViolation: CKB reward expected but no net capacity delivered to target lock hash"
                                        );
                                    return Err(DeterministicError::BusinessRuleViolation);
                                }

                                let delivered_ckb = output_target_capacity - input_target_capacity;
                                if delivered_ckb < ckb_amount as u128 {
                                    debug_trace!(
                                        "BusinessRuleViolation: Delivered CKB {} is less than required {}",
                                        delivered_ckb,
                                        ckb_amount
                                    );
                                    return Err(DeterministicError::BusinessRuleViolation);
                                }
                            }

                            // Validate UDT rewards (if any)
                            let udt_assets = rewards.udt_assets();
                            for i in 0..udt_assets.len() {
                                let udt_asset = udt_assets.get(i).unwrap();
                                let mut udt_amount_bytes = [0u8; 16];
                                udt_amount_bytes.copy_from_slice(udt_asset.amount().as_slice());
                                let has_udt_reward = udt_amount_bytes.iter().any(|byte| *byte != 0);
                                if !has_udt_reward {
                                    continue;
                                }

                                let udt_identifier = get_udt_identifier(&udt_asset.udt_script());
                                let udt_cells = context
                                    .output_cells
                                    .get_custom(udt_identifier.as_str())
                                    .ok_or_else(|| {
                                        debug_trace!(
                                            "BusinessRuleViolation: Expected UDT reward {} but no outputs found",
                                            udt_identifier
                                        );
                                        DeterministicError::BusinessRuleViolation
                                    })?;

                                let has_target_udt = udt_cells
                                    .iter()
                                    .any(|cell| cell.lock_hash.as_slice() == target_lock_bytes);

                                if !has_target_udt {
                                    debug_trace!(
                                            "BusinessRuleViolation: UDT reward {} expected for target lock hash but none found",
                                            udt_identifier
                                        );
                                    return Err(DeterministicError::BusinessRuleViolation);
                                }
                            }
                        }
                        Err(_) => {
                            debug_trace!("Failed to decode tipping data from output cell");
                            return Err(DeterministicError::Encoding);
                        }
                    }
                }
                None => {
                    debug_trace!("Missing tipping cell in output");
                    return Err(DeterministicError::CellCountViolation);
                }
            },
            None => {
                debug_trace!("Missing tipping cell in output");
                return Err(DeterministicError::CellCountViolation);
            }
        }

        Ok(())
    }
}

pub mod user_claim {
    use ckb_deterministic::cell_classifier::RuleBasedClassifier;
    use ckb_deterministic::debug_trace;
    use ckb_deterministic::errors::Error as DeterministicError;
    use ckb_deterministic::transaction_recipe::TransactionRecipeExt;
    use ckb_std::ckb_constants::Source;
    use ckb_std::high_level::load_witness_args;
    use ckboost_shared::transaction_context::TransactionContext;

    /// Validate that an approved user is claiming rewards
    /// This checks for approval proof in the transaction witnesses
    pub fn validate_user_claim(
        context: &TransactionContext<RuleBasedClassifier>,
    ) -> Result<(), DeterministicError> {
        debug_trace!("Validating user claim");

        // Check for approval proof in witnesses
        let mut index = 0;
        let mut found_proof = false;

        loop {
            match load_witness_args(index, Source::Input) {
                Ok(witness_args) => {
                    // Check if output_type contains approval proof
                    match witness_args.output_type().to_opt() {
                        Some(output_type) => {
                            let proof_data = output_type.raw_data();
                            if proof_data.starts_with(b"CKBoostCampaign.approve_completion") {
                                debug_trace!("Found approval proof in witness at index {}", index);
                                found_proof = true;
                                break;
                            }
                        }
                        None => {}
                    }
                }
                Err(ckb_std::error::SysError::IndexOutOfBound) => break,
                Err(_) => {}
            }
            index += 1;
        }

        if found_proof {
            // ISSUE #14: Further validate the proof contains valid quest_id and user_type_id
            // For now, presence of proof is sufficient
            debug_trace!("User claim is valid with approval proof");
            Ok(())
        } else {
            debug_trace!("No approval proof found - user claim is invalid");
            Err(DeterministicError::CellRelationshipRuleViolation)
        }
    }
}

pub mod common {
    use ckb_deterministic::cell_classifier::RuleBasedClassifier;
    use ckb_deterministic::debug_trace;
    use ckb_deterministic::errors::Error as DeterministicError;
    use ckb_deterministic::transaction_recipe::TransactionRecipeExt;
    use ckboost_shared::transaction_context::TransactionContext;

    /// Common validation that applies to all lock operations
    /// Currently just ensures basic transaction structure is valid
    pub fn validate_common(
        context: &TransactionContext<RuleBasedClassifier>,
    ) -> Result<(), DeterministicError> {
        debug_trace!("Performing common lock validation");

        // Get the recipe method path to understand what operation is being performed
        let method_path = context.recipe.method_path_bytes();
        debug_trace!(
            "Lock operation method: {:?}",
            core::str::from_utf8(&method_path).unwrap_or("<invalid UTF-8>")
        );

        // All lock operations are valid as long as they pass specific validation
        Ok(())
    }
}
