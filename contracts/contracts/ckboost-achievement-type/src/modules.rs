use alloc::{vec, vec::Vec};
use blake2b_ref::Blake2bBuilder;
use ckb_deterministic::{
    cell_classifier::RuleBasedClassifier, create_inline_argument, create_recipe_with_args,
    create_recipe_with_reference, debug_trace, serialize_transaction_recipe,
    transaction_context::TransactionContext,
};
use ckb_ssri_std::utils::high_level::{
    find_cell_by_out_point, find_cell_data_by_out_point, find_out_point_by_type,
};
use ckb_std::{
    ckb_constants::Source,
    ckb_types::{
        packed::{
            Byte32Vec, BytesOpt, BytesVecBuilder, CellDepVecBuilder, CellInput,
            CellInputVecBuilder, CellOutputBuilder, CellOutputVecBuilder, RawTransactionBuilder,
            ScriptBuilder, ScriptOptBuilder, Transaction, TransactionBuilder, WitnessArgsBuilder,
        },
        prelude::*,
    },
    high_level::load_script,
};
use ckboost_shared::{
    types::{AchievementDataVec, Byte32 as SharedByte32, ConnectedTypeID, String},
    Error,
};

pub struct CKBoostAchievementType;

use crate::{recipes, ssri::CKBoostAchievement};

impl CKBoostAchievement for CKBoostAchievementType {
    fn update_achievement(
        tx: Option<Transaction>,
        achievement_data: AchievementDataVec,
    ) -> Result<Transaction, Error> {
        debug_trace!("CKBoostAchievementType::update_achievement - start");

        let tx_builder = match tx {
            Some(ref tx) => tx.clone().as_builder(),
            None => TransactionBuilder::default(),
        };
        let raw_tx_builder = match tx {
            Some(ref tx) => tx.clone().raw().as_builder(),
            None => RawTransactionBuilder::default(),
        };

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

        let current_script = load_script()?;

        let achievement_result: Result<
            ckb_std::ckb_types::packed::OutPoint,
            ckb_std::error::SysError,
        > = if current_script.args().len() == 0 {
            Err(ckb_std::error::SysError::Unknown(0))
        } else {
            find_out_point_by_type(current_script.clone())
        };

        let achievement_input_index: usize;
        let mut achievement_output_index: Option<usize> = None;

        match achievement_result {
            Ok(out_point) => {
                achievement_input_index = tx.as_ref().map(|t| t.raw().inputs().len()).unwrap_or(0);

                let achievement_input = CellInput::new_builder()
                    .previous_output(out_point.clone())
                    .build();
                cell_input_vec_builder = cell_input_vec_builder.push(achievement_input);

                let current_achievement_cell =
                    find_cell_by_out_point(out_point).map_err(|_| Error::MissingAchievementCell)?;

                achievement_output_index =
                    Some(tx.as_ref().map(|t| t.raw().outputs().len()).unwrap_or(0));

                let new_output = CellOutputBuilder::default()
                    .type_(
                        ScriptOptBuilder::default()
                            .set(Some(current_script))
                            .build(),
                    )
                    .lock(current_achievement_cell.lock())
                    .capacity(0u64.pack())
                    .build();
                cell_output_vec_builder = cell_output_vec_builder.push(new_output);
            }
            Err(_) => {
                let (first_input, output_count) = match tx {
                    Some(ref tx) => {
                        let first_input = tx
                            .raw()
                            .inputs()
                            .get(0)
                            .ok_or(Error::MissingTransactionInput)?;
                        (first_input, tx.raw().outputs().len())
                    }
                    None => {
                        debug_trace!(
                            "update_achievement requires a transaction with at least one input"
                        );
                        return Err(Error::MissingTransactionInput);
                    }
                };

                let mut blake2b = Blake2bBuilder::new(32)
                    .personal(b"ckb-default-hash")
                    .build();
                blake2b.update(first_input.as_slice());
                blake2b.update(&output_count.to_le_bytes());
                let mut type_id = [0u8; 32];
                blake2b.finalize(&mut type_id);

                let new_connected_type_id = ConnectedTypeID::new_builder()
                    .type_id(SharedByte32::from_slice(&type_id).unwrap())
                    .connected_key(SharedByte32::from_slice(&[0u8; 32]).unwrap())
                    .build();

                let new_type_script = ScriptBuilder::default()
                    .code_hash(current_script.code_hash())
                    .hash_type(current_script.hash_type())
                    .args(new_connected_type_id.as_bytes().pack())
                    .build();

                let first_input_cell = find_cell_by_out_point(first_input.previous_output())
                    .map_err(|_| Error::MissingAchievementCell)?;

                achievement_input_index = 0;
                achievement_output_index = Some(output_count);

                let new_output = CellOutputBuilder::default()
                    .type_(
                        ScriptOptBuilder::default()
                            .set(Some(new_type_script))
                            .build(),
                    )
                    .lock(first_input_cell.lock())
                    .capacity(0u64.pack())
                    .build();
                cell_output_vec_builder = cell_output_vec_builder.push(new_output);
            }
        }

        let achievement_data_bytes = achievement_data.as_bytes();
        outputs_data_builder = outputs_data_builder.push(achievement_data_bytes.pack());

        let output_data_index = tx
            .as_ref()
            .map(|t| t.raw().outputs_data().len())
            .unwrap_or(0) as u32;

        let recipe = create_recipe_with_args(
            "CKBoostAchievement.update_achievement",
            vec![create_recipe_with_reference(
                Source::Output,
                output_data_index,
            )],
        )?;

        let recipe_bytes = serialize_transaction_recipe(&recipe);

        let witness_args = WitnessArgsBuilder::default()
            .lock(BytesOpt::default())
            .input_type(BytesOpt::default())
            .output_type(
                BytesOpt::new_builder()
                    .set(Some(recipe_bytes.pack()))
                    .build(),
            )
            .build();

        let witness_index = achievement_output_index.unwrap_or(achievement_input_index);

        let witnesses_builder = match tx {
            Some(ref tx) => {
                let mut builder = BytesVecBuilder::default();
                let witnesses = tx.witnesses();
                let total_inputs = cell_input_vec_builder.build().len();

                for i in 0..witness_index {
                    match witnesses.get(i) {
                        Some(witness) => builder = builder.push(witness),
                        None => {
                            let empty_witness = WitnessArgsBuilder::default().build();
                            builder = builder.push(empty_witness.as_bytes().pack());
                        }
                    }
                }

                builder = builder.push(witness_args.as_bytes().pack());

                for i in (witness_index + 1)..total_inputs {
                    match witnesses.get(i) {
                        Some(witness) => builder = builder.push(witness),
                        None => {
                            let empty_witness = WitnessArgsBuilder::default().build();
                            builder = builder.push(empty_witness.as_bytes().pack());
                        }
                    }
                }

                for i in total_inputs..witnesses.len() {
                    if let Some(witness) = witnesses.get(i) {
                        builder = builder.push(witness);
                    }
                }

                builder
            }
            None => BytesVecBuilder::default().push(witness_args.as_bytes().pack()),
        };

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

    fn claim_achievement(
        tx: Option<Transaction>,
        achievement_type: String,
    ) -> Result<Transaction, Error> {
        debug_trace!("CKBoostAchievementType::claim_achievement - start");

        // Initialize transaction builders
        let tx_builder = match tx {
            Some(ref tx) => tx.clone().as_builder(),
            None => TransactionBuilder::default(),
        };
        let raw_tx_builder = match tx {
            Some(ref tx) => tx.clone().raw().as_builder(),
            None => RawTransactionBuilder::default(),
        };

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

        let current_script = load_script()?;
        debug_trace!("current_script: {:?}", current_script);

        // Ensure arguments contain a valid ConnectedTypeID reference
        // TODO: Get the input and output achievement cell. At the moment it's failing for memory issue

        let output_data_index = tx
            .as_ref()
            .map(|t| t.raw().outputs_data().len())
            .unwrap_or(0) as u32;

        let recipe = create_recipe_with_args(
            "CKBoostAchievement.claim_achievement",
            vec![create_inline_argument(&achievement_type.as_bytes())],
        )?;
        let recipe_bytes = serialize_transaction_recipe(&recipe);

        let witness_args = WitnessArgsBuilder::default()
            .lock(BytesOpt::default())
            .input_type(BytesOpt::default())
            .output_type(
                BytesOpt::new_builder()
                    .set(Some(recipe_bytes.pack()))
                    .build(),
            )
            .build();

        let witnesses_builder = match tx {
            Some(ref tx) => {
                let mut builder = BytesVecBuilder::default();
                let witnesses = tx.witnesses();
                let total_inputs = cell_input_vec_builder.build().len();

                for i in 0..witnesses.len() {
                    builder = builder.push(witnesses.get(i).unwrap());
                }

                builder = builder.push(witness_args.as_bytes().pack());

                for _ in witnesses.len()..total_inputs {
                    let empty_witness = WitnessArgsBuilder::default().build();
                    builder = builder.push(empty_witness.as_bytes().pack());
                }

                builder
            }
            None => BytesVecBuilder::default().push(witness_args.as_bytes().pack()),
        };

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

    fn verify_claim_achievement(
        context: &TransactionContext<RuleBasedClassifier>,
    ) -> Result<(), Error> {
        debug_trace!("Starting verify_claim_achievement");

        // Use the recipe validation rules
        let validation_rules = recipes::claim_achievement::get_rules();
        validation_rules.validate(&context)?;

        debug_trace!("Verification data update validation completed successfully");
        Ok(())
    }

    fn verify_update_achievement(
        context: &TransactionContext<RuleBasedClassifier>,
    ) -> Result<(), Error> {
        debug_trace!("Starting verify_update_achievement");

        let validation_rules = recipes::update_achievement::get_rules();
        validation_rules.validate(&context)?;

        debug_trace!("Achievement update transaction validation completed successfully");
        Ok(())
    }
}
