use alloc::{vec, vec::Vec};
use ckb_deterministic::{
    cell_classifier::RuleBasedClassifier, create_recipe_with_args, create_recipe_with_reference,
    debug_trace, serialize_transaction_recipe, transaction_context::TransactionContext,
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
            ScriptOptBuilder, Transaction, TransactionBuilder, WitnessArgsBuilder,
        },
        prelude::*,
    },
    high_level::load_script,
};
use ckboost_shared::{
    types::{Bytes, ConnectedTypeID, String, UserData},
    Error,
};

pub struct CKBoostAchievementType;

use crate::{recipes, ssri::CKBoostAchievement};

impl CKBoostAchievement for CKBoostAchievementType {
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
        ConnectedTypeID::from_slice(&current_script.args().raw_data())
            .map_err(|_| Error::InvalidConnectedTypeId)?;

        // Locate the existing user cell connected to this achievement type
        let user_outpoint =
            find_out_point_by_type(current_script.clone()).map_err(|_| Error::UserCellNotFound)?;
        debug_trace!("Found user outpoint: {:?}", user_outpoint);

        let user_input = CellInput::new_builder()
            .previous_output(user_outpoint.clone())
            .build();
        cell_input_vec_builder = cell_input_vec_builder.push(user_input);

        let current_user_cell =
            find_cell_by_out_point(user_outpoint.clone()).map_err(|_| Error::UserCellNotFound)?;
        let current_user_data_bytes =
            find_cell_data_by_out_point(user_outpoint).map_err(|_| Error::UserCellNotFound)?;
        let current_user_data =
            UserData::from_slice(&current_user_data_bytes).map_err(|_| Error::InvalidUserData)?;

        // Prepare updated profile data with the claimed achievement
        let profile_data = current_user_data.profile_data();
        let raw_achievement = achievement_type.raw_data();
        let raw_slice = raw_achievement.as_ref();
        debug_trace!(
            "Claiming achievement payload (len={}): {:?}",
            raw_slice.len(),
            raw_slice
        );

        let mut already_present = false;
        for idx in 0..profile_data.len() {
            if let Some(existing) = profile_data.get(idx) {
                if existing.raw_data().as_ref() == raw_slice {
                    already_present = true;
                    break;
                }
            }
        }

        let mut profile_data_builder = profile_data.as_builder();
        if !already_present {
            let mut encoded = Vec::with_capacity(4 + raw_slice.len());
            encoded.extend_from_slice(&(raw_slice.len() as u32).to_le_bytes());
            encoded.extend_from_slice(raw_slice);
            let achievement_bytes =
                Bytes::from_slice(&encoded).map_err(|_| Error::InvalidUserData)?;
            profile_data_builder = profile_data_builder.push(achievement_bytes);
        } else {
            debug_trace!("Achievement already present; skipping duplicate append");
        }

        let updated_user_data = current_user_data
            .as_builder()
            .profile_data(profile_data_builder.build())
            .build();

        let new_user_output = CellOutputBuilder::default()
            .type_(
                ScriptOptBuilder::default()
                    .set(Some(current_script.clone()))
                    .build(),
            )
            .lock(current_user_cell.lock())
            .capacity(0u64.pack())
            .build();
        cell_output_vec_builder = cell_output_vec_builder.push(new_user_output);

        outputs_data_builder = outputs_data_builder.push(updated_user_data.as_bytes().pack());

        let output_data_index = tx
            .as_ref()
            .map(|t| t.raw().outputs_data().len())
            .unwrap_or(0) as u32;

        let recipe = create_recipe_with_args(
            "CKBoostAchievement.claim_achievement",
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
}
