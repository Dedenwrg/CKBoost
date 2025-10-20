extern crate alloc;

use ckb_deterministic::{debug_trace, transaction_recipe::TransactionRecipeExt};
use ckb_std::debug;
use ckboost_shared::{error::Error, transaction_context::create_transaction_context};

use crate::{modules::CKBoostAchievementType, ssri::CKBoostAchievement};

/// Fallback validation implementation for CKBoost User Type
/// This executes when SSRI methods are not yet implemented
pub fn fallback() -> Result<(), Error> {
    debug_trace!("CKBoost Achievement Type: Starting fallback validation");

    let context = create_transaction_context()?;

    // Debug log the method path to see what's actually being received
    let method_path = context.recipe.method_path_bytes();
    debug_trace!("Received method path bytes: {:?}", method_path.as_slice());
    debug_trace!(
        "Method path as string: {:?}",
        core::str::from_utf8(method_path.as_slice()).ok()
    );

    match method_path.as_slice() {
        b"CKBoostAchievement.update_achievement" => {
            debug_trace!(
                "Matched CKBoostAchievement.update_achievement - calling verify_update_achievement"
            );
            CKBoostAchievementType::verify_update_achievement(&context)
        }
        b"CKBoostAchievement.claim_achievement" => {
            debug_trace!(
                "Matched CKBoostAchievement.claim_achievement - calling verify_claim_achievement"
            );
            CKBoostAchievementType::verify_claim_achievement(&context)
        }
        _ => {
            debug_trace!("No matching validation rules found for method path");
            debug_trace!(
                "Expected one of: CKBoostAchievement.update_achievement, CKBoostAchievement.claim_achievement"
            );
            Err(Error::WrongMethodPath)
        }
    }
}
