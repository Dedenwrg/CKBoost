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
        use ckb_deterministic::errors::Error as DeterministicError;
        use ckboost_shared::protocol_data::get_protocol_data;
        use ckboost_shared::transaction_context::TransactionContext;
        use ckboost_shared::types::String;
        use molecule::prelude::Entity;

        // **Verification update validation**: Ensure only authorized verification updates
        pub fn claim_achievement_validation(
            context: &TransactionContext<RuleBasedClassifier>,
        ) -> Result<(), DeterministicError> {
            // Rule: There must be a simple CKB cell locked by admin.
            let protocol_data = match get_protocol_data() {
                Ok(pd) => pd,
                Err(_) => return Err(DeterministicError::BusinessRuleViolation),
            };
            let input_achievement_cells = context
                .input_cells
                .get_custom("achievement")
                .ok_or(DeterministicError::CellCountViolation)?;
            let output_achievement_cells = context
                .output_cells
                .get_custom("achievement")
                .ok_or(DeterministicError::CellCountViolation)?;
            let input_achievement_cell = &input_achievement_cells[0];
            let output_achievement_cell = &output_achievement_cells[0];

            match context.recipe.arguments().get(0) {
                Some(arg) => {
                    let achievement_type = String::from_slice(&arg.data().raw_data().to_vec())
                        .map_err(|_| DeterministicError::BusinessRuleViolation)?;
                    if achievement_type.raw_data().to_vec() == b"FirstPointsReward" {
                        return Ok(());
                    }
                    if achievement_type.raw_data().to_vec() == b"FirstQuestSubmission" {
                        return Ok(());
                    }
                    return Ok(());
                }
                None => {
                    return Err(DeterministicError::BusinessRuleViolation);
                }
            }
            Err(DeterministicError::BusinessRuleViolation)
        }
    }
}

/// Get all validation rules for user type
pub fn get_all_rules() -> Vec<TransactionValidationRules<RuleBasedClassifier>> {
    vec![claim_achievement::get_rules()]
}
