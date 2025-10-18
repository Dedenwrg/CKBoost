use alloc::{vec, vec::Vec};
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
}
