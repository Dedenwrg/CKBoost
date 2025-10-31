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
    types::{CampaignData, ConnectedTypeID, ProtocolData},
    Error,
};
use core::result::Result;

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
        if data.len() >= 16 {
            let mut amount_bytes = [0u8; 16];
            amount_bytes.copy_from_slice(&data[0..16]);
            input_amount = input_amount.saturating_add(u128::from_le_bytes(amount_bytes));
        }
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
        if data.len() >= 16 {
            let mut amount_bytes = [0u8; 16];
            amount_bytes.copy_from_slice(&data[0..16]);
            output_amount = output_amount.saturating_add(u128::from_le_bytes(amount_bytes));
        }
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
        .map_err(|_| Error::ItemMissing)?
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

    // 2. Compare the length of accepted_submission_user_type_ids of each quest to see what quest is being completed
    let input_quests = input_campaign_data.quests();
    let output_quests = output_campaign_data.quests();

    let mut completed_quest: Option<(usize, u128)> = None; // (quest_index, points_amount)

    for i in 0..input_quests.len() {
        let input_quest = input_quests.get(i).ok_or_else(|| {
            debug!("Failed to get input quest at index {}", i);
            Error::InvalidQuestData
        })?;
        let output_quest = output_quests.get(i).ok_or_else(|| {
            debug!("Failed to get output quest at index {}", i);
            Error::InvalidQuestData
        })?;

        let input_accepted_len = input_quest.accepted_submission_user_type_ids().len();
        let output_accepted_len = output_quest.accepted_submission_user_type_ids().len();

        if output_accepted_len > input_accepted_len {
            // This quest has new accepted submissions
            // Convert Uint128 to u128
            let points_bytes: [u8; 16] = output_quest
                .points()
                .as_slice()
                .try_into()
                .map_err(|_| Error::InvalidQuestData)?;
            let points = u128::from_le_bytes(points_bytes);
            completed_quest = Some((i, points));
            debug!(
                "Found completed quest at index {} with {} points",
                i, points
            );
            break;
        }
    }

    let (quest_index, quest_points) = completed_quest.ok_or_else(|| {
        debug!("No quest completion detected");
        Error::InvalidQuestStatus
    })?;

    // 3. Get the points amount of the quest being completed (already extracted above)

    // 4. Find the matching user cell in the cell deps by lock script hash, and get its type ID
    let output_quest = output_quests.get(quest_index).ok_or_else(|| {
        debug!("Failed to get output quest at index {}", quest_index);
        Error::InvalidQuestData
    })?;
    let input_quest = input_quests.get(quest_index).ok_or_else(|| {
        debug!("Failed to get input quest at index {}", quest_index);
        Error::InvalidQuestData
    })?;

    // Find the newly added user type ID by comparing input and output accepted lists
    let mut new_user_type_id: Option<ckboost_shared::types::Byte32> = None;

    let output_accepted = output_quest.accepted_submission_user_type_ids();
    let input_accepted = input_quest.accepted_submission_user_type_ids();

    // Find the user type ID that's in output but not in input
    for i in 0..output_accepted.len() {
        let user_type_id = output_accepted.get(i).ok_or_else(|| {
            debug!("Failed to get output accepted user type ID at index {}", i);
            Error::InvalidUserData
        })?;
        let mut found_in_input = false;

        for j in 0..input_accepted.len() {
            let input_user_type_id = input_accepted.get(j).ok_or_else(|| {
                debug!("Failed to get input accepted user type ID at index {}", j);
                Error::InvalidUserData
            })?;
            if input_user_type_id.as_slice() == user_type_id.as_slice() {
                found_in_input = true;
                break;
            }
        }

        if !found_in_input {
            new_user_type_id = Some(user_type_id);
            debug!("Found newly added user type ID");
            break;
        }
    }

    let new_user_type_id = new_user_type_id.ok_or_else(|| {
        debug!("Could not find newly added user type ID");
        Error::InvalidUserData
    })?;

    // Now find the user cell in cell deps that matches this type ID
    let mut user_cell_lock_hash: Option<[u8; 32]> = None;
    let mut dep_index = 0;
    loop {
        match load_cell_type(dep_index, Source::CellDep) {
            Ok(Some(type_script)) => {
                let args: Bytes = type_script.args().unpack();
                if args.len() == 76 {
                    // Check if this is a user cell with matching type ID
                    match ConnectedTypeID::from_slice(&args) {
                        Ok(connected_type_id) => {
                            if connected_type_id.type_id().as_slice() == new_user_type_id.as_slice()
                            {
                                // Found the user cell, get its lock hash
                                let lock_hash = load_cell_lock_hash(dep_index, Source::CellDep)?;
                                user_cell_lock_hash = Some(lock_hash);
                                debug!("Found user cell in cell deps at index {}", dep_index);
                                break;
                            }
                        }
                        Err(_) => {}
                    }
                }
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => break,
            _ => {}
        }
        dep_index += 1;
    }

    let user_cell_lock_hash = user_cell_lock_hash.ok_or_else(|| {
        debug!("User cell not found in cell deps");
        Error::UserCellNotFound
    })?;

    // 5. Confirm if the user cell's type ID is newly added (already verified above)

    // 6. Check if the points amount of the quest being completed is equal to the sum of all points UDT cells
    // minted to the user's lock script in outputs using GroupOutput
    // GroupOutput automatically groups outputs by lock script, so we just need to iterate and sum
    let udt_script = load_script().map_err(|_| Error::ItemMissing)?;
    let udt_script_hash = udt_script.calc_script_hash();

    // Verify that GroupOutput contains cells with the user's lock hash
    let group_lock_hash = load_cell_lock_hash(0, Source::GroupOutput).map_err(|_| {
        debug!("Failed to load lock hash from GroupOutput");
        Error::InvalidUDTAmount
    })?;

    if group_lock_hash.as_slice() != user_cell_lock_hash.as_slice() {
        debug!(
            "GroupOutput lock hash doesn't match user lock hash: {:?} != {:?}",
            group_lock_hash, user_cell_lock_hash
        );
        return Err(Error::InvalidUDTAmount);
    }

    // Iterate through all cells in GroupOutput and sum points amounts
    let mut total_points_amount: u128 = 0;
    let mut cell_index = 0;
    loop {
        match load_cell_type_hash(cell_index, Source::GroupOutput) {
            Ok(Some(type_hash)) if type_hash.as_slice() == udt_script_hash.as_slice() => {
                // Found a points UDT cell in this group, add its amount
                let points_data = load_cell_data(cell_index, Source::GroupOutput)?;
                if points_data.len() >= 16 {
                    let mut amount_bytes = [0u8; 16];
                    amount_bytes.copy_from_slice(&points_data[0..16]);
                    let points_amount = u128::from_le_bytes(amount_bytes);
                    total_points_amount = total_points_amount.saturating_add(points_amount);
                    debug!(
                        "Found points cell in group: amount {}, total so far: {}",
                        points_amount, total_points_amount
                    );
                }
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => break,
            _ => {}
        }
        cell_index += 1;
    }

    if total_points_amount != quest_points {
        debug!(
            "Points amount mismatch: total minted {} != quest reward {}",
            total_points_amount, quest_points
        );
        return Err(Error::InvalidUDTAmount);
    }

    debug!(
        "Points amount validation successful: {} points minted matches quest reward {}",
        total_points_amount, quest_points
    );
    Ok(())
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
                    if data.len() >= 16 {
                        let mut amount_bytes = [0u8; 16];
                        amount_bytes.copy_from_slice(&data[0..16]);
                        input_amount =
                            input_amount.saturating_add(u128::from_le_bytes(amount_bytes));
                    }
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
                    if data.len() >= 16 {
                        let mut amount_bytes = [0u8; 16];
                        amount_bytes.copy_from_slice(&data[0..16]);
                        output_amount =
                            output_amount.saturating_add(u128::from_le_bytes(amount_bytes));
                    }
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
