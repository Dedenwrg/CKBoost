// cspell:ignore celldeps udts
pub use crate::generated::ckboost::{
    Byte32, Byte32Vec, ProtocolData, Script, ScriptCodeHashes, ScriptVec,
};
use crate::{types::ConnectedTypeID, Error};
use alloc::vec::Vec;
use ckb_deterministic::debug_trace;
use ckb_ssri_std::utils::high_level::{find_cell_data_by_out_point, find_out_point_by_type};
use ckb_std::{
    ckb_constants::Source,
    ckb_types::prelude::*,
    high_level::{
        load_cell_data, load_cell_lock, load_cell_type, load_cell_type_hash, load_script,
    },
};
use molecule::prelude::*;

/// Extension trait for ProtocolData with helper methods for cell classification
pub trait ProtocolDataExt {
    /// Create protocol data from actual protocol cell
    /// This function will:
    /// 1. First check CellDeps for protocol cells (normal read operations) - tries to parse any cell with type script as ProtocolData
    /// 2. If not found and we're in a script context, check Outputs for cells with the same type script as the current script
    ///
    /// The second step handles protocol creation/update scenarios where:
    /// - We're executing in the protocol type script
    /// - No protocol cell exists in CellDeps
    /// - The protocol cell is being created or updated in Outputs
    ///
    /// Since protocol cells have restricted locks (only protocol manager can unlock),
    /// we don't need to check inputs - we can directly check outputs.
    fn from_protocol_cell() -> Result<ProtocolData, Error> {
        debug_trace!("Loading protocol data from protocol cell");

        // Get the current script to extract the connected_key from args
        match load_script() {
            Ok(current_script) => {
                let args = current_script.args();
                debug_trace!("Current script args length: {}", args.len());

                use crate::generated::ckboost::ConnectedTypeID;
                let args_raw_data = args.raw_data();
                debug_trace!("Script args length: {} bytes", args_raw_data.len());

                debug_trace!("Script args: {:?}", args);

                match &args_raw_data.len() {
                    76 => match ConnectedTypeID::from_slice(&args_raw_data) {
                        Ok(connected_type_id) => {
                            debug_trace!("Successfully parsed args as ConnectedTypeID");
                            let connected_hash = connected_type_id.connected_key();
                            let mut connected_hash_u832 = [0u8; 32];
                            connected_hash_u832.copy_from_slice(&connected_hash.raw_data());
                            debug_trace!(
                                "Connected hash: {:?}. This could either be the protocol cell or the campaign/tipping cell",
                                connected_hash_u832
                            );

                            match find_bounded_protocol_cell_for_data(
                                connected_hash_u832,
                                Source::CellDep,
                            ) {
                                Ok(protocol_data) => {
                                    debug_trace!("Successfully loaded protocol data starting from Protocol cell in CellDep");
                                    return Ok(protocol_data);
                                }
                                Err(e) => {
                                    debug_trace!("Failed to load protocol data starting from bounded cell in Output: {:?}. Try to find the protocol cell in Outputs for recipe update_protocol", e);
                                    match find_bounded_protocol_cell_for_data(
                                        connected_hash_u832,
                                        Source::Output,
                                    ) {
                                        Ok(protocol_data) => {
                                            debug_trace!(
                                                "Successfully loaded protocol data from Output"
                                            );
                                            return Ok(protocol_data);
                                        }
                                        Err(e) => {
                                            debug_trace!(
                                                "Failed to load protocol data from Output: {:?}",
                                                e
                                            );
                                            return Err(crate::error::Error::ProtocolDataInvalid);
                                        }
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            debug_trace!("Failed to parse args as ConnectedTypeID: {:?}", e);
                        }
                    },
                    32 => {
                        debug_trace!("Successfully parsed args as Byte32");
                        let mut args_u832 = [0u8; 32];
                        args_u832.copy_from_slice(&args_raw_data);
                        debug_trace!(
                            "Check if the current script is protocol type or funding lock"
                        );
                        match load_cell_lock(0, Source::GroupInput) {
                            Ok(_lock) => {
                                debug_trace!(
                                    "Current script is protocol type or funding lock in Input."
                                );
                                match load_cell_data(0, Source::GroupInput) {
                                    Ok(data) => match ProtocolData::from_slice(&data) {
                                        Ok(protocol_data) => {
                                            debug_trace!(
                                                "Successfully loaded protocol data from Input"
                                            );
                                            return Ok(protocol_data);
                                        }
                                        Err(e) => {
                                            debug_trace!("Failed to parse data as protocol data. This should be funding lock: {:?}. Try to find the bounded tipping/campaign cell in Outputs", e);
                                            match find_bounded_protocol_cell_for_data(
                                                args_u832,
                                                Source::Output,
                                            ) {
                                                Ok(protocol_data) => {
                                                    debug_trace!(
                                                            "Successfully loaded protocol data from Output"
                                                        );
                                                    return Ok(protocol_data);
                                                }
                                                Err(e) => {
                                                    debug_trace!(
                                                            "Failed to load protocol data from Output: {:?}. Could be tipping funding cell bounded to protocol cell in CellDep",
                                                            e
                                                        );
                                                    match find_bounded_protocol_cell_for_data(
                                                        args_u832,
                                                        Source::CellDep,
                                                    ) {
                                                        Ok(protocol_data) => {
                                                            return Ok(protocol_data);
                                                        }
                                                        Err(e) => {
                                                            debug_trace!(
                                                                "Failed to load protocol data from CellDep: {:?}",
                                                                e
                                                            );
                                                        }
                                                    }
                                                    return Err(
                                                        crate::error::Error::ProtocolDataInvalid,
                                                    );
                                                }
                                            }
                                        }
                                    },
                                    Err(e) => {
                                        debug_trace!(
                                            "Failed to load protocol data from Input: {:?}",
                                            e
                                        );
                                        return Err(crate::error::Error::ProtocolDataInvalid);
                                    }
                                }
                            }
                            Err(e) => {
                                debug_trace!("Current script is not funding lock: {:?}. It should be the protocol cell in Outputs", e);
                                match load_cell_data(0, Source::GroupOutput) {
                                    Ok(data) => match ProtocolData::from_slice(&data) {
                                        Ok(protocol_data) => {
                                            debug_trace!(
                                                "Successfully loaded protocol data from Output"
                                            );
                                            return Ok(protocol_data);
                                        }
                                        Err(e) => {
                                            debug_trace!(
                                                "Failed to parse data as protocol data: {:?}",
                                                e
                                            );
                                            return Err(crate::error::Error::ProtocolDataInvalid);
                                        }
                                    },
                                    Err(e) => {
                                        debug_trace!(
                                            "Failed to load protocol data from Output: {:?}",
                                            e
                                        );
                                        return Err(crate::error::Error::ProtocolDataInvalid);
                                    }
                                }
                            }
                        }
                    }
                    _ => {
                        debug_trace!("Args is invalid");
                        return Err(crate::error::Error::ProtocolDataInvalid);
                    }
                }
            }
            Err(_) => {
                debug_trace!(
                    "Not in script context or unable to load script, cannot check outputs"
                );
                return Err(crate::error::Error::ProtocolCellNotFound);
            }
        }
        // No protocol cell found anywhere
        Err(crate::error::Error::ProtocolCellNotFound)
    }

    /// Get protocol type code hash
    fn protocol_type_code_hash(&self) -> [u8; 32];

    /// Get campaign type code hash
    fn campaign_type_code_hash(&self) -> [u8; 32];

    /// Get user type code hash
    fn user_type_code_hash(&self) -> [u8; 32];

    /// Get points type code hash
    fn points_udt_type_code_hash(&self) -> [u8; 32];

    /// Get tipping type code hash
    fn tipping_type_code_hash(&self) -> [u8; 32];

    /// Get achievements type code hash
    fn achievements_type_code_hash(&self) -> [u8; 32];

    /// Get accepted UDT type scripts
    fn accepted_udt_type_scripts(&self) -> Vec<Script>;

    /// Get accepted DOB (Digital Object) type scripts
    fn accepted_dob_type_scripts(&self) -> Vec<Script>;

    /// Check if all required type hashes are present
    fn validate_protocol(&self) -> Result<(), crate::error::Error>;
}

impl ProtocolDataExt for ProtocolData {
    /// Get protocol type code hash
    fn protocol_type_code_hash(&self) -> [u8; 32] {
        let hash = self
            .protocol_config()
            .script_code_hashes()
            .ckb_boost_protocol_type_code_hash();
        let mut result = [0u8; 32];
        result.copy_from_slice(hash.as_slice());
        result
    }

    /// Get campaign type code hash
    fn campaign_type_code_hash(&self) -> [u8; 32] {
        let hash = self
            .protocol_config()
            .script_code_hashes()
            .ckb_boost_campaign_type_code_hash();
        let mut result = [0u8; 32];
        result.copy_from_slice(hash.as_slice());
        result
    }

    /// Get user type code hash
    fn user_type_code_hash(&self) -> [u8; 32] {
        let hash = self
            .protocol_config()
            .script_code_hashes()
            .ckb_boost_user_type_code_hash();
        let mut result = [0u8; 32];
        result.copy_from_slice(hash.as_slice());
        result
    }

    /// Get points type code hash
    fn points_udt_type_code_hash(&self) -> [u8; 32] {
        let hash = self
            .protocol_config()
            .script_code_hashes()
            .ckb_boost_points_udt_type_code_hash();
        let mut result = [0u8; 32];
        result.copy_from_slice(hash.as_slice());
        result
    }

    /// Get tipping type code hash
    fn tipping_type_code_hash(&self) -> [u8; 32] {
        let hash = self
            .protocol_config()
            .script_code_hashes()
            .ckb_boost_tipping_type_code_hash();
        let mut result = [0u8; 32];
        result.copy_from_slice(hash.as_slice());
        result
    }

    /// Get achievements type code hash
    fn achievements_type_code_hash(&self) -> [u8; 32] {
        let hash = self
            .protocol_config()
            .script_code_hashes()
            .ckb_boost_achievements_type_code_hash();
        let mut result = [0u8; 32];
        result.copy_from_slice(hash.as_slice());
        result
    }

    /// Get accepted UDT type scripts
    fn accepted_udt_type_scripts(&self) -> Vec<Script> {
        let scripts = self
            .protocol_config()
            .script_code_hashes()
            .accepted_udt_type_scripts();

        let mut result = Vec::new();
        for i in 0..scripts.len() {
            let script = scripts.get(i).unwrap();
            result.push(script);
        }
        result
    }

    /// Get accepted DOB (Digital Object) type scripts
    fn accepted_dob_type_scripts(&self) -> Vec<Script> {
        let scripts = self
            .protocol_config()
            .script_code_hashes()
            .accepted_dob_type_scripts();

        let mut result = Vec::new();
        for i in 0..scripts.len() {
            let script = scripts.get(i).unwrap();
            result.push(script);
        }
        result
    }

    /// Check if all required type hashes are present
    fn validate_protocol(&self) -> Result<(), crate::error::Error> {
        // Protocol, campaign, and user type hashes are always required
        // They come from the generated structure, so they're always valid
        Ok(())
    }
}

/// Get protocol data from the transaction
///
/// This function searches for protocol cells in the following order:
/// 1. **CellDeps** - Tries to parse any cell with type script as ProtocolData (works in any context)
/// 2. **Outputs** - When in script context, looks for cells with the same type script as current script
///
/// The second step handles protocol creation/update scenarios:
/// - When executing in protocol type script (creation or update)
/// - No protocol cell exists in CellDeps
/// - The protocol cell is in Outputs with the protocol type script
///
/// Since protocol cells have restricted locks that only the protocol manager can unlock,
/// we don't need to distinguish between creation and update - we simply check outputs.
///
/// # Returns
/// - `Ok(ProtocolData)` - Successfully loaded protocol data from a cell
/// - `Err(ProtocolCellNotFound)` - No protocol cell found
pub fn get_protocol_data() -> Result<ProtocolData, crate::error::Error> {
    ProtocolData::from_protocol_cell()
}

/// Get protocol data using SSRI pattern
///
/// This function is designed for SSRI-based transaction generation where we have a protocol
/// type script and need to load its data directly from the blockchain state.
///
/// In SSRI mode:
/// - We're generating transactions, not verifying them
/// - We can directly query blockchain state using SSRI functions
/// - No need to check transaction inputs/outputs/celldeps
///
/// # Arguments
/// * `protocol_type_script` - The type script of the protocol cell
///
/// # Returns
/// - `Ok(ProtocolData)` - Successfully loaded protocol data from the blockchain
/// - `Err(ProtocolCellNotFound)` - No protocol cell found with the given type script
/// - `Err(ProtocolDataInvalid)` - Protocol cell found but data is malformed
pub fn get_protocol_data_ssri(
    protocol_type_script: ckb_std::ckb_types::packed::Script,
) -> Result<ProtocolData, crate::error::Error> {
    debug_trace!("Loading protocol data using SSRI pattern");

    // In SSRI mode, we use find_out_point_by_type to locate the protocol cell
    match find_out_point_by_type(protocol_type_script) {
        Ok(out_point) => {
            debug_trace!("Found protocol cell outpoint: {:?}", out_point);

            // Load the cell data directly using the outpoint
            // In SSRI, find_cell_data_by_out_point returns the actual cell data
            match find_cell_data_by_out_point(out_point) {
                Ok(data) => {
                    debug_trace!("Found protocol cell data");

                    // Parse the data as ProtocolData
                    match ProtocolData::from_slice(&data) {
                        Ok(protocol_data) => {
                            debug_trace!("Successfully loaded protocol data via SSRI");
                            Ok(protocol_data)
                        }
                        Err(e) => {
                            debug_trace!("Failed to parse protocol data: {:?}", e);
                            Err(crate::error::Error::ProtocolDataInvalid)
                        }
                    }
                }
                Err(e) => {
                    debug_trace!("Failed to find cell by outpoint: {:?}", e);
                    Err(crate::error::Error::ProtocolCellNotFound)
                }
            }
        }
        Err(e) => {
            debug_trace!("Failed to find protocol cell by type: {:?}", e);
            Err(crate::error::Error::ProtocolCellNotFound)
        }
    }
}

fn find_bounded_protocol_cell_for_data(
    args_u832: [u8; 32],
    starting_source: Source,
) -> Result<ProtocolData, crate::error::Error> {
    let mut index = 0;
    loop {
        match load_cell_type_hash(index, starting_source) {
            Ok(type_hash_opt) => {
                match type_hash_opt {
                    Some(type_hash) => {
                        if type_hash == args_u832 {
                            debug_trace!(
                                "Found bounded cell in {:?} at index {}",
                                starting_source,
                                index
                            );
                            debug_trace!("Check args of the bounded cell and check length");
                            let bounded_cell_script = load_cell_type(index, starting_source)?;
                            if bounded_cell_script.is_none() {
                                debug_trace!("Bounded cell has no type script args");
                                return Err(crate::error::Error::ProtocolCellNotFound);
                            }
                            let args = bounded_cell_script.unwrap().args();
                            match args.len() {
                                32 => {
                                    debug_trace!("Args is Byte32. Should be the protocol cell");
                                    let data = load_cell_data(index, starting_source).unwrap();
                                    // Try to parse the data as ProtocolData
                                    match ProtocolData::from_slice(&data) {
                                        Ok(protocol_data) => {
                                            debug_trace!(
                                                "Successfully loaded protocol data from {:?}",
                                                starting_source
                                            );
                                            return Ok(protocol_data);
                                        }
                                        Err(e) => {
                                            debug_trace!(
                                                "Failed to parse data as protocol data: {:?}",
                                                e
                                            );
                                            return Err(crate::error::Error::ProtocolDataInvalid);
                                        }
                                    }
                                }
                                76 => {
                                    debug_trace!("Args could be ConnectedTypeID");
                                    match ConnectedTypeID::from_slice(&args.raw_data()) {
                                        Ok(connected_type_id) => {
                                            debug_trace!(
                                                "Successfully parsed args as ConnectedTypeID"
                                            );
                                            let connected_type_hash =
                                                connected_type_id.connected_key();
                                            let mut connected_type_hash_u832 = [0u8; 32];
                                            connected_type_hash_u832
                                                .copy_from_slice(&connected_type_hash.raw_data());
                                            debug_trace!("Connected type hash: {:?}. This should be the type hash of the protocol cell. Try to find the protocol cell in CellDeps", connected_type_hash);
                                            match find_bounded_protocol_cell_for_data(
                                                connected_type_hash_u832,
                                                Source::CellDep,
                                            ) {
                                                Ok(protocol_data) => {
                                                    debug_trace!("Successfully loaded protocol data from CellDep");
                                                    return Ok(protocol_data);
                                                }
                                                Err(e) => {
                                                    debug_trace!("Failed to load protocol data from CellDep: {:?}. Try to find the protocol cell in Outputs for recipe update_protocol", e);
                                                    match find_bounded_protocol_cell_for_data(
                                                        connected_type_hash_u832,
                                                        Source::Output,
                                                    ) {
                                                        Ok(protocol_data) => {
                                                            debug_trace!("Successfully loaded protocol data from Output");
                                                            return Ok(protocol_data);
                                                        }
                                                        Err(e) => {
                                                            debug_trace!("Failed to load protocol data from Output either: {:?}", e);
                                                            return Err(crate::error::Error::ProtocolDataInvalid);
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                        Err(e) => {
                                            debug_trace!(
                                                "Failed to parse args as ConnectedTypeID: {:?}",
                                                e
                                            );
                                            return Err(crate::error::Error::ProtocolCellNotFound);
                                        }
                                    };
                                }
                                _ => {
                                    debug_trace!("Unexpected args length. Should be 32 or 76");
                                    return Err(crate::error::Error::ProtocolCellNotFound);
                                }
                            }
                        } else {
                            debug_trace!("Bounded cell type hash is not the same as args at index {}. Continue to find the next cell", index);
                            debug_trace!("Bounded cell type hash: {:?}", args_u832);
                            debug_trace!("Args at index {}: {:?}", index, type_hash);
                            index += 1;
                            continue;
                        }
                    }
                    None => {
                        index += 1;
                        continue;
                    }
                }
            }
            Err(_) => {
                debug_trace!("Bounded cell not found in {:?}", starting_source);
                return Err(crate::error::Error::ProtocolCellNotFound);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use ckb_std::ckb_types::core::ScriptHashType;

    use super::*;
    use crate::{generated::ckboost::ProtocolConfig, types::Bytes};

    #[test]
    fn test_protocol_data_serialization() {
        // Create test protocol data
        let script_code_hashes = ScriptCodeHashes::new_builder()
            .ckb_boost_protocol_type_code_hash(Byte32::from([1u8; 32]))
            .ckb_boost_protocol_lock_code_hash(Byte32::from([11u8; 32]))
            .ckb_boost_campaign_type_code_hash(Byte32::from([2u8; 32]))
            .ckb_boost_funding_lock_code_hash(Byte32::from([12u8; 32]))
            .ckb_boost_user_type_code_hash(Byte32::from([3u8; 32]))
            .ckb_boost_achievements_type_code_hash(Byte32::from([4u8; 32]))
            .accepted_udt_type_scripts(ScriptVec::new_builder().build())
            .accepted_dob_type_scripts(ScriptVec::new_builder().build())
            .build();

        let protocol_config = ProtocolConfig::new_builder()
            .script_code_hashes(script_code_hashes)
            .build();

        let original_data = ProtocolData::new_builder()
            .protocol_config(protocol_config)
            .build();

        // Serialize to bytes
        let bytes = original_data.as_bytes();

        // Deserialize back
        let deserialized_data = ProtocolData::from_slice(&bytes).expect("Should deserialize");

        // Verify they match
        assert_eq!(
            original_data.protocol_type_code_hash(),
            deserialized_data.protocol_type_code_hash()
        );
        assert_eq!(
            original_data.campaign_type_code_hash(),
            deserialized_data.campaign_type_code_hash()
        );
        assert_eq!(
            original_data.user_type_code_hash(),
            deserialized_data.user_type_code_hash()
        );
    }

    #[test]
    fn test_protocol_data_validation() {
        // Create test protocol data with some accepted UDTs and DOBs
        let udt1_script = Script::new_builder()
            .code_hash(Byte32::from([10u8; 32]))
            .hash_type(ScriptHashType::Data)
            .args(Bytes::from(vec![1u8, 2u8, 3u8]))
            .build();
        let udt2_script = Script::new_builder()
            .code_hash(Byte32::from([20u8; 32]))
            .hash_type(ScriptHashType::Data)
            .args(Bytes::from(vec![4u8, 5u8, 6u8]))
            .build();
        let accepted_udts = ScriptVec::new_builder()
            .push(udt1_script)
            .push(udt2_script)
            .build();

        let dob1_script = Script::new_builder()
            .code_hash(Byte32::from([30u8; 32]))
            .hash_type(ScriptHashType::Data)
            .args(Bytes::from(vec![7u8, 8u8, 9u8]))
            .build();
        let accepted_dobs = ScriptVec::new_builder().push(dob1_script).build();

        let script_code_hashes = ScriptCodeHashes::new_builder()
            .ckb_boost_protocol_type_code_hash(Byte32::from([1u8; 32]))
            .ckb_boost_protocol_lock_code_hash(Byte32::from([11u8; 32]))
            .ckb_boost_campaign_type_code_hash(Byte32::from([2u8; 32]))
            .ckb_boost_funding_lock_code_hash(Byte32::from([12u8; 32]))
            .ckb_boost_user_type_code_hash(Byte32::from([3u8; 32]))
            .accepted_udt_type_scripts(accepted_udts)
            .accepted_dob_type_scripts(accepted_dobs)
            .build();

        let protocol_config = ProtocolConfig::new_builder()
            .script_code_hashes(script_code_hashes)
            .build();

        let data = ProtocolData::new_builder()
            .protocol_config(protocol_config)
            .build();

        // Validate protocol should succeed
        assert!(data.validate_protocol().is_ok());

        // Test accepted UDTs
        let udts = data.accepted_udt_type_scripts();
        assert_eq!(udts.len(), 2);
        // Check first UDT script
        let udt1 = &udts[0];
        let mut expected_hash = [0u8; 32];
        expected_hash.copy_from_slice(&[10u8; 32]);
        assert_eq!(udt1.code_hash().as_slice(), &expected_hash);
        assert_eq!(udt1.hash_type().as_slice(), &[0u8]);
        assert_eq!(udt1.args().raw_data(), vec![1u8, 2u8, 3u8]);

        // Check second UDT script
        let udt2 = &udts[1];
        let mut expected_hash2 = [0u8; 32];
        expected_hash2.copy_from_slice(&[20u8; 32]);
        assert_eq!(udt2.code_hash().as_slice(), &expected_hash2);
        assert_eq!(udt2.hash_type().as_slice(), &[0u8]);
        assert_eq!(udt2.args().raw_data(), vec![4u8, 5u8, 6u8]);

        // Test accepted DOBs
        let dobs = data.accepted_dob_type_scripts();
        assert_eq!(dobs.len(), 1);
        let dob1 = &dobs[0];
        let mut expected_hash3 = [0u8; 32];
        expected_hash3.copy_from_slice(&[30u8; 32]);
        assert_eq!(dob1.code_hash().as_slice(), &expected_hash3);
        assert_eq!(dob1.hash_type().as_slice(), &[1u8]);
        assert_eq!(dob1.args().raw_data(), vec![7u8, 8u8, 9u8]);
    }
}
