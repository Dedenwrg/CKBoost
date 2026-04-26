#![cfg_attr(not(test), no_std)]

extern crate alloc;

use ckb_std::error::SysError;

pub mod generated;
pub mod modules;

use self::modules::validate_claimable_pool_lock;

#[repr(i8)]
#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Error {
    IndexOutOfBound = 1,
    ItemMissing,
    LengthNotEnough,
    Encoding,
    UnauthorizedOperation,
    InvalidPoolData,
    InvalidArgument,
    Unknown,
}

impl From<SysError> for Error {
    fn from(err: SysError) -> Self {
        match err {
            SysError::IndexOutOfBound => Error::IndexOutOfBound,
            SysError::ItemMissing => Error::ItemMissing,
            SysError::LengthNotEnough(_) => Error::LengthNotEnough,
            SysError::Encoding => Error::Encoding,
            _ => Error::Unknown,
        }
    }
}

fn program_entry_wrap() -> Result<(), Error> {
    validate_claimable_pool_lock()
}

pub fn program_entry() -> i8 {
    match program_entry_wrap() {
        Ok(_) => 0,
        Err(err) => err as i8,
    }
}
