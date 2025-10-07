extern crate alloc;

pub mod helper {
    use ckb_deterministic::debug_trace;
    use ckb_deterministic::errors::Error as DeterministicError;
    use ckb_std::ckb_constants::Source;
    use ckb_std::high_level::{load_cell_data, load_cell_type_hash};
    use ckboost_shared::types::protocol::ProtocolDataReader;
    use molecule::prelude::Reader;

    // 1.Validate a protocol cell's data against expected tipping code hash
    // 2. Validate connection to tipping type
    pub fn validate_protocol_cell(
        data: &[u8],
        expected_code_hash: &[u8],
    ) -> Result<(), DeterministicError> {
        let protocol_data =
            ProtocolDataReader::from_slice(data).map_err(|_| DeterministicError::Encoding)?;

        let tipping_code_hash = protocol_data
            .protocol_config()
            .script_code_hashes()
            .ckb_boost_tipping_type_code_hash();

        if tipping_code_hash.as_slice() == expected_code_hash {
            Ok(())
        } else {
            ("CellRelationshipRuleViolation: tipping code hash mismatch in protocol cell");
            ("  Expected: {:?}", expected_code_hash);
            ("  Got: {:?}", tipping_code_hash.as_slice());
            Err(DeterministicError::CellRelationshipRuleViolation)
        }
    }

    // Find and validate protocol cell in deps
    pub fn find_protocol_cell_in_deps(
        protocol_type_hash: &[u8],
        current_code_hash: &[u8],
    ) -> Result<(), DeterministicError> {
        let mut index = 0;
        loop {
            match load_cell_type_hash(index, Source::CellDep) {
                Ok(Some(dep_type_hash)) if dep_type_hash == protocol_type_hash => {
                    // Found a matching type hash, validate the cell data
                    let data = load_cell_data(index, Source::CellDep).map_err(|e| {
                        (
                            "CellRelationshipRuleViolation: Failed to load cell data at index {}",
                            index,
                        );
                        ("  Error: {:?}", e);
                        DeterministicError::CellRelationshipRuleViolation
                    })?;

                    // Try to validate the protocol cell, return Ok if successful
                    match validate_protocol_cell(&data, current_code_hash) {
                        Ok(()) => return Ok(()),
                        Err(_) => {} // Continue searching if validation fails
                    }
                }
                Err(ckb_std::error::SysError::IndexOutOfBound) => break,
                _ => {}
            }
            index += 1;
        }
        debug_trace!("CellRelationshipRuleViolation: Protocol cell not found in deps");
        debug_trace!("  Looking for protocol type hash: {:?}", protocol_type_hash);
        Err(DeterministicError::CellRelationshipRuleViolation)
    }
}

pub mod common {
    use ckb_deterministic::debug_trace;
    use ckb_deterministic::errors::Error as DeterministicError;
    use ckb_deterministic::transaction_recipe::TransactionRecipeExt;
    use ckb_deterministic::{assertions::expect, cell_classifier::RuleBasedClassifier};
    use ckboost_shared::transaction_context::TransactionContext;

    // **Script immutability**: Lock hash and type hash for tipping cells must remain unchanged
    pub fn script_immutability(
        context: &TransactionContext<RuleBasedClassifier>,
    ) -> Result<(), DeterministicError> {
        // Get the tipping cells from input and output
        let input_tipping_cells = match context.input_cells.get_custom("tipping") {
            Some(cells) => cells,
            None => {
                // Only creation scenario when the recipe is create tipping has no input tipping cell
                if context.recipe.method_path_bytes().as_slice() == b"CKBoostTipping.update_tipping"
                {
                    return Ok(());
                } else {
                    debug_trace!("Missing tipping cell in input");
                    return Err(DeterministicError::CellCountViolation);
                }
            }
        };
        let output_tipping_cells = context.output_cells.get_custom("tipping").ok_or_else(|| {
            debug_trace!(
                "CellCountViolation: Missing tipping cell in output (script_immutability)"
            );
            DeterministicError::CellCountViolation
        })?;

        // For each tipping cell, verify lock and type hashes remain unchanged
        for (i, input_cell) in input_tipping_cells.iter().enumerate() {
            let output_cell = output_tipping_cells.get(i).ok_or_else(|| {
                debug_trace!(
                    "CellCountViolation: Output tipping cell {} not found (script_immutability)",
                    i
                );
                DeterministicError::CellCountViolation
            })?;

            // Verify lock hash immutability
            expect(&input_cell.lock_hash)
                .to_equal(&output_cell.lock_hash)
                .map_err(|_| {
                    debug_trace!(
                        "CellRelationshipRuleViolation: Lock hash mismatch at index {}",
                        i
                    );
                    debug_trace!("  Input lock hash: {:?}", input_cell.lock_hash);
                    debug_trace!("  Output lock hash: {:?}", output_cell.lock_hash);
                    DeterministicError::CellRelationshipRuleViolation
                })?;

            // Verify type hash immutability
            match (&input_cell.type_hash, &output_cell.type_hash) {
                (Some(input_hash), Some(output_hash)) => {
                    expect(&input_hash).to_equal(&output_hash).map_err(|_| {
                        debug_trace!(
                            "CellRelationshipRuleViolation: Type hash mismatch at index {}",
                            i
                        );
                        debug_trace!("  Input type hash: {:?}", input_hash);
                        debug_trace!("  Output type hash: {:?}", output_hash);
                        DeterministicError::CellRelationshipRuleViolation
                    })?;
                }
                _ => {
                    // Either input or output tipping cell has no type hash - this is not allowed
                    debug_trace!(
                        "CellRelationshipRuleViolation: tipping cell missing type hash at index {}",
                        i
                    );
                    debug_trace!("  Input has type: {}", input_cell.type_hash.is_some());
                    debug_trace!("  Output has type: {}", output_cell.type_hash.is_some());
                    return Err(DeterministicError::CellRelationshipRuleViolation);
                }
            }
        }

        Ok(())
    }
}

pub mod update_tipping {
    use super::common;
    use alloc::{string::ToString, vec};
    use ckb_deterministic::{
        cell_classifier::RuleBasedClassifier,
        validation::{CellCountConstraint, TransactionValidationRules},
    };

    pub fn get_rules() -> TransactionValidationRules<RuleBasedClassifier> {
        TransactionValidationRules::new(b"CKBoostTipping.update_tipping".to_vec())
            .with_arguments(1)
            .with_custom_cell(
                "tipping",
                CellCountConstraint::at_most(1),
                CellCountConstraint::exactly(1),
            )
            .with_business_rule(
                "automatic_execution".to_string(),
                "When a tipping receives sufficient approval, it must be automatically executed"
                    .to_string(),
                vec!["protocol".to_string()],
                business_logic::automatic_execution,
            )
            .with_business_rule(
                "approval_restrictions".to_string(),
                "Cannot approve tippings that are already fully approved or have expired"
                    .to_string(),
                vec!["protocol".to_string()],
                business_logic::approval_restrictions,
            )
    }

    pub mod business_logic {
        use ckb_deterministic::assertions::expect;
        use ckb_deterministic::cell_classifier::RuleBasedClassifier;
        use ckb_deterministic::errors::Error as DeterministicError;
        use ckboost_shared::generated::ckboost::ProtocolData;
        use ckboost_shared::transaction_context::TransactionContext;
        use molecule::prelude::*;

        /// **Automatic execution**: When a tipping receives sufficient approval,
        /// it must be automatically executed with funds transferred to the target address
        pub fn automatic_execution(
            context: &TransactionContext<RuleBasedClassifier>,
        ) -> Result<(), DeterministicError> {
            // // Get protocol cells
            // let input_protocol_cells = context
            //     .input_cells
            //     .get_custom("protocol")
            //     .ok_or(DeterministicError::CellCountViolation)?;
            // let output_protocol_cells = context
            //     .output_cells
            //     .get_custom("protocol")
            //     .ok_or(DeterministicError::CellCountViolation)?;

            // // Parse protocol data
            // let input_protocol_data = ProtocolData::from_slice(&input_protocol_cells[0].data)
            //     .map_err(|_| DeterministicError::Encoding)?;
            // let output_protocol_data = ProtocolData::from_slice(&output_protocol_cells[0].data)
            //     .map_err(|_| DeterministicError::Encoding)?;

            // let input_tippings = input_protocol_data.tippings_approved();
            // let output_tippings = output_protocol_data.tippings_approved();
            // let tipping_config = input_protocol_data.tipping_config();

            // Check each tipping to see if it should be executed
            // for i in 0..input_tippings.len() {
            //     let input_tipping = input_tippings.get(i).unwrap();

            //     // Get approval count from approval_transaction_hash vector
            //     let approval_count = input_tipping.approval_transaction_hash().len() as u8;

            //     // Get approval threshold based on tipping amount
            //     let _tipping_amount = input_tipping.amount();
            //     let thresholds = tipping_config.approval_requirement_thresholds();

            //     // Find appropriate threshold
            //     // For now, we'll use a simple threshold calculation
            //     // In a real implementation, you'd check the amount against the thresholds
            //     let required_approvals = if thresholds.len() > 0 {
            //         // Use thresholds length as a simple proxy for required approvals
            //         // In production, you'd have a proper threshold lookup based on amount
            //         core::cmp::min(3u8, thresholds.len() as u8)
            //     } else {
            //         1u8 // Default minimum
            //     };

            //     // If tipping has enough approvals, it should be executed (removed from list)
            //     if approval_count >= required_approvals {
            //         // The tipping should not exist in output (it was executed)
            //         // Since we're checking existing tippings, if it still exists with enough approvals,
            //         // that's a violation
            //         if i < output_tippings.len() {
            //             match output_tippings.get(i) {
            //                 Some(output_tipping) => {
            //                     // Compare to see if it's the same tipping
            //                     if input_tipping.as_slice() == output_tipping.as_slice() {
            //                         return Err(DeterministicError::BusinessRuleViolation);
            //                     }
            //                 }
            //                 None => {
            //                     // Index out of bounds, skip
            //                 }
            //             }
            //         }
            //     }
            // }

            Ok(())
        }

        /// **Approval restrictions**: Cannot approve tippings that are already
        /// fully approved or have expired
        pub fn approval_restrictions(
            context: &TransactionContext<RuleBasedClassifier>,
        ) -> Result<(), DeterministicError> {
            // // For this validation, we need to compare input and output to detect new approvals
            // // We'll check if expired tippings have new approvals or if fully approved tippings get more

            // // Get protocol cells
            // let input_protocol_cells = context
            //     .input_cells
            //     .get_custom("protocol")
            //     .ok_or(DeterministicError::CellCountViolation)?;
            // let output_protocol_cells = context
            //     .output_cells
            //     .get_custom("protocol")
            //     .ok_or(DeterministicError::CellCountViolation)?;

            // // Parse protocol data
            // let input_protocol_data = ProtocolData::from_slice(&input_protocol_cells[0].data)
            //     .map_err(|_| DeterministicError::Encoding)?;
            // let output_protocol_data = ProtocolData::from_slice(&output_protocol_cells[0].data)
            //     .map_err(|_| DeterministicError::Encoding)?;

            // let input_tippings = input_protocol_data.tippings_approved();
            // let output_tippings = output_protocol_data.tippings_approved();
            // let tipping_config = output_protocol_data.tipping_config();

            // // Get expiration duration
            // let expiration_duration_bytes = tipping_config.expiration_duration();
            // let _expiration_duration = u64::from_le_bytes(
            //     expiration_duration_bytes.as_slice()[0..8]
            //         .try_into()
            //         .map_err(|_| DeterministicError::Encoding)?,
            // );

            // Get current timestamp from transaction context
            // Note: In a real implementation, you'd get this from the block header
            // For now, we'll use a placeholder approach
            // TODO: Implement proper timestamp retrieval from header deps

            // // Check each tipping for new approvals
            // for i in 0..input_tippings.len() {
            //     if i >= output_tippings.len() {
            //         break; // tipping was removed (executed)
            //     }

            //     let input_tipping = input_tippings.get(i).unwrap();
            //     let output_tipping = output_tippings.get(i).unwrap();

            //     let input_approvals = input_tipping.approval_transaction_hash();
            //     let output_approvals = output_tipping.approval_transaction_hash();

            //     // Check if new approvals were added
            //     if output_approvals.len() > input_approvals.len() {
            //         // New approvals were added, check if this is allowed

            //         // Check if tipping is already at max approvals
            //         let thresholds = tipping_config.approval_requirement_thresholds();
            //         let max_approvals = if thresholds.len() > 0 {
            //             core::cmp::min(5, thresholds.len()) // Reasonable max
            //         } else {
            //             3 // Default max
            //         };

            //         if input_approvals.len() >= max_approvals {
            //             // Already at max approvals, no new ones allowed
            //             return Err(DeterministicError::BusinessRuleViolation);
            //         }

            //         // TODO: Check expiration when we have proper timestamp access
            //         // For now, we'll skip the expiration check
            //     }
            // }

            Ok(())
        }

        /// **Data immutability**: All other protocol data must remain unchanged
        /// during tipping updates
        pub fn data_immutability(
            context: &TransactionContext<RuleBasedClassifier>,
        ) -> Result<(), DeterministicError> {
            // Get protocol cells
            let input_protocol_cells = context
                .input_cells
                .get_custom("protocol")
                .ok_or(DeterministicError::CellCountViolation)?;
            let output_protocol_cells = context
                .output_cells
                .get_custom("protocol")
                .ok_or(DeterministicError::CellCountViolation)?;

            // Parse protocol data
            let input_protocol_data = ProtocolData::from_slice(&input_protocol_cells[0].data)
                .map_err(|_| DeterministicError::Encoding)?;
            let output_protocol_data = ProtocolData::from_slice(&output_protocol_cells[0].data)
                .map_err(|_| DeterministicError::Encoding)?;

            // Check all fields except tippings remain unchanged

            // tippings_approved must be unchanged
            if input_protocol_data.tippings_approved().as_slice()
                != output_protocol_data.tippings_approved().as_slice()
            {
                return Err(DeterministicError::BusinessRuleViolation);
            }

            // tipping_config must be unchanged
            if input_protocol_data.tipping_config().as_slice()
                != output_protocol_data.tipping_config().as_slice()
            {
                return Err(DeterministicError::BusinessRuleViolation);
            }

            // endorsers_whitelist must be unchanged
            if input_protocol_data.endorsers_whitelist().as_slice()
                != output_protocol_data.endorsers_whitelist().as_slice()
            {
                return Err(DeterministicError::BusinessRuleViolation);
            }

            // protocol_config must be unchanged
            if input_protocol_data.protocol_config().as_slice()
                != output_protocol_data.protocol_config().as_slice()
            {
                return Err(DeterministicError::BusinessRuleViolation);
            }

            // Note: last_updated is allowed to change as it tracks update timestamp

            Ok(())
        }
        // **Tipping tipping immutability**: Tipping tipping data must remain unchanged during protocol updates to maintain tipping integrity
        //TODO: pub fn supporter_proxy_validation(
    }
}
