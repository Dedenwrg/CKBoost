#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(test), no_main)]

#[cfg(any(feature = "library", test))]
extern crate alloc;

use alloc::borrow::Cow;
use ckb_deterministic::debug_trace;
use ckb_ssri_std::utils::should_fallback;
use ckb_ssri_std_proc_macro::ssri_methods;
use ckb_std::debug;
use ckb_std::high_level::load_script;
use ckb_std::syscalls::{pipe, write};
use ckboost_shared::type_id::validate_type_id;
use ckboost_shared::types::{AchievementDataVec, ConnectedTypeID, String};
use ckboost_shared::Error;
use molecule::prelude::Entity;

#[cfg(not(any(feature = "library", test)))]
ckb_std::entry!(program_entry);
#[cfg(not(any(feature = "library", test)))]
ckb_std::default_alloc!(16384, 1258306, 64);

pub mod fallback;
pub mod modules;
pub mod recipes;
pub mod ssri;

use crate::{fallback::fallback, ssri::CKBoostAchievement};

fn program_entry_wrap() -> Result<(), Error> {
    let argv = ckb_std::env::argv();

    if should_fallback()? {
        // # Validation Rules
        //
        // 1. **Type ID mechanism**: Ensures the campaign cell uses the correct type ID
        let args = load_script()?.args();
        debug_trace!("args: {:?}", args);
        let connected_type_id = ConnectedTypeID::from_slice(&args.raw_data())
            .map_err(|_| Error::InvalidConnectedTypeId)?;
        debug_trace!("connected_type_id: {:?}", connected_type_id);
        match validate_type_id(connected_type_id.type_id().into()) {
            Ok(_) => fallback()?,
            Err(err) => {
                debug_trace!("Contract execution failed with error: {:?}", err);
                return Err(err);
            }
        }
        return Ok(());
    }

    debug_trace!("Entering SSRI methods for CKBoost User");

    let res: Cow<'static, [u8]> = ssri_methods!(
        argv: &argv,
        invalid_method: Error::SSRIMethodsNotFound,
        invalid_args: Error::SSRIMethodsArgsInvalid,

        "CKBoostAchievement.update_achievement" => {
            debug_trace!("Entered CKBoostAchievement.update_achievement");

            let tx: Option<ckb_std::ckb_types::packed::Transaction> = if argv[1].is_empty()
                || argv[1].as_ref().to_str().map_err(|_| Error::Utf8Error)? == ""
            {
                None
            } else {
                let parsed_tx = ckb_std::ckb_types::packed::Transaction::from_compatible_slice(
                    &ckb_std::high_level::decode_hex(argv[1].as_ref())?,
                )
                .map_err(|_| Error::InvalidBaseTransactionForSSRI)?;
                Some(parsed_tx)
            };

            let achievement_vec_bytes = ckb_std::high_level::decode_hex(argv[2].as_ref())?;
            if achievement_vec_bytes.is_empty() {
                return Err(Error::SSRIMethodsArgsInvalid);
            }

            let achievement_vec = AchievementDataVec::from_slice(&achievement_vec_bytes)
                .map_err(|_| Error::InvalidAchievementData)?;

            let result_tx = crate::modules::CKBoostAchievementType::update_achievement(
                tx,
                achievement_vec,
            )?;
            Ok(Cow::from(result_tx.as_bytes().to_vec()))
        },

        "CKBoostAchievement.claim_achievement" => {
            debug_trace!("Entered CKBoostAchievement.claim_achievement");

            // Parse optional transaction (argv[1])
            let tx: Option<ckb_std::ckb_types::packed::Transaction> = if argv[1].is_empty() || argv[1].as_ref().to_str().map_err(|_| Error::Utf8Error)? == "" {
                None
            } else {
                let parsed_tx = ckb_std::ckb_types::packed::Transaction::from_compatible_slice(&ckb_std::high_level::decode_hex(argv[1].as_ref())?)
                    .map_err(|_| Error::InvalidBaseTransactionForSSRI)?;
                Some(parsed_tx)
            };

            // Call the claim_achievement method and return the transaction
            let result_tx = crate::modules::CKBoostAchievementType::claim_achievement(tx)?;
            Ok(Cow::from(result_tx.as_bytes().to_vec()))
        },
    )?;

    let pipe = pipe()?;
    write(pipe.1, &res)?;
    Ok(())
}

pub fn program_entry() -> i8 {
    match program_entry_wrap() {
        Ok(_) => 0,
        Err(err) => {
            debug_trace!("Contract execution failed with error: {:?}", err);
            err as i8
        }
    }
}
