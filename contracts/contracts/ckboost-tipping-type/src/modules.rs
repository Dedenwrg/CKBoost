use alloc::vec;
use alloc::vec::Vec;
use blake2b_ref::Blake2bBuilder;
use ckb_deterministic::{
    cell_classifier::RuleBasedClassifier, create_inline_argument, create_recipe_with_args,
    create_recipe_with_reference, debug_info, debug_trace, serialize_transaction_recipe,
    transaction_context::TransactionContext, transaction_recipe::TransactionRecipeExt,
};
use ckb_ssri_std::utils::high_level::{find_cell_by_out_point, find_out_point_by_type};
use ckb_std::{
    ckb_constants::Source,
    ckb_types::{
        packed::{
            Byte32, Byte32Vec, Byte32VecBuilder, BytesOpt, BytesVecBuilder, CellDepVecBuilder,
            CellInput, CellInputVecBuilder, CellOutputBuilder, CellOutputVecBuilder,
            RawTransactionBuilder, ScriptBuilder, ScriptOptBuilder, Transaction,
            TransactionBuilder, WitnessArgsBuilder,
        },
        prelude::*,
    },
    high_level::load_script,
};
use ckboost_shared::{
    types::{Byte32 as SharedByte32, ConnectedTypeID, TippingProposalData},
    Error,
};

pub struct CKBoostTippingType;

use crate::{recipes, ssri::CKBoostTipping};

impl CKBoostTipping for CKBoostTippingType {
    fn update_tipping_proposal(
        tx: Option<Transaction>,
        tipping_proposal_data: TippingProposalData,
    ) -> Result<Transaction, Error> {
        debug_trace!(
            "CKBoostTippingType::update_tipping_proposal - Starting tipping proposal update"
        );
        debug_info!("Input transaction present: {}", tx.is_some());

        // Initialize transaction builders
        debug_trace!("Initializing transaction builders");
        let tx_builder = match tx {
            Some(ref tx) => {
                debug_info!("Using existing transaction as base");
                tx.clone().as_builder()
            }
            None => {
                debug_info!("Creating new transaction builder");
                TransactionBuilder::default()
            }
        };
        let raw_tx_builder = match tx {
            Some(ref tx) => tx.clone().raw().as_builder(),
            None => RawTransactionBuilder::default(),
        };

        // Initialize builders from existing transaction or create new
        let mut cell_input_vec_builder = match tx {
            Some(ref tx) => tx.clone().raw().inputs().as_builder(),
            None => CellInputVecBuilder::default(),
        };

        let mut cell_output_vec_builder = match tx {
            Some(ref tx) => tx.clone().raw().outputs().as_builder(),
            None => CellOutputVecBuilder::default(),
        };

        let mut outputs_data_builder = match tx {
            Some(ref tx) => tx.clone().raw().outputs_data().as_builder(),
            None => BytesVecBuilder::default(),
        };

        let cell_dep_vec_builder = match tx {
            Some(ref tx) => tx.clone().raw().cell_deps().as_builder(),
            None => CellDepVecBuilder::default(),
        };

        // Get context script and parse ConnectedTypeID from args
        debug_trace!("Loading current script");
        let current_script = match load_script() {
            Ok(script) => {
                debug_trace!("Script loaded successfully");
                debug_info!("Script code_hash: {}", &script.code_hash());
                debug_info!("Script args: {}", script.args());
                script
            }
            Err(e) => {
                debug_info!("ERROR loading script: error code = {:?}", e);
                debug_info!("This typically means the SSRI VM context is not properly set");
                return Err(e.into());
            }
        };

        let args = current_script.args();
        let args_data = args.raw_data();
        debug_info!("Parsing ConnectedTypeID from {} bytes", args_data.len());
        let connected_type_id = ConnectedTypeID::from_slice(&args_data).map_err(|e| {
            debug_info!("ERROR parsing ConnectedTypeID: {:?}", e);
            Error::InvalidConnectedTypeId
        });

        // Track the index where the tipping cell will be in the inputs
        let tipping_input_index: usize;

        // Track if we have a tipping output and at what index
        let tipping_output_index: Option<usize>;

        // If tipping_type_id is empty, we're creating a new tipping cell
        // Otherwise, we should try to find the existing one

        match connected_type_id {
            Ok(connected_type_id) => {
                debug_trace!("Found existing tipping cell, updating it");
                let tipping_outpoint =
                    find_out_point_by_type(current_script.clone()).map_err(|e| {
                        debug_info!("ERROR finding tipping cell: {:?}", e);
                        e
                    })?;
                debug_info!("Found tipping at index: {}", tipping_outpoint.index());

                // The tipping cell will be added at the current end of inputs
                tipping_input_index = tx.as_ref().map(|t| t.raw().inputs().len()).unwrap_or(0);

                // Add tipping cell as input
                let tipping_input = CellInput::new_builder()
                    .previous_output(tipping_outpoint.clone())
                    .build();
                cell_input_vec_builder = cell_input_vec_builder.push(tipping_input);

                // Get the current tipping cell to preserve lock script
                let current_tipping_cell =
                    find_cell_by_out_point(tipping_outpoint).map_err(|e| {
                        debug_info!("ERROR loading tipping cell: {:?}", e);
                        Error::TippingCellNotFound
                    })?;

                // Track that we're adding a tipping output at the current output count
                tipping_output_index =
                    Some(tx.as_ref().map(|t| t.raw().outputs().len()).unwrap_or(0));

                // Create output tipping cell with updated data
                let new_tipping_output = CellOutputBuilder::default()
                    .type_(
                        ScriptOptBuilder::default()
                            .set(Some(current_script))
                            .build(),
                    )
                    .lock(current_tipping_cell.lock())
                    .capacity(0u64.pack())
                    .build();
                cell_output_vec_builder = cell_output_vec_builder.push(new_tipping_output);
            }
            Err(_) => {
                debug_trace!("No tipping cell found. Creating a new tipping cell.");

                // In creation case, tipping cell doesn't exist as input
                // But we still need a witness for the first input (used for type ID calculation)
                tipping_input_index = 0;

                // tipping creation case - need type ID
                // For type ID calculation, we need at least one input
                let (first_input, output_index) = match tx {
                    Some(ref tx) => {
                        // Use existing transaction's first input and next output index
                        let first_input = tx.raw().inputs().get(0)
                            .ok_or_else(|| {
                                debug_trace!("Transaction has no inputs. Use ccc.Transaction.completeInputsAtLeastOne(signer) to add at least one input.");
                                Error::MissingTransactionInput
                            })?;
                        (first_input, tx.raw().outputs().len())
                    }
                    None => {
                        // No transaction provided - we cannot create a tipping cell without inputs
                        return Err(Error::MissingTransactionInput);
                    }
                };

                // Calculate type ID based on first input and output index
                let mut blake2b = Blake2bBuilder::new(32)
                    .personal(b"ckb-default-hash")
                    .build();
                blake2b.update(first_input.as_slice());
                blake2b.update(&output_index.to_le_bytes());
                let mut type_id = [0u8; 32];
                blake2b.finalize(&mut type_id);

                // Create ConnectedTypeID with the new type ID and protocol reference
                let new_connected_type_id = ConnectedTypeID::new_builder()
                    .type_id(SharedByte32::from_slice(&type_id).unwrap())
                    // Leave connected_key empty for now and let dapp fill it in with the correct protocol cell type hash
                    .connected_key(SharedByte32::from_slice(&[0u8; 32]).unwrap())
                    .build();

                // Create the type script with ConnectedTypeID as args
                let new_type_script = ScriptBuilder::default()
                    .code_hash(current_script.code_hash())
                    .hash_type(current_script.hash_type())
                    .args(new_connected_type_id.as_bytes().pack())
                    .build();

                // Get first input cell to use its lock for the new tipping cell
                let first_input_outpoint = first_input.previous_output();
                let first_input_cell = find_cell_by_out_point(first_input_outpoint)?;

                // Track that we're adding a tipping output at the current output count
                tipping_output_index =
                    Some(tx.as_ref().map(|t| t.raw().outputs().len()).unwrap_or(0));

                // Create new tipping cell
                let new_tipping_output = CellOutputBuilder::default()
                    .type_(
                        ScriptOptBuilder::default()
                            .set(Some(new_type_script))
                            .build(),
                    )
                    .lock(first_input_cell.lock())
                    .capacity(0u64.pack())
                    .build();
                cell_output_vec_builder = cell_output_vec_builder.push(new_tipping_output);
            }
        }

        // Serialize and add updated tipping data
        debug_trace!("Serializing tipping data");
        let tipping_data_bytes = tipping_proposal_data.as_bytes();
        debug_info!("Serialized size: {} bytes", tipping_data_bytes.len());
        if tipping_data_bytes.len() > 100000 {
            debug_info!("WARNING: Large tipping data size!");
        }
        outputs_data_builder = outputs_data_builder.push(tipping_data_bytes.pack());
        debug_trace!("tipping data added to outputs");

        // Create the recipe witness using ckb_deterministic's helper function
        let output_data_index = tx
            .as_ref()
            .map(|t| t.raw().outputs_data().len())
            .unwrap_or(0) as u32;

        // Create recipe with output data reference
        let recipe = create_recipe_with_args(
            "CKBoostTipping.update_tipping_proposal",
            vec![create_recipe_with_reference(
                Source::Output,
                output_data_index,
            )],
        )?;

        // Serialize the recipe to bytes
        let recipe_bytes = serialize_transaction_recipe(&recipe);

        // Create WitnessArgs with recipe in output_type field
        let witness_args = WitnessArgsBuilder::default()
            .lock(BytesOpt::default())
            .input_type(BytesOpt::default())
            .output_type(
                BytesOpt::new_builder()
                    .set(Some(recipe_bytes.pack()))
                    .build(),
            )
            .build();

        // Determine where to place the witness
        let witness_index = match tipping_output_index {
            Some(output_idx) => {
                debug_trace!("Placing recipe witness at output index: {}", output_idx);
                output_idx
            }
            None => {
                debug_trace!(
                    "No tipping output, placing recipe witness at input index: {}",
                    tipping_input_index
                );
                tipping_input_index
            }
        };

        // Build witnesses vector with recipe witness at the correct index
        let witnesses_builder = match tx {
            Some(ref tx) => {
                let mut builder = BytesVecBuilder::default();
                let witnesses = tx.witnesses();

                // We need to ensure witnesses for all inputs
                let total_inputs = cell_input_vec_builder.build().len();

                // Copy existing witnesses or create empty ones up to witness_index
                for i in 0..witness_index {
                    match witnesses.get(i) {
                        Some(witness) => {
                            builder = builder.push(witness);
                        }
                        None => {
                            let empty_witness = WitnessArgsBuilder::default().build();
                            builder = builder.push(empty_witness.as_bytes().pack());
                        }
                    }
                }

                // Add the recipe witness at witness_index
                builder = builder.push(witness_args.as_bytes().pack());

                // Add remaining witnesses after witness_index
                for i in (witness_index + 1)..total_inputs {
                    match witnesses.get(i) {
                        Some(witness) => {
                            builder = builder.push(witness);
                        }
                        None => {
                            let empty_witness = WitnessArgsBuilder::default().build();
                            builder = builder.push(empty_witness.as_bytes().pack());
                        }
                    }
                }

                // Add any extra witnesses that might exist beyond input count
                for i in total_inputs..witnesses.len() {
                    match witnesses.get(i) {
                        Some(witness) => {
                            builder = builder.push(witness);
                        }
                        None => {
                            // Should not happen since we're iterating within bounds, but handle gracefully
                        }
                    }
                }

                builder
            }
            None => {
                // No existing transaction, just add the WitnessArgs with recipe
                BytesVecBuilder::default().push(witness_args.as_bytes().pack())
            }
        };

        // Build the complete transaction
        debug_trace!("Building final transaction");

        let cell_deps = cell_dep_vec_builder.build();
        let inputs = cell_input_vec_builder.build();
        let outputs = cell_output_vec_builder.build();
        let outputs_data = outputs_data_builder.build();
        let witnesses = witnesses_builder.build();

        debug_info!("Final transaction structure:");
        debug_info!("  inputs: {}", inputs.len());
        debug_info!("  outputs: {}", outputs.len());
        debug_info!("  outputs_data: {}", outputs_data.len());
        debug_info!("  cell_deps: {}", cell_deps.len());
        debug_info!("  witnesses: {}", witnesses.len());

        let total_data_size: usize = (0..outputs_data.len())
            .map(|i| outputs_data.get(i).unwrap().len())
            .sum();
        debug_info!("Total outputs_data size: {} bytes", total_data_size);
        if total_data_size > 500000 {
            debug_info!("WARNING: Very large total data size!");
        }

        let result = tx_builder
            .raw(
                raw_tx_builder
                    .version(tx.clone().map(|t| t.raw().version()).unwrap_or_default())
                    .cell_deps(cell_deps)
                    .header_deps(
                        tx.clone()
                            .map(|t| t.raw().header_deps())
                            .unwrap_or_else(|| Byte32Vec::default()),
                    )
                    .inputs(inputs)
                    .outputs(outputs)
                    .outputs_data(outputs_data)
                    .build(),
            )
            .witnesses(witnesses)
            .build();

        debug_info!("Transaction built successfully");
        debug_trace!("update_tipping completed");
        Ok(result)
    }

    fn verify_update_tipping_proposal(
        context: &TransactionContext<RuleBasedClassifier>,
    ) -> Result<(), Error> {
        debug_trace!("Starting verify_update_tipping_proposal");

        // Use the recipe validation rules
        let validation_rules = recipes::update_tipping_proposal::get_rules();
        validation_rules.validate(context)?;

        debug_trace!("verify_update_tipping_proposal completed successfully");
        Ok(())
    }

    fn grant_tipping_reward(
        tx: Option<Transaction>,
        tipping_proposal_data: TippingProposalData,
    ) -> Result<Transaction, Error> {
        debug_trace!("CKBoostTippingType::grant_tipping_reward - Starting tipping reward grant");

        // Initialize transaction builders
        let tx_builder = match tx {
            Some(ref tx) => tx.clone().as_builder(),
            None => TransactionBuilder::default(),
        };
        let raw_tx_builder = match tx {
            Some(ref tx) => tx.clone().raw().as_builder(),
            None => RawTransactionBuilder::default(),
        };

        // Initialize builders from existing transaction or create new
        let mut cell_input_vec_builder = match tx {
            Some(ref tx) => tx.clone().raw().inputs().as_builder(),
            None => CellInputVecBuilder::default(),
        };

        let mut cell_output_vec_builder = match tx {
            Some(ref tx) => tx.clone().raw().outputs().as_builder(),
            None => CellOutputVecBuilder::default(),
        };

        let mut outputs_data_builder = match tx {
            Some(ref tx) => tx.clone().raw().outputs_data().as_builder(),
            None => BytesVecBuilder::default(),
        };

        let cell_dep_vec_builder = match tx {
            Some(ref tx) => tx.clone().raw().cell_deps().as_builder(),
            None => CellDepVecBuilder::default(),
        };

        // Get context script and parse ConnectedTypeID from args
        let current_script = load_script()?;
        debug_info!("current_script: {:?}", current_script);

        // Find and add existing tipping cell as input
        let tipping_outpoint = find_out_point_by_type(current_script.clone())?;
        let tipping_input = CellInput::new_builder()
            .previous_output(tipping_outpoint.clone())
            .build();
        cell_input_vec_builder = cell_input_vec_builder.push(tipping_input);

        // Get the current tipping cell to preserve lock script
        let current_tipping_cell =
            find_cell_by_out_point(tipping_outpoint).map_err(|_| Error::TippingCellNotFound)?;

        // TODO: Not handling this for now
        // // Verify tipping is active (status = 4)
        // if tipping_proposal_data.status() != 4u8.into() {
        //     return Err(Error::TippingNotActive);
        // }

        // Create updated tipping data
        let updated_tipping_data = TippingProposalData::new_builder()
            .target_address(tipping_proposal_data.target_address())
            .proposer_lock_hash(tipping_proposal_data.proposer_lock_hash())
            .metadata(tipping_proposal_data.metadata())
            .rewards(tipping_proposal_data.rewards())
            .status(tipping_proposal_data.status())
            .build();

        // Create output tipping cell with updated data
        let tipping_output_index = tx.as_ref().map(|t| t.raw().outputs().len()).unwrap_or(0) as u32;

        // Create output tipping cell with proper type script and lock script
        let tipping_output = CellOutputBuilder::default()
            .type_(
                ScriptOptBuilder::default()
                    .set(Some(current_script))
                    .build(),
            )
            .lock(current_tipping_cell.lock())
            .capacity(0u64.pack()) // Placeholder capacity
            .build();
        cell_output_vec_builder = cell_output_vec_builder.push(tipping_output);

        // Serialize and add updated tipping data
        let updated_tipping_data_bytes = updated_tipping_data.as_bytes();
        outputs_data_builder = outputs_data_builder.push(updated_tipping_data_bytes.pack());

        // Note: Points minting will be handled by the Points UDT contract
        // The tipping contract only updates the accepted_submission_user_type_ids
        // The actual Points cells creation happens in the transaction builder
        // UDT distribution and validation would be done in the funding-lock

        let recipe = create_recipe_with_args(
            "CKBoostTipping.grant_tipping_reward",
            vec![create_recipe_with_reference(
                Source::Output,
                tipping_output_index,
            )],
        )?;

        // Serialize the recipe to bytes
        let recipe_bytes = serialize_transaction_recipe(&recipe);

        // Create WitnessArgs with recipe in output_type field
        let witness_args = WitnessArgsBuilder::default()
            .lock(BytesOpt::default())
            .input_type(BytesOpt::default())
            .output_type(
                BytesOpt::new_builder()
                    .set(Some(recipe_bytes.pack()))
                    .build(),
            )
            .build();

        // Build witnesses vector with recipe witness at tipping output index
        let witnesses_builder = match tx {
            Some(ref tx) => {
                let mut builder = BytesVecBuilder::default();
                let witnesses = tx.witnesses();

                // Copy existing witnesses up to tipping_output_index
                for i in 0..tipping_output_index as usize {
                    match witnesses.get(i) {
                        Some(witness) => {
                            builder = builder.push(witness);
                        }
                        None => {
                            let empty_witness = WitnessArgsBuilder::default().build();
                            builder = builder.push(empty_witness.as_bytes().pack());
                        }
                    }
                }

                // Add the recipe witness at tipping_output_index
                builder = builder.push(witness_args.as_bytes().pack());

                // Add remaining witnesses
                for i in (tipping_output_index + 1) as usize..witnesses.len() {
                    match witnesses.get(i) {
                        Some(witness) => {
                            builder = builder.push(witness);
                        }
                        None => {
                            let empty_witness = WitnessArgsBuilder::default().build();
                            builder = builder.push(empty_witness.as_bytes().pack());
                        }
                    }
                }

                builder
            }
            None => BytesVecBuilder::default().push(witness_args.as_bytes().pack()),
        };

        // Build the complete transaction
        Ok(tx_builder
            .raw(
                raw_tx_builder
                    .version(tx.clone().map(|t| t.raw().version()).unwrap_or_default())
                    .cell_deps(cell_dep_vec_builder.build())
                    .header_deps(
                        tx.clone()
                            .map(|t| t.raw().header_deps())
                            .unwrap_or_else(|| Byte32Vec::default()),
                    )
                    .inputs(cell_input_vec_builder.build())
                    .outputs(cell_output_vec_builder.build())
                    .outputs_data(outputs_data_builder.build())
                    .build(),
            )
            .witnesses(witnesses_builder.build())
            .build())
    }

    fn verify_grant_tipping_reward(
        context: &TransactionContext<RuleBasedClassifier>,
    ) -> Result<(), Error> {
        Ok(())
    }
}
