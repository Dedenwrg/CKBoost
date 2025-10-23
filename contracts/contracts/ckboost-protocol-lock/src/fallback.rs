use ckb_deterministic::{debug_trace, transaction_recipe::TransactionRecipeExt};
use ckboost_shared::{transaction_context::create_transaction_context, Error};

use crate::{
    modules::CKBoostProtocolLock,
    ssri::{CKBoostAchievement, CKBoostCampaign, CKBoostProtocol, CKBoostTipping},
};

/// Fallback validation implementation for CKBoost Funding Lock
/// This executes when the lock is being validated on-chain
pub fn fallback() -> Result<(), Error> {
    debug_trace!("CKBoost Funding Lock: Starting fallback validation");

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
        b"CKBoostCampaign.update_campaign" => {
            debug_trace!("Executing verify_update_campaign for admin unlock");
            let verify_result = CKBoostProtocolLock::verify_update_campaign(&context);
            debug_trace!("verify_update_campaign result: {:?}", verify_result);
            verify_result
        }
        b"CKBoostCampaign.approve_completion" => {
            debug_trace!("Executing verify_approve_completion");
            let verify_result = CKBoostProtocolLock::verify_approve_completion(&context);
            debug_trace!("verify_approve_completion result: {:?}", verify_result);
            verify_result
        }
        b"CKBoostTipping.update_tipping" => {
            debug_trace!("Executing verify_update_tipping");
            let verify_result = CKBoostProtocolLock::verify_update_tipping(&context);
            debug_trace!("verify_update_tipping result: {:?}", verify_result);
            verify_result
        }
        b"CKBoostProtocol.update_protocol" => {
            debug_trace!("Executing verify_update_protocol");
            let verify_result = CKBoostProtocolLock::verify_update_protocol(&context);
            debug_trace!("verify_update_protocol result: {:?}", verify_result);
            verify_result
        }
        b"CKBoostAchievement.claim_achievement" => {
            debug_trace!("Executing verify_claim_achievement");
            let verify_result = CKBoostProtocolLock::verify_claim_achievement(&context);
            debug_trace!("verify_claim_achievement result: {:?}", verify_result);
            verify_result
        }
        b"CKBoostAchievement.update_achievement" => {
            debug_trace!("Executing verify_update_achievement");
            let verify_result = CKBoostProtocolLock::verify_update_achievement(&context);
            debug_trace!("verify_update_achievement result: {:?}", verify_result);
            verify_result
        }
        _ => {
            // For lock scripts, if no specific method is provided, check both unlock mechanisms
            debug_trace!("No specific method path, checking unlock mechanisms");

            // First check if admin is unlocking
            debug_trace!("User claim detected, validating");
            CKBoostProtocolLock::verify_approve_completion(&context)
        }
    };

    debug_trace!("Fallback validation result: {:?}", result);
    result
}
