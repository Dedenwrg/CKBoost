use alloc::vec::Vec;
use ckb_std::{
    ckb_constants::Source,
    ckb_types::{bytes::Bytes, prelude::*},
    debug,
    high_level::{
        load_cell_data, load_cell_lock_hash, load_cell_type, load_cell_type_hash, load_script,
        QueryIter,
    },
};
use ckboost_shared::{
    protocol_data::check_admin,
    types::{Byte32Vec, CampaignData, ConnectedTypeID, ProtocolData},
    Error,
};
use core::result::Result;

const UDT_AMOUNT_SIZE: usize = 16;

/// Check if this is a minting operation by comparing input and output amounts
pub fn is_minting_operation() -> Result<bool, Error> {
    // Calculate total input UDT amount
    let mut input_amount: u128 = 0;
    let udt_script = load_script().map_err(|_| {
        debug!("Failed to load UDT script for is_minting_operation");
        Error::ItemMissing
    })?;
    let script_hash = udt_script.calc_script_hash();

    // Iterate through all inputs to find UDT cells
    let input_udt_cells = QueryIter::new(load_cell_type_hash, Source::Input)
        .enumerate()
        .filter_map(|(index, type_hash)| {
            type_hash.and_then(|h| {
                if h.as_slice() == script_hash.as_slice() {
                    load_cell_data(index, Source::Input).ok()
                } else {
                    None
                }
            })
        });

    for data in input_udt_cells {
        input_amount = input_amount
            .checked_add(read_udt_amount(&data)?)
            .ok_or(Error::InvalidUDTAmount)?;
    }

    // Calculate total output UDT amount
    let mut output_amount: u128 = 0;
    let output_udt_cells = QueryIter::new(load_cell_type_hash, Source::Output)
        .enumerate()
        .filter_map(|(index, type_hash)| {
            type_hash.and_then(|h| {
                if h.as_slice() == script_hash.as_slice() {
                    load_cell_data(index, Source::Output).ok()
                } else {
                    None
                }
            })
        });

    for data in output_udt_cells {
        output_amount = output_amount
            .checked_add(read_udt_amount(&data)?)
            .ok_or(Error::InvalidUDTAmount)?;
    }

    debug!(
        "UDT amounts - Input: {}, Output: {}",
        input_amount, output_amount
    );

    // If output > input, it's a minting operation
    Ok(output_amount > input_amount)
}

/// Validate protocol owner mode for minting operations
/// Requires:
/// 1. Protocol cell in CellDeps
/// 2. All input cells with connected type id matching the protocol type hash
pub fn validate_protocol_owner_mode(protocol_type_hash: &[u8]) -> Result<(), Error> {
    debug!("Validating protocol owner mode");

    // 1. Verify protocol cell exists in CellDeps
    let protocol_data = get_protocol_data_from_cell_deps(protocol_type_hash)?;

    match check_admin(&protocol_data) {
        Ok(true) => {
            debug!("Admin found in inputs. Short-circuiting validation.");
            return Ok(());
        }
        Ok(false) => {
            debug!("Admin not found in inputs. Continuing validation.");
        }
        Err(_) => {
            debug!("Error checking admin.");
            return Err(Error::UnauthorizedOperation);
        }
    }

    let mut index = 0;
    let mut connection_found = false;
    loop {
        match load_cell_type(index, Source::Input) {
            Ok(Some(type_script)) => {
                let args: Bytes = type_script.clone().args().unpack();
                if args.len() == 76 {
                    let connected_type_id = ConnectedTypeID::from_slice(&args)
                        .map_err(|_| Error::InvalidConnectedTypeId)?;
                    if connected_type_id.connected_key().as_slice() == protocol_type_hash {
                        let type_code_hash = type_script.code_hash();
                        let tipping_code_hash = protocol_data
                            .protocol_config()
                            .script_code_hashes()
                            .ckb_boost_tipping_type_code_hash();
                        let campaign_code_hash = protocol_data
                            .protocol_config()
                            .script_code_hashes()
                            .ckb_boost_campaign_type_code_hash();
                        if type_code_hash.as_slice() == tipping_code_hash.as_slice() {
                            connection_found = true;
                            // Points amount is validated by the tipping type script
                        } else if type_code_hash.as_slice() == campaign_code_hash.as_slice() {
                            connection_found = true;
                            validate_points_amount_in_quest_completion(index, Source::Input)?;
                        } else {
                            debug!(
                                "Connected type code hash does not match protocol type code hash"
                            );
                            return Err(Error::InvalidConnectedTypeId);
                        }
                    }
                }
            }
            Ok(None) => {}
            Err(_) => break,
        }
        index += 1;
    }
    if !connection_found {
        debug!("No connection found in inputs nor authorized by admin");
        return Err(Error::UnauthorizedOperation);
    } else {
        debug!("Connection found in inputs. Yielding validation.");
        return Ok(());
    }
}

fn validate_points_amount_in_quest_completion(index: usize, source: Source) -> Result<(), Error> {
    debug!("Validating points amount in quest completion");

    // Load input campaign cell data
    let input_campaign_cell_data = load_cell_data(index, source)?;
    let input_campaign_data = CampaignData::from_slice(&input_campaign_cell_data)
        .map_err(|_| Error::InvalidCampaignData)?;
    let input_campaign_type_hash = load_cell_type_hash(index, source)
        .map_err(|e| {
            debug!(
                "Error loading cell type hash: {:?} in validate_points_amount_in_quest_completion",
                e
            );
            Error::ItemMissing
        })?
        .ok_or_else(|| Error::ItemMissing)?;

    // Get the lock hash of the input campaign cell to find matching output
    let input_lock_hash = load_cell_lock_hash(index, source)?;

    // 1. Find output campaign cell with the same type hash
    let mut output_index = 0;
    let mut output_campaign_data: Option<CampaignData> = None;
    loop {
        match load_cell_type_hash(output_index, Source::Output) {
            Ok(Some(type_hash)) if type_hash.as_slice() == input_campaign_type_hash.as_slice() => {
                // Found matching campaign cell, verify it's the same one by checking lock hash
                let output_lock_hash = load_cell_lock_hash(output_index, Source::Output)?;
                if output_lock_hash.as_slice() == input_lock_hash.as_slice() {
                    let output_data = load_cell_data(output_index, Source::Output)?;
                    output_campaign_data = Some(
                        CampaignData::from_slice(&output_data)
                            .map_err(|_| Error::InvalidCampaignData)?,
                    );
                    debug!(
                        "Found matching output campaign cell at index {}",
                        output_index
                    );
                    break;
                }
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => break,
            _ => {}
        }
        output_index += 1;
    }

    let output_campaign_data = output_campaign_data.ok_or_else(|| {
        debug!("No matching output campaign cell found");
        Error::CampaignCellNotFound
    })?;

    // 2. Compare the accepted_submission_user_type_ids of each quest to find the
    // quest receiving newly approved users and collect the exact newly-approved ids.
    let input_quests = input_campaign_data.quests();
    let output_quests = output_campaign_data.quests();
    if input_quests.len() != output_quests.len() {
        debug!(
            "Quest count changed during approve completion: {} -> {}",
            input_quests.len(),
            output_quests.len()
        );
        return Err(Error::InvalidQuestStatus);
    }

    let mut completed_quest: Option<(usize, u128, Vec<[u8; 32]>)> = None;

    for i in 0..input_quests.len() {
        let input_quest = input_quests.get(i).ok_or_else(|| {
            debug!("Failed to get input quest at index {}", i);
            Error::InvalidQuestData
        })?;
        let output_quest = output_quests.get(i).ok_or_else(|| {
            debug!("Failed to get output quest at index {}", i);
            Error::InvalidQuestData
        })?;

        if input_quest.quest_id().as_slice() != output_quest.quest_id().as_slice() {
            debug!("Quest ID changed at index {}", i);
            return Err(Error::InvalidQuestStatus);
        }

        let output_accepted = output_quest.accepted_submission_user_type_ids();
        let input_accepted = input_quest.accepted_submission_user_type_ids();

        if byte32_vec_has_duplicates(&input_accepted)?
            || byte32_vec_has_duplicates(&output_accepted)?
        {
            debug!("Accepted submission user list contains duplicate entries");
            return Err(Error::InvalidQuestStatus);
        }

        for j in 0..input_accepted.len() {
            let input_user = input_accepted.get(j).ok_or_else(|| {
                debug!("Failed to get input accepted user type ID at index {}", j);
                Error::InvalidUserData
            })?;
            if !byte32_vec_contains(&output_accepted, input_user.as_slice())? {
                debug!("Previously accepted user was removed during approve completion");
                return Err(Error::InvalidQuestStatus);
            }
        }

        let mut newly_approved = Vec::new();
        for j in 0..output_accepted.len() {
            let output_user = output_accepted.get(j).ok_or_else(|| {
                debug!("Failed to get output accepted user type ID at index {}", j);
                Error::InvalidUserData
            })?;
            let mut found_in_input = false;
            for k in 0..input_accepted.len() {
                let input_user = input_accepted.get(k).ok_or_else(|| {
                    debug!("Failed to get input accepted user type ID at index {}", k);
                    Error::InvalidUserData
                })?;
                if input_user.as_slice() == output_user.as_slice() {
                    found_in_input = true;
                    break;
                }
            }
            if !found_in_input {
                let mut user_type_id = [0u8; 32];
                user_type_id.copy_from_slice(output_user.as_slice());
                newly_approved.push(user_type_id);
            }
        }

        if !newly_approved.is_empty() {
            if input_quest.points().as_slice() != output_quest.points().as_slice() {
                debug!("Quest points changed while approving completion");
                return Err(Error::InvalidQuestStatus);
            }
            let points_bytes: [u8; 16] = output_quest
                .points()
                .as_slice()
                .try_into()
                .map_err(|_| Error::InvalidQuestData)?;
            let points = u128::from_le_bytes(points_bytes);
            if completed_quest.is_some() {
                debug!("More than one quest changed during approve completion");
                return Err(Error::InvalidQuestStatus);
            }
            completed_quest = Some((i, points, newly_approved));
            debug!(
                "Found completed quest at index {} with {} points",
                i, points
            );
        }
    }

    let (_quest_index, quest_points, newly_approved_user_ids) =
        completed_quest.ok_or_else(|| {
            debug!("No quest completion detected");
            Error::InvalidQuestStatus
        })?;
    let expected_mint = quest_points
        .checked_mul(newly_approved_user_ids.len() as u128)
        .ok_or(Error::InvalidUDTAmount)?;

    let udt_script = load_script().map_err(|_| {
        debug!("Failed to load UDT script for validate_points_amount_in_quest_completion");
        Error::ItemMissing
    })?;
    let script_hash = udt_script.calc_script_hash();

    let mut input_total = 0u128;
    let input_udt_cells = QueryIter::new(load_cell_type_hash, Source::Input)
        .enumerate()
        .filter_map(|(cell_index, type_hash)| {
            type_hash.and_then(|hash| {
                if hash.as_slice() == script_hash.as_slice() {
                    load_cell_data(cell_index, Source::Input).ok()
                } else {
                    None
                }
            })
        });
    for data in input_udt_cells {
        input_total = input_total
            .checked_add(read_udt_amount(&data)?)
            .ok_or(Error::InvalidUDTAmount)?;
    }

    let mut output_total = 0u128;
    let output_udt_cells = QueryIter::new(load_cell_type_hash, Source::Output)
        .enumerate()
        .filter_map(|(cell_index, type_hash)| {
            type_hash.and_then(|hash| {
                if hash.as_slice() == script_hash.as_slice() {
                    load_cell_data(cell_index, Source::Output).ok()
                } else {
                    None
                }
            })
        });
    for data in output_udt_cells {
        output_total = output_total
            .checked_add(read_udt_amount(&data)?)
            .ok_or(Error::InvalidUDTAmount)?;
    }

    let minted_amount = output_total
        .checked_sub(input_total)
        .ok_or(Error::InvalidUDTAmount)?;
    if minted_amount != expected_mint {
        debug!(
            "Points mint delta mismatch: minted {}, expected {}",
            minted_amount, expected_mint
        );
        return Err(Error::InvalidUDTAmount);
    }

    debug!("Quest completion mint validation successful");
    Ok(())
}

fn byte32_vec_contains(items: &Byte32Vec, needle: &[u8]) -> Result<bool, Error> {
    for i in 0..items.len() {
        let item = items.get(i).ok_or_else(|| {
            debug!("Failed to get Byte32 item at index {}", i);
            Error::InvalidUserData
        })?;
        if item.as_slice() == needle {
            return Ok(true);
        }
    }
    Ok(false)
}

fn byte32_vec_has_duplicates(items: &Byte32Vec) -> Result<bool, Error> {
    for i in 0..items.len() {
        let item = items.get(i).ok_or_else(|| {
            debug!("Failed to get Byte32 item at index {}", i);
            Error::InvalidUserData
        })?;
        for j in (i + 1)..items.len() {
            let other = items.get(j).ok_or_else(|| {
                debug!("Failed to get Byte32 item at index {}", j);
                Error::InvalidUserData
            })?;
            if item.as_slice() == other.as_slice() {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

fn read_udt_amount(data: &[u8]) -> Result<u128, Error> {
    if data.len() < UDT_AMOUNT_SIZE {
        debug!("UDT data is shorter than 16-byte amount");
        return Err(Error::InvalidUDTAmount);
    }
    let mut amount_bytes = [0u8; UDT_AMOUNT_SIZE];
    amount_bytes.copy_from_slice(&data[..UDT_AMOUNT_SIZE]);
    Ok(u128::from_le_bytes(amount_bytes))
}

/// Find protocol cell in CellDeps
fn get_protocol_data_from_cell_deps(protocol_type_hash: &[u8]) -> Result<ProtocolData, Error> {
    let mut index = 0;
    loop {
        match load_cell_type_hash(index, Source::CellDep) {
            Ok(Some(type_hash)) if type_hash.as_slice() == protocol_type_hash => {
                debug!("Found protocol cell in CellDeps at index {}", index);
                let data = load_cell_data(index, Source::CellDep)?;
                match ProtocolData::from_slice(&data) {
                    Ok(protocol_data) => {
                        debug!("Loaded protocol data from CellDeps at index {}", index);
                        return Ok(protocol_data);
                    }
                    Err(_) => {
                        debug!(
                            "Failed to parse protocol data from CellDeps at index {}",
                            index
                        );
                        return Err(Error::ProtocolDataInvalid);
                    }
                }
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => break,
            _ => {}
        }
        index += 1;
    }

    debug!("No protocol cell found in CellDeps");
    Err(Error::ProtocolDataInvalid)
}
/// Validate standard UDT rules (balance checks)
pub fn validate_udt_rules() -> Result<(), Error> {
    // Standard UDT validation: sum of inputs >= sum of outputs (except for minting)
    let mut input_amount: u128 = 0;
    let mut output_amount: u128 = 0;
    let udt_script = load_script().map_err(|_| {
        debug!("Failed to load UDT script for validate_udt_rules");
        Error::ItemMissing
    })?;

    // Calculate input amount
    let mut index = 0;
    loop {
        match load_cell_type_hash(index, Source::Input) {
            Ok(Some(type_hash)) => {
                let script_hash = udt_script.calc_script_hash();
                if type_hash.as_slice() == script_hash.as_slice() {
                    let data = load_cell_data(index, Source::Input).map_err(|_| {
                        debug!("Failed to load cell data for validate_udt_rules");
                        Error::ItemMissing
                    })?;
                    input_amount = input_amount
                        .checked_add(read_udt_amount(&data)?)
                        .ok_or(Error::InvalidUDTAmount)?;
                }
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => break,
            _ => {}
        }
        index += 1;
    }

    // Calculate output amount
    index = 0;
    loop {
        match load_cell_type_hash(index, Source::Output) {
            Ok(Some(type_hash)) => {
                let script_hash = udt_script.calc_script_hash();
                if type_hash.as_slice() == script_hash.as_slice() {
                    let data = load_cell_data(index, Source::Output).map_err(|_| {
                        debug!("Failed to load cell data for validate_udt_rules");
                        Error::ItemMissing
                    })?;
                    output_amount = output_amount
                        .checked_add(read_udt_amount(&data)?)
                        .ok_or(Error::InvalidUDTAmount)?;
                }
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => break,
            _ => {}
        }
        index += 1;
    }

    // For minting, the check is already done in validate_protocol_owner_mode
    // For transfers, input must be >= output
    if !is_minting_operation()? && input_amount < output_amount {
        debug!(
            "UDT rule violation: input {} < output {}",
            input_amount, output_amount
        );
        return Err(Error::InvalidUDTAmount);
    }

    Ok(())
}
