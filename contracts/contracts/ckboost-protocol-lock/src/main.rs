#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(test), no_main)]

#[cfg(any(feature = "library", test))]
extern crate alloc;

use alloc::borrow::Cow;
use ckb_deterministic::debug_trace;
use ckb_ssri_std::utils::should_fallback;
use ckb_ssri_std_proc_macro::ssri_methods;
use ckb_std::syscalls::{pipe, write};
use ckboost_shared::Error;

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

use crate::fallback::fallback;

fn program_entry_wrap() -> Result<(), Error> {
    let argv = ckb_std::env::argv();

    if should_fallback()? {
        debug_trace!("ckboost-protocol-lock: executing fallback validation");
        fallback()?;
        return Ok(());
    }

    debug_trace!("ckboost-protocol-lock: entering SSRI methods");

    let res: Cow<'static, [u8]> = ssri_methods!(
        argv: &argv,
        invalid_method: Error::SSRIMethodsNotFound,
        invalid_args: Error::SSRIMethodsArgsInvalid,
    )?;

    let pipe = pipe()?;
    write(pipe.1, &res)?;
    Ok(())
}

pub fn program_entry() -> i8 {
    match program_entry_wrap() {
        Ok(_) => 0,
        Err(err) => {
            debug_trace!("ckboost-protocol-lock execution failed: {:?}", err);
            err as i8
        }
    }
}
