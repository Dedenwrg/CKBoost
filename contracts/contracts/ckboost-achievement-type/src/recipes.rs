extern crate alloc;

use alloc::{vec, vec::Vec};
use ckb_deterministic::{
    cell_classifier::RuleBasedClassifier, validation::TransactionValidationRules,
};

pub mod common {
    use ckb_deterministic::errors::Error as DeterministicError;
    use ckb_deterministic::transaction_recipe::TransactionRecipeExt;
    use ckb_deterministic::{assertions::expect, cell_classifier::RuleBasedClassifier};
    use ckboost_shared::transaction_context::TransactionContext;

    // **Script immutability**: Lock hash and type hash for user cells must remain unchanged
    pub fn script_immutability(
        context: &TransactionContext<RuleBasedClassifier>,
    ) -> Result<(), DeterministicError> {
        // Get the user cells from input and output
        let input_user_cells = match context.input_cells.get_custom("user") {
            Some(cells) => cells,
            None => {
                // Creation scenario - no input user cell for submit_quest when creating user
                let method_path_bytes = context.recipe.method_path_bytes();
                let method_path = method_path_bytes.as_slice();
                if method_path == b"CKBoostUser.submit_quest" {
                    return Ok(());
                }
                if method_path == b"CKBoostUser.update_verification_data" {
                    return Ok(());
                } else {
                    return Err(DeterministicError::CellRelationshipRuleViolation);
                }
            }
        };
        let output_user_cells = context
            .output_cells
            .get_custom("user")
            .ok_or(DeterministicError::CellCountViolation)?;

        // For each user cell, verify lock and type hashes remain unchanged
        for (i, input_cell) in input_user_cells.iter().enumerate() {
            match output_user_cells.get(i) {
                Some(output_cell) => {
                    // Verify lock hash immutability
                    expect(&input_cell.lock_hash)
                        .to_equal(&output_cell.lock_hash)
                        .map_err(|_| DeterministicError::CellRelationshipRuleViolation)?;

                    // Verify type hash immutability
                    match (&input_cell.type_hash, &output_cell.type_hash) {
                        (Some(input_hash), Some(output_hash)) => {
                            expect(&input_hash)
                                .to_equal(&output_hash)
                                .map_err(|_| DeterministicError::CellRelationshipRuleViolation)?;
                        }
                        _ => {
                            // Either input or output user cell has no type hash - this is not allowed
                            return Err(DeterministicError::CellRelationshipRuleViolation);
                        }
                    }
                }
                None => {
                    // Missing corresponding output cell
                    return Err(DeterministicError::CellCountViolation);
                }
            }
        }

        Ok(())
    }
}

pub mod claim_achievement {
    use super::common;
    use alloc::{string::ToString, vec};
    use ckb_deterministic::{
        cell_classifier::RuleBasedClassifier,
        validation::{CellCountConstraint, TransactionValidationRules},
    };

    pub fn get_rules() -> TransactionValidationRules<RuleBasedClassifier> {
        TransactionValidationRules::new(b"CKBoostAchievement.claim_achievement".to_vec())
            .with_arguments(1)
            .with_custom_cell(
                "user",
                CellCountConstraint::at_least(0),
                CellCountConstraint::exactly(1),
            )
            // User cells: exactly 1 in, 1 out (update)
            .with_cell_relationship(
                "script_immutability".to_string(),
                "Script immutability must be maintained during user updates".to_string(),
                vec!["user".to_string()],
                common::script_immutability,
            )
            .with_business_rule(
                "verification_update_validation".to_string(),
                "Validate user verification update permissions and data".to_string(),
                vec!["user".to_string(), "protocol".to_string()],
                business_logic::claim_achievement_validation,
            )
    }

    pub mod business_logic {
        use ckb_deterministic::cell_classifier::RuleBasedClassifier;
        use ckb_deterministic::debug_trace;
        use ckb_deterministic::errors::Error as DeterministicError;
        use ckboost_shared::protocol_data::get_protocol_data;
        use ckboost_shared::transaction_context::TransactionContext;
        use ckboost_shared::types::{AchievementData, AchievementDataVec, String};
        use molecule::prelude::Entity;

        // **Verification update validation**: Ensure only authorized verification updates
        pub fn claim_achievement_validation(
            context: &TransactionContext<RuleBasedClassifier>,
        ) -> Result<(), DeterministicError> {
            // Rule: There must be a simple CKB cell locked by admin.
            let input_achievement_cell_data_raw = &context
                .input_cells
                .get_custom("achievement")
                .ok_or_else(|| return DeterministicError::CellCountViolation)?
                .first()
                .ok_or_else(|| return DeterministicError::CellCountViolation)?
                .data;

            let output_achievement_cell_data_raw = &context
                .output_cells
                .get_custom("achievement")
                .ok_or_else(|| return DeterministicError::CellCountViolation)?
                .first()
                .ok_or_else(|| return DeterministicError::CellCountViolation)?
                .data;

            let input_achievement_vec_data =
                AchievementDataVec::from_slice(input_achievement_cell_data_raw)
                    .map_err(|_| DeterministicError::Encoding)?;
            let output_achievement_vec_data =
                AchievementDataVec::from_slice(&output_achievement_cell_data_raw)
                    .map_err(|_| DeterministicError::Encoding)?;
            let achievement_string_in_bytes = context
                .recipe
                .arguments()
                .get(1)
                .ok_or_else(|| DeterministicError::InvalidArgumentCount)?
                .data()
                .raw_data();

            let input_achievement_data = input_achievement_vec_data
                .into_iter()
                .find(|achievement_data| {
                    achievement_data
                        .achievement_title()
                        .raw_data()
                        .to_vec()
                        .as_slice()
                        == achievement_string_in_bytes.to_vec().as_slice()
                })
                .ok_or_else(|| DeterministicError::ItemMissing)?;
            let output_achievement_data = output_achievement_vec_data
                .into_iter()
                .find(|achievement_data| {
                    achievement_data
                        .achievement_title()
                        .raw_data()
                        .to_vec()
                        .as_slice()
                        == achievement_string_in_bytes.to_vec().as_slice()
                })
                .ok_or_else(|| DeterministicError::ItemMissing)?;
            let input_receiver_user_record_vec = input_achievement_data.receiver_user_record_vec();
            let output_receiver_user_record_vec =
                output_achievement_data.receiver_user_record_vec();
            // Check if each input receiver user record is present in output
            for input_receiver_user_record in input_receiver_user_record_vec.into_iter() {
                let _ = output_receiver_user_record_vec
                    .clone()
                    .into_iter()
                    .find(|receiver_user_record| {
                        receiver_user_record
                            .receiver_user_type_hash()
                            .as_slice()
                            .to_vec()
                            == input_receiver_user_record
                                .receiver_user_type_hash()
                                .as_slice()
                                .to_vec()
                    })
                    .ok_or_else(|| {
                        debug_trace!(
                            "Receiver user record with lock hash {:?} not found in output",
                            input_receiver_user_record.receiver_user_type_hash()
                        );
                        DeterministicError::ItemMissing
                    })?;
            }
            // Check if the receivers of points in the output is also added to the output receiver user record vec
            let reward_point_cells = context
                .output_cells
                .get_custom("points")
                .ok_or_else(|| DeterministicError::CellCountViolation)?;
            let celldep_user_cells = context
                .cell_deps
                .get_custom("user")
                .ok_or_else(|| DeterministicError::CellCountViolation)?;
            for reward_point_cell in reward_point_cells.into_iter() {
                let matching_user_cell = celldep_user_cells
                    .into_iter()
                    .find(|user_cell| user_cell.lock_hash == reward_point_cell.lock_hash)
                    .ok_or_else(|| DeterministicError::ItemMissing)?;
                let _ = output_receiver_user_record_vec
                    .clone()
                    .into_iter()
                    .find(|receiver_user_record| {
                        receiver_user_record
                            .receiver_user_type_hash()
                            .as_slice()
                            .to_vec()
                            == matching_user_cell
                                .type_hash
                                .ok_or_else(|| {
                                    debug_trace!("User cell type hash not found");
                                    DeterministicError::ItemMissing
                                })
                                .unwrap()
                                .as_slice()
                                .to_vec()
                    })
                    .ok_or_else(|| {
                        debug_trace!("Receiver user record not found in output");
                        DeterministicError::ItemMissing
                    })?;
            }
            // NOTE: Achievement specific validations should be done in netlify function with admin proxy.
            let potential_admin_proxy_cells = context
                .input_cells
                .get_custom("admin_proxy")
                .ok_or_else(|| DeterministicError::CellCountViolation)?;
            let protocol_data = get_protocol_data().map_err(|_| DeterministicError::DataError)?;
            for potential_admin_proxy_cell in potential_admin_proxy_cells.into_iter() {
                let matching_admin_lock_hash = protocol_data
                    .protocol_config()
                    .admin_lock_hash_vec()
                    .into_iter()
                    .find(|lock_hash| {
                        lock_hash.raw_data().to_vec().as_slice()
                            == potential_admin_proxy_cell.lock_hash.to_vec().as_slice()
                    });
                if matching_admin_lock_hash.is_some() {
                    return Ok(());
                }
            }
            return Err(DeterministicError::BusinessRuleViolation);
        }
    }
}

/// Get all validation rules for user type
pub fn get_all_rules() -> Vec<TransactionValidationRules<RuleBasedClassifier>> {
    vec![claim_achievement::get_rules()]
}
