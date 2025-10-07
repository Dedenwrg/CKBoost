extern crate alloc;

use ckb_deterministic::{debug_trace, transaction_recipe::TransactionRecipeExt};
use ckboost_shared::{error::Error, transaction_context::create_transaction_context};

use crate::{modules::CKBoostTippingType, ssri::CKBoostTipping};

/// Fallback validation implementation for CKBoost Tipping Type
/// This executes when SSRI methods are not yet implemented
pub fn fallback() -> Result<(), Error> {
    debug_trace!("CKBoost Tipping Type: Starting fallback validation");

    debug_trace!("Creating transaction context");
    let context = match create_transaction_context() {
        Ok(ctx) => {
            debug_trace!("Transaction context created successfully");
            ctx
        }
        Err(e) => {
            debug_trace!("ERROR: Failed to create transaction context: {:?}", e);
            return Err(e);
        }
    };

    debug_trace!("Getting recipe method path");
    let method_path = context.recipe.method_path_bytes();
    debug_trace!(
        "Method path: {:?}",
        core::str::from_utf8(&method_path).unwrap_or("<invalid UTF-8>")
    );

    let result = match method_path.as_slice() {
        b"CKBoostTipping.update_tipping" => {
            debug_trace!("Executing verify_update_tipping");
            let verify_result = CKBoostTippingType::verify_update_tipping(&context);
            debug_trace!("verify_update_tipping result: {:?}", verify_result);
            verify_result
        }
        _ => {
            debug_trace!("No matching validation rules found for method path");
            debug_trace!("Expected one of: CKBoostTipping.update_tipping");
            Err(Error::SSRIMethodsNotFound)
        }
    };

    debug_trace!("Fallback validation result: {:?}", result);
    result
}
