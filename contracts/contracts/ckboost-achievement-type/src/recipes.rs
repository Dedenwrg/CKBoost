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
        let input_achievement_cell_vec = match context.input_cells.get_custom("achievement") {
            Some(cells) => cells,
            None => {
                let method_path_bytes = context.recipe.method_path_bytes();
                let method_path = method_path_bytes.as_slice();
                // if method_path == b"CKBoostUser.submit_quest" {
                //     return Ok(());
                // }
                // if method_path == b"CKBoostUser.update_verification_data" {
                //     return Ok(());
                // } else {
                return Err(DeterministicError::CellRelationshipRuleViolation);
                // }
            }
        };
        let input_achievement_cell = &input_achievement_cell_vec
            .get(0)
            .ok_or(DeterministicError::CellCountViolation)?;

        let output_achievement_cell_vec = context
            .output_cells
            .get_custom("achievement")
            .ok_or(DeterministicError::CellCountViolation)?;
        let output_achievement_cell = &output_achievement_cell_vec
            .get(0)
            .ok_or(DeterministicError::CellCountViolation)?;

        // For Achievement Cell, verify lock and type hashes remain unchanged
        expect(&input_achievement_cell.lock_hash)
            .to_equal(&output_achievement_cell.lock_hash)
            .map_err(|_| DeterministicError::CellRelationshipRuleViolation)?;

        match (
            input_achievement_cell.type_hash,
            output_achievement_cell.type_hash,
        ) {
            (Some(input_hash), Some(output_hash)) => {
                expect(input_hash)
                    .to_equal(output_hash)
                    .map_err(|_| DeterministicError::CellRelationshipRuleViolation)?;
            }
            _ => {
                // Either input or output user cell has no type hash - this is not allowed
                return Err(DeterministicError::CellRelationshipRuleViolation);
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
            .with_arguments(0)
            .with_custom_cell(
                "achievement",
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
                "claim_achievement_validation".to_string(),
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

        // **Verification update validation**: Ensure only authorized verification updates
        pub fn claim_achievement_validation(
            context: &TransactionContext<RuleBasedClassifier>,
        ) -> Result<(), DeterministicError> {
            // Rule: There must be a simple CKB cell locked by admin.

            // NOTE: Achievement specific validations should be done in netlify function with admin proxy.
            let potential_admin_proxy_cells = context.input_cells.get_simple_ckb();
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

pub mod update_achievement {
    use ckb_deterministic::{
        cell_classifier::RuleBasedClassifier,
        validation::{CellCountConstraint, TransactionValidationRules},
    };

    pub fn get_rules() -> TransactionValidationRules<RuleBasedClassifier> {
        TransactionValidationRules::new(b"CKBoostAchievement.update_achievement".to_vec())
            .with_arguments(1)
            .with_custom_cell(
                "achievement",
                CellCountConstraint::at_most(1),
                CellCountConstraint::exactly(1),
            )
    }
}

/// Get all validation rules for user type
pub fn get_all_rules() -> Vec<TransactionValidationRules<RuleBasedClassifier>> {
    vec![claim_achievement::get_rules()]
}
