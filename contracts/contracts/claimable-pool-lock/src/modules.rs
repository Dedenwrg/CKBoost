//! Validation logic for the generic claimable pool lock.
//!
//! The lock only understands two things:
//! - a lock-hash based claim list stored in cell data
//! - a recycler authority stored directly in lock args
//!
//! The paired type script is expected to handle pool creation and mint authorization.

extern crate alloc;

use super::generated::ClaimablePoolEntryVecReader;
use super::Error;
use alloc::vec::Vec;
use ckb_std::{
    ckb_constants::Source,
    ckb_types::packed::Script,
    debug,
    high_level::{
        load_cell_capacity, load_cell_data, load_cell_lock_hash, load_cell_type, load_script,
        load_script_hash,
    },
};
use molecule::prelude::{Entity, Reader};

const CLAIMABLE_POOL_LOCK_ARGS_LEN: usize = 32;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ClaimableEntry {
    claimant_lock_hash: [u8; 32],
    amount: u128,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ClaimablePoolData {
    remaining_amount: u128,
    entries: Vec<ClaimableEntry>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Claim {
    claimant_lock_hash: [u8; 32],
    amount: u128,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ClaimDelta {
    claimant_lock_hash: [u8; 32],
    asset: PoolAsset,
    amount: u128,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum PoolAsset {
    Ckb,
    Udt(Script),
}

fn read_u128(bytes: &[u8]) -> Result<u128, Error> {
    if bytes.len() != 16 {
        return Err(Error::InvalidArgument);
    }
    let mut raw = [0u8; 16];
    raw.copy_from_slice(bytes);
    Ok(u128::from_le_bytes(raw))
}

fn parse_claimable_pool_data(data: &[u8]) -> Result<ClaimablePoolData, Error> {
    if data.len() < 16 {
        debug!("Claimable pool data is too short");
        return Err(Error::InvalidPoolData);
    }

    let remaining_amount = read_u128(&data[0..16])?;
    let entry_reader = ClaimablePoolEntryVecReader::from_slice(&data[16..]).map_err(|_| {
        debug!("Failed to decode claimable pool entries");
        Error::InvalidPoolData
    })?;

    let mut entries = Vec::with_capacity(entry_reader.len());
    let mut entries_amount = 0u128;
    for index in 0..entry_reader.len() {
        let entry = entry_reader.get(index).ok_or_else(|| {
            debug!("Failed to read claimable pool entry at index {}", index);
            Error::InvalidPoolData
        })?;

        let mut claimant_lock_hash = [0u8; 32];
        claimant_lock_hash.copy_from_slice(entry.claimant_lock_hash().raw_data());
        let amount = read_u128(entry.amount().raw_data())?;
        if amount == 0 {
            debug!("Claimable pool entry amount must be greater than zero");
            return Err(Error::InvalidPoolData);
        }
        entries_amount = entries_amount
            .checked_add(amount)
            .ok_or(Error::InvalidPoolData)?;

        entries.push(ClaimableEntry {
            claimant_lock_hash,
            amount,
        });
    }

    if entries_amount != remaining_amount {
        debug!(
            "Claimable pool remaining amount {} does not equal entries sum {}",
            remaining_amount, entries_amount
        );
        return Err(Error::InvalidPoolData);
    }

    Ok(ClaimablePoolData {
        remaining_amount,
        entries,
    })
}

fn add_claim_amount(
    claims: &mut Vec<Claim>,
    claimant_lock_hash: [u8; 32],
    amount: u128,
) -> Result<(), Error> {
    for claim in claims.iter_mut() {
        if claim.claimant_lock_hash == claimant_lock_hash {
            claim.amount = claim
                .amount
                .checked_add(amount)
                .ok_or(Error::InvalidPoolData)?;
            return Ok(());
        }
    }

    claims.push(Claim {
        claimant_lock_hash,
        amount,
    });
    Ok(())
}

fn find_claims(input: &ClaimablePoolData, output: &ClaimablePoolData) -> Result<Vec<Claim>, Error> {
    let mut claims = Vec::new();
    let mut input_index = 0usize;
    let mut output_index = 0usize;

    while input_index < input.entries.len() {
        let input_entry = input.entries[input_index];
        if output_index < output.entries.len() && input_entry == output.entries[output_index] {
            input_index += 1;
            output_index += 1;
            continue;
        }

        add_claim_amount(
            &mut claims,
            input_entry.claimant_lock_hash,
            input_entry.amount,
        )?;
        input_index += 1;
    }

    if output_index != output.entries.len() {
        debug!("Claimable pool output contains unexpected extra entries");
        return Err(Error::InvalidPoolData);
    }

    if claims.is_empty() {
        debug!("No claimable pool entry was removed");
        return Err(Error::InvalidPoolData);
    }

    for output_entry in &output.entries {
        if claims
            .iter()
            .any(|claim| claim.claimant_lock_hash == output_entry.claimant_lock_hash)
        {
            debug!("Claimant still has claimable entries after claim");
            return Err(Error::InvalidPoolData);
        }
    }

    Ok(claims)
}

fn add_claim_delta(deltas: &mut Vec<ClaimDelta>, delta: ClaimDelta) -> Result<(), Error> {
    for existing in deltas.iter_mut() {
        if existing.claimant_lock_hash == delta.claimant_lock_hash && existing.asset == delta.asset {
            existing.amount = existing
                .amount
                .checked_add(delta.amount)
                .ok_or(Error::InvalidPoolData)?;
            return Ok(());
        }
    }

    deltas.push(delta);
    Ok(())
}

fn current_lock_hash() -> Result<[u8; 32], Error> {
    Ok(load_script_hash()?)
}

fn authorized_input_lock_hashes() -> Result<Vec<[u8; 32]>, Error> {
    let current_lock_hash = current_lock_hash()?;
    let mut lock_hashes = Vec::new();
    let mut index = 0;
    loop {
        match load_cell_lock_hash(index, Source::Input) {
            Ok(lock_hash) => {
                let mut raw = [0u8; 32];
                raw.copy_from_slice(lock_hash.as_slice());
                if raw != current_lock_hash && !lock_hashes.contains(&raw) {
                    lock_hashes.push(raw);
                }
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => break,
            Err(err) => return Err(err.into()),
        }
        index += 1;
    }
    Ok(lock_hashes)
}

fn has_authorized_input_lock_hash(target_lock_hash: &[u8]) -> Result<bool, Error> {
    Ok(authorized_input_lock_hashes()?
        .iter()
        .any(|lock_hash| lock_hash.as_slice() == target_lock_hash))
}

fn sum_amounts_for_lock(
    source: Source,
    asset: &PoolAsset,
    claimant_lock_hash: &[u8],
) -> Result<u128, Error> {
    let mut index = 0;
    let mut total = 0u128;
    loop {
        match load_cell_type(index, source) {
            Ok(type_script) => {
                let matches_asset = match (asset, type_script.as_ref()) {
                    (PoolAsset::Ckb, None) => true,
                    (PoolAsset::Udt(expected), Some(actual)) => {
                        actual.as_slice() == expected.as_slice()
                    }
                    _ => false,
                };

                if matches_asset {
                    let lock_hash = load_cell_lock_hash(index, source)?;
                    if lock_hash.as_slice() == claimant_lock_hash {
                        match asset {
                            PoolAsset::Ckb => {
                                total = total
                                    .checked_add(load_cell_capacity(index, source)? as u128)
                                    .ok_or(Error::InvalidPoolData)?;
                            }
                            PoolAsset::Udt(_) => {
                                let data = load_cell_data(index, source)?;
                                if data.len() < 16 {
                                    debug!("Amount-carrying cell data is too short");
                                    return Err(Error::InvalidPoolData);
                                }
                                total = total
                                    .checked_add(read_u128(&data[0..16])?)
                                    .ok_or(Error::InvalidPoolData)?;
                            }
                        }
                    }
                }
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => break,
            Err(err) => return Err(err.into()),
        }
        index += 1;
    }
    Ok(total)
}

fn sum_ckb_for_lock_hashes(source: Source, lock_hashes: &Vec<[u8; 32]>) -> Result<u128, Error> {
    let mut index = 0;
    let mut total = 0u128;
    loop {
        match load_cell_type(index, source) {
            Ok(None) => {
                let lock_hash = load_cell_lock_hash(index, source)?;
                if lock_hashes
                    .iter()
                    .any(|expected| expected.as_slice() == lock_hash.as_slice())
                {
                    total = total
                        .checked_add(load_cell_capacity(index, source)? as u128)
                        .ok_or(Error::InvalidPoolData)?;
                }
            }
            Ok(Some(_)) => {}
            Err(ckb_std::error::SysError::IndexOutOfBound) => break,
            Err(err) => return Err(err.into()),
        }
        index += 1;
    }
    Ok(total)
}

fn sum_cell_capacity(source: Source) -> Result<u128, Error> {
    let mut index = 0;
    let mut total = 0u128;
    loop {
        match load_cell_capacity(index, source) {
            Ok(capacity) => {
                total = total
                    .checked_add(capacity as u128)
                    .ok_or(Error::InvalidPoolData)?;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => break,
            Err(err) => return Err(err.into()),
        }
        index += 1;
    }
    Ok(total)
}

fn count_group_cells(source: Source) -> Result<usize, Error> {
    let mut index = 0;
    loop {
        match load_cell_data(index, source) {
            Ok(_) => index += 1,
            Err(ckb_std::error::SysError::IndexOutOfBound) => return Ok(index),
            Err(err) => return Err(err.into()),
        }
    }
}

fn current_lock_output_indices() -> Result<Vec<usize>, Error> {
    let current_lock_hash = current_lock_hash()?;
    let mut indices = Vec::new();
    let mut index = 0usize;

    loop {
        match load_cell_lock_hash(index, Source::Output) {
            Ok(lock_hash) => {
                if lock_hash.as_slice() == current_lock_hash {
                    indices.push(index);
                }
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => return Ok(indices),
            Err(err) => return Err(err.into()),
        }
        index += 1;
    }
}

fn validate_claim_pool_pair(
    input_group_index: usize,
    output_index: usize,
) -> Result<Vec<ClaimDelta>, Error> {
    let input_capacity = load_cell_capacity(input_group_index, Source::GroupInput)? as u128;
    let output_capacity = load_cell_capacity(output_index, Source::Output)? as u128;

    let input_type_script = load_cell_type(input_group_index, Source::GroupInput)?;
    let output_type_script = load_cell_type(output_index, Source::Output)?;
    if input_type_script != output_type_script {
        debug!("Claimable pool type script changed");
        return Err(Error::InvalidPoolData);
    }
    let asset = match input_type_script {
        Some(type_script) => PoolAsset::Udt(type_script),
        None => PoolAsset::Ckb,
    };

    let input_data =
        parse_claimable_pool_data(&load_cell_data(input_group_index, Source::GroupInput)?)?;
    let output_data = parse_claimable_pool_data(&load_cell_data(output_index, Source::Output)?)?;
    let claims = find_claims(&input_data, &output_data)?;

    let mut total_claimed_amount = 0u128;
    for claim in &claims {
        total_claimed_amount = total_claimed_amount
            .checked_add(claim.amount)
            .ok_or(Error::InvalidPoolData)?;
    }
    if input_data.remaining_amount < output_data.remaining_amount
        || input_data.remaining_amount - output_data.remaining_amount != total_claimed_amount
    {
        debug!("Remaining pool amount did not decrease by claimed amount");
        return Err(Error::InvalidPoolData);
    }

    match asset {
        PoolAsset::Udt(_) => {
            if output_capacity < input_capacity {
                debug!(
                    "UDT claimable pool capacity decreased from {} to {}",
                    input_capacity, output_capacity
                );
                return Err(Error::InvalidPoolData);
            }
        }
        PoolAsset::Ckb => {
            if input_capacity < output_capacity
                || input_capacity - output_capacity != total_claimed_amount
            {
                debug!(
                    "CKB claimable pool capacity delta mismatch: input {}, output {}, claimed {}",
                    input_capacity, output_capacity, total_claimed_amount
                );
                return Err(Error::InvalidPoolData);
            }
        }
    }

    Ok(claims
        .into_iter()
        .map(|claim| ClaimDelta {
            claimant_lock_hash: claim.claimant_lock_hash,
            asset: asset.clone(),
            amount: claim.amount,
        })
        .collect())
}

fn validate_claim_transition(output_indices: &[usize]) -> Result<(), Error> {
    let input_count = count_group_cells(Source::GroupInput)?;
    if input_count == 0 || output_indices.is_empty() || input_count != output_indices.len() {
        debug!(
            "Invalid claimable pool group cell counts: inputs {}, outputs {}",
            input_count,
            output_indices.len()
        );
        return Err(Error::InvalidPoolData);
    }

    let unlocked_lock_hashes = authorized_input_lock_hashes()?;
    let mut claim_deltas = Vec::new();
    for (input_group_index, output_index) in output_indices.iter().enumerate() {
        for delta in validate_claim_pool_pair(input_group_index, *output_index)? {
            if !unlocked_lock_hashes.contains(&delta.claimant_lock_hash) {
                debug!("Claimant lock hash is not present in inputs");
                return Err(Error::UnauthorizedOperation);
            }
            add_claim_delta(&mut claim_deltas, delta)?;
        }
    }

    let mut ckb_claimant_lock_hashes = Vec::new();
    let mut total_ckb_claimed = 0u128;
    for claim in &claim_deltas {
        match &claim.asset {
            PoolAsset::Udt(_) => {
                let input_amount =
                    sum_amounts_for_lock(Source::Input, &claim.asset, &claim.claimant_lock_hash)?;
                let output_amount =
                    sum_amounts_for_lock(Source::Output, &claim.asset, &claim.claimant_lock_hash)?;
                let expected_output_amount = input_amount
                    .checked_add(claim.amount)
                    .ok_or(Error::InvalidPoolData)?;
                if output_amount != expected_output_amount {
                    debug!(
                        "Claimant UDT amount delta mismatch: input {}, output {}, expected delta {}",
                        input_amount, output_amount, claim.amount
                    );
                    return Err(Error::InvalidPoolData);
                }
            }
            PoolAsset::Ckb => {
                if !ckb_claimant_lock_hashes
                    .iter()
                    .any(|lock_hash: &[u8; 32]| lock_hash == &claim.claimant_lock_hash)
                {
                    ckb_claimant_lock_hashes.push(claim.claimant_lock_hash);
                }
                total_ckb_claimed = total_ckb_claimed
                    .checked_add(claim.amount)
                    .ok_or(Error::InvalidPoolData)?;
            }
        }
    }

    if total_ckb_claimed > 0 {
        let input_claimant_capacity =
            sum_ckb_for_lock_hashes(Source::Input, &ckb_claimant_lock_hashes)?;
        let output_claimant_capacity =
            sum_ckb_for_lock_hashes(Source::Output, &ckb_claimant_lock_hashes)?;
        let total_input_capacity = sum_cell_capacity(Source::Input)?;
        let total_output_capacity = sum_cell_capacity(Source::Output)?;
        if total_input_capacity < total_output_capacity {
            debug!("Transaction output capacity exceeds input capacity");
            return Err(Error::InvalidPoolData);
        }
        let transaction_fee = total_input_capacity - total_output_capacity;
        let required_claimant_capacity = input_claimant_capacity
            .checked_add(total_ckb_claimed)
            .ok_or(Error::InvalidPoolData)?;
        if output_claimant_capacity
            .checked_add(transaction_fee)
            .ok_or(Error::InvalidPoolData)?
            < required_claimant_capacity
        {
            debug!(
                "Claimant CKB capacity delta mismatch: input {}, output {}, claimed {}, fee {}",
                input_claimant_capacity, output_claimant_capacity, total_ckb_claimed, transaction_fee
            );
            return Err(Error::InvalidPoolData);
        }
    }

    Ok(())
}

fn validate_recycle_transition(recycler_lock_hash: &[u8]) -> Result<(), Error> {
    if has_authorized_input_lock_hash(recycler_lock_hash)? {
        return Ok(());
    }
    debug!("Recycler authority input lock hash not found");
    Err(Error::UnauthorizedOperation)
}

/// Validate either a claim transition or a recycler-authorized pool consumption.
pub fn validate_claimable_pool_lock() -> Result<(), Error> {
    let script = load_script()?;
    let args = script.args().raw_data();
    if args.len() != CLAIMABLE_POOL_LOCK_ARGS_LEN {
        debug!(
            "Invalid claimable pool lock args length: expected {}, got {}",
            CLAIMABLE_POOL_LOCK_ARGS_LEN,
            args.len()
        );
        return Err(Error::InvalidArgument);
    }

    let output_indices = current_lock_output_indices()?;
    if output_indices.is_empty() {
        validate_recycle_transition(args.as_ref())
    } else {
        validate_claim_transition(&output_indices)
    }
}

#[cfg(test)]
mod tests {
    use super::{find_claims, parse_claimable_pool_data, ClaimableEntry, ClaimablePoolData, Error};
    use crate::generated::{ClaimablePoolEntryBuilder, ClaimablePoolEntryVecBuilder, Uint128};
    use molecule::prelude::{Builder, Entity};

    fn encode_pool(data: &ClaimablePoolData) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&data.remaining_amount.to_le_bytes());

        let entries =
            data.entries
                .iter()
                .fold(ClaimablePoolEntryVecBuilder::default(), |builder, entry| {
                    builder.push(
                        ClaimablePoolEntryBuilder::default()
                            .claimant_lock_hash(entry.claimant_lock_hash)
                            .amount(Uint128::from(entry.amount.to_le_bytes()))
                            .build(),
                    )
                });
        bytes.extend_from_slice(entries.build().as_slice());
        bytes
    }

    #[test]
    fn parse_claimable_pool_layout() {
        let claimant_lock_hash = [7u8; 32];
        let data = ClaimablePoolData {
            remaining_amount: 50,
            entries: vec![ClaimableEntry {
                claimant_lock_hash,
                amount: 50,
            }],
        };

        let encoded = encode_pool(&data);
        let decoded = parse_claimable_pool_data(&encoded).expect("pool data should decode");
        assert_eq!(decoded, data);
    }

    #[test]
    fn parse_allows_empty_pool_with_zero_remaining_amount() {
        let data = ClaimablePoolData {
            remaining_amount: 0,
            entries: vec![],
        };

        let encoded = encode_pool(&data);
        let decoded = parse_claimable_pool_data(&encoded).expect("empty pool should decode");
        assert_eq!(decoded, data);
    }

    #[test]
    fn parse_rejects_short_or_malformed_pool_data() {
        assert_eq!(
            parse_claimable_pool_data(&[0u8; 15]).expect_err("short prefix should fail"),
            Error::InvalidPoolData
        );

        let mut malformed = 0u128.to_le_bytes().to_vec();
        malformed.extend_from_slice(&1u32.to_le_bytes());
        assert_eq!(
            parse_claimable_pool_data(&malformed).expect_err("broken vector should fail"),
            Error::InvalidPoolData
        );
    }

    #[test]
    fn rejects_remaining_amount_that_does_not_match_entries_sum() {
        let data = ClaimablePoolData {
            remaining_amount: 50,
            entries: vec![ClaimableEntry {
                claimant_lock_hash: [7u8; 32],
                amount: 40,
            }],
        };

        let encoded = encode_pool(&data);
        assert_eq!(
            parse_claimable_pool_data(&encoded).expect_err("amount mismatch should fail"),
            Error::InvalidPoolData
        );
    }

    #[test]
    fn rejects_zero_amount_entry() {
        let data = ClaimablePoolData {
            remaining_amount: 0,
            entries: vec![ClaimableEntry {
                claimant_lock_hash: [7u8; 32],
                amount: 0,
            }],
        };

        let encoded = encode_pool(&data);
        assert_eq!(
            parse_claimable_pool_data(&encoded).expect_err("zero entry amount should fail"),
            Error::InvalidPoolData
        );
    }

    #[test]
    fn rejects_entries_sum_overflow() {
        let data = ClaimablePoolData {
            remaining_amount: u128::MAX,
            entries: vec![
                ClaimableEntry {
                    claimant_lock_hash: [7u8; 32],
                    amount: u128::MAX,
                },
                ClaimableEntry {
                    claimant_lock_hash: [8u8; 32],
                    amount: 1,
                },
            ],
        };

        let encoded = encode_pool(&data);
        assert_eq!(
            parse_claimable_pool_data(&encoded).expect_err("entries sum overflow should fail"),
            Error::InvalidPoolData
        );
    }

    #[test]
    fn find_claim_transition_removes_all_entries_for_claimant() {
        let claimant_a = [1u8; 32];
        let claimant_b = [2u8; 32];
        let input = ClaimablePoolData {
            remaining_amount: 125,
            entries: vec![
                ClaimableEntry {
                    claimant_lock_hash: claimant_a,
                    amount: 50,
                },
                ClaimableEntry {
                    claimant_lock_hash: claimant_b,
                    amount: 25,
                },
                ClaimableEntry {
                    claimant_lock_hash: claimant_a,
                    amount: 50,
                },
            ],
        };
        let output = ClaimablePoolData {
            remaining_amount: 25,
            entries: vec![ClaimableEntry {
                claimant_lock_hash: claimant_b,
                amount: 25,
            }],
        };

        let claims = find_claims(&input, &output).expect("claim transition should be found");
        assert_eq!(claims.len(), 1);
        let claim = claims[0];
        assert_eq!(claim.claimant_lock_hash, claimant_a);
        assert_eq!(claim.amount, 100);
    }

    #[test]
    fn find_claim_transition_allows_multiple_claimants() {
        let claimant_a = [1u8; 32];
        let claimant_b = [2u8; 32];
        let claimant_c = [3u8; 32];
        let input = ClaimablePoolData {
            remaining_amount: 175,
            entries: vec![
                ClaimableEntry {
                    claimant_lock_hash: claimant_a,
                    amount: 50,
                },
                ClaimableEntry {
                    claimant_lock_hash: claimant_b,
                    amount: 25,
                },
                ClaimableEntry {
                    claimant_lock_hash: claimant_c,
                    amount: 75,
                },
                ClaimableEntry {
                    claimant_lock_hash: claimant_a,
                    amount: 25,
                },
            ],
        };
        let output = ClaimablePoolData {
            remaining_amount: 75,
            entries: vec![ClaimableEntry {
                claimant_lock_hash: claimant_c,
                amount: 75,
            }],
        };

        let claims = find_claims(&input, &output).expect("claim transition should be found");
        assert_eq!(claims.len(), 2);
        assert_eq!(
            claims,
            vec![
                super::Claim {
                    claimant_lock_hash: claimant_a,
                    amount: 75,
                },
                super::Claim {
                    claimant_lock_hash: claimant_b,
                    amount: 25,
                },
            ]
        );
    }

    #[test]
    fn rejects_partial_claim_for_same_claimant() {
        let claimant_a = [1u8; 32];
        let input = ClaimablePoolData {
            remaining_amount: 100,
            entries: vec![
                ClaimableEntry {
                    claimant_lock_hash: claimant_a,
                    amount: 40,
                },
                ClaimableEntry {
                    claimant_lock_hash: claimant_a,
                    amount: 60,
                },
            ],
        };
        let output = ClaimablePoolData {
            remaining_amount: 60,
            entries: vec![ClaimableEntry {
                claimant_lock_hash: claimant_a,
                amount: 60,
            }],
        };

        assert_eq!(
            find_claims(&input, &output).expect_err("partial claim should fail"),
            Error::InvalidPoolData
        );
    }

    #[test]
    fn rejects_modified_unclaimed_entry_amount() {
        let claimant_a = [1u8; 32];
        let claimant_b = [2u8; 32];
        let input = ClaimablePoolData {
            remaining_amount: 75,
            entries: vec![
                ClaimableEntry {
                    claimant_lock_hash: claimant_a,
                    amount: 50,
                },
                ClaimableEntry {
                    claimant_lock_hash: claimant_b,
                    amount: 25,
                },
            ],
        };
        let output = ClaimablePoolData {
            remaining_amount: 25,
            entries: vec![ClaimableEntry {
                claimant_lock_hash: claimant_b,
                amount: 30,
            }],
        };

        assert_eq!(
            find_claims(&input, &output).expect_err("amount mutation should fail"),
            Error::InvalidPoolData
        );
    }

    #[test]
    fn rejects_noop_claim_transition() {
        let claimant_a = [1u8; 32];
        let input = ClaimablePoolData {
            remaining_amount: 50,
            entries: vec![ClaimableEntry {
                claimant_lock_hash: claimant_a,
                amount: 50,
            }],
        };
        let output = input.clone();

        assert_eq!(
            find_claims(&input, &output).expect_err("no removed entries should fail"),
            Error::InvalidPoolData
        );
    }

    #[test]
    fn rejects_reordered_unclaimed_entries() {
        let claimant_a = [1u8; 32];
        let claimant_b = [2u8; 32];
        let input = ClaimablePoolData {
            remaining_amount: 75,
            entries: vec![
                ClaimableEntry {
                    claimant_lock_hash: claimant_a,
                    amount: 50,
                },
                ClaimableEntry {
                    claimant_lock_hash: claimant_b,
                    amount: 25,
                },
            ],
        };
        let output = ClaimablePoolData {
            remaining_amount: 75,
            entries: vec![
                ClaimableEntry {
                    claimant_lock_hash: claimant_b,
                    amount: 25,
                },
                ClaimableEntry {
                    claimant_lock_hash: claimant_a,
                    amount: 50,
                },
            ],
        };

        assert_eq!(
            find_claims(&input, &output).expect_err("reordered survivor should fail"),
            Error::InvalidPoolData
        );
    }

    #[test]
    fn rejects_added_output_entry() {
        let claimant_a = [1u8; 32];
        let claimant_b = [2u8; 32];
        let input = ClaimablePoolData {
            remaining_amount: 50,
            entries: vec![ClaimableEntry {
                claimant_lock_hash: claimant_a,
                amount: 50,
            }],
        };
        let output = ClaimablePoolData {
            remaining_amount: 75,
            entries: vec![
                ClaimableEntry {
                    claimant_lock_hash: claimant_a,
                    amount: 50,
                },
                ClaimableEntry {
                    claimant_lock_hash: claimant_b,
                    amount: 25,
                },
            ],
        };

        assert_eq!(
            find_claims(&input, &output).expect_err("extra output entry should fail"),
            Error::InvalidPoolData
        );
    }

    #[test]
    fn rejects_claim_amount_overflow_for_same_claimant() {
        let claimant_a = [1u8; 32];
        let input = ClaimablePoolData {
            remaining_amount: 0,
            entries: vec![
                ClaimableEntry {
                    claimant_lock_hash: claimant_a,
                    amount: u128::MAX,
                },
                ClaimableEntry {
                    claimant_lock_hash: claimant_a,
                    amount: 1,
                },
            ],
        };
        let output = ClaimablePoolData {
            remaining_amount: 0,
            entries: vec![],
        };

        assert_eq!(
            find_claims(&input, &output).expect_err("claim sum overflow should fail"),
            Error::InvalidPoolData
        );
    }
}
