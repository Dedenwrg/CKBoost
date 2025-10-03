#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(test), no_main)]

#[cfg(any(feature = "library", test))]
extern crate alloc;

use alloc::borrow::Cow;
use ckb_deterministic::{debug_info, debug_trace};
use ckb_ssri_std::utils::should_fallback;
use ckb_ssri_std_proc_macro::ssri_methods;
use ckb_std::syscalls::{pipe, write};
use ckb_std::{ckb_types::packed::Byte32Vec, high_level::load_script};
use ckboost_shared::type_id::validate_type_id;
use ckboost_shared::types::{Byte32 as SharedByte32, ConnectedTypeID, TippingProposalData};
use ckboost_shared::Error;
use molecule::prelude::Entity;

#[cfg(not(any(feature = "library", test)))]
ckb_std::entry!(program_entry);
#[cfg(not(any(feature = "library", test)))]
ckb_std::default_alloc!(16384, 1258306, 64);

#[cfg(not(feature = "library"))]
pub mod fallback;
#[cfg(not(feature = "library"))]
pub mod modules;
#[cfg(not(feature = "library"))]
pub mod recipes;
#[cfg(not(feature = "library"))]
pub mod ssri;

use crate::modules::CKBoostTippingType;
use crate::{fallback::fallback, ssri::CKBoostTipping};

fn program_entry_wrap() -> Result<(), Error> {
    let argv = ckb_std::env::argv();

    if should_fallback()? {
        debug_trace!("Should fallback!");
        // # Validation Rules
        //
        // 1. **Type ID mechanism**: Ensures the campaign cell uses the correct type ID
        debug_trace!("Loading script for validation");
        let script = load_script()?;
        debug_trace!("Script loaded successfully");

        let args = script.args();
        let args_raw = args.raw_data();
        debug_info!("Script args length: {} bytes", args_raw.len());
        debug_info!(
            "Script args hex: {:02x?}",
            &args_raw[..core::cmp::min(64, args_raw.len())]
        );

        // ConnectedTypeID should be exactly 64 bytes (32 bytes type_id + 32 bytes connected_key)
        if args_raw.len() != 76 {
            debug_info!(
                "ERROR: Invalid args length for ConnectedTypeID. Expected 76, got {}",
                args_raw.len()
            );
            return Err(Error::InvalidConnectedTypeId);
        }

        debug_trace!("Parsing ConnectedTypeID from args");
        let connected_type_id = match ConnectedTypeID::from_slice(&args_raw) {
            Ok(id) => {
                debug_trace!("Successfully parsed ConnectedTypeID");
                id
            }
            Err(e) => {
                debug_info!("ERROR: Failed to parse ConnectedTypeID: {:?}", e);
                return Err(Error::InvalidConnectedTypeId);
            }
        };

        debug_info!("Validating type_id");
        match validate_type_id(connected_type_id.type_id().into()) {
            Ok(_) => {
                debug_trace!("Type ID validation passed, calling fallback");
                fallback()?
            }
            Err(err) => {
                debug_trace!("Type ID validation failed with error: {:?}", err);
                return Err(err);
            }
        }
        return Ok(());
    }

    debug_trace!("Entering SSRI methods for CKBoost Campaign");

    let res: Cow<'static, [u8]> = ssri_methods!(
        argv: &argv,
        invalid_method: Error::SSRIMethodsNotFound,
        invalid_args: Error::SSRIMethodsArgsInvalid,

        "CKBoostProtocol.update_tipping_proposal" => {
            debug_trace!("Entered CKBoostProtocol.update_tipping_proposal");

            // Parse tipping_proposal_data from molecule serialized bytes
            let proposal_type_hash_bytes = decode_hex(argv[1].as_ref())?;
            let proposal_type_hash = SharedByte32::from_slice(&proposal_type_hash_bytes)
                .map_err(|_| Error::InvalidArgument)?;

            let proposal_data_bytes = decode_hex(argv[2].as_ref())?;
            let tipping_proposal_data = TippingProposalData::from_slice(&proposal_data_bytes)
                .map_err(|_| Error::MoleculeVerificationError)?;

            CKBoostTippingType::update_tipping_proposal(proposal_type_hash, tipping_proposal_data)?;
            Ok(Cow::from(b"success".to_vec()))
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
