import { ccc } from '@ckb-ccc/core';
import { createScopedLogger } from '../logging/index.js';

/**
 * Helper functions for working with WitnessArgs and TransactionRecipe
 */

const log = createScopedLogger('WitnessHelper');

/**
 * Checks if a witness is a standard WitnessArgs
 */
export function isStandardWitness(witness: ccc.HexLike): boolean {
  try {
    ccc.WitnessArgs.fromBytes(witness);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extracts TransactionRecipe from witness
 * Following the standard: WitnessArgs -> output_type -> TransactionRecipe
 */
export function extractRecipeFromWitness(witness: ccc.HexLike): ccc.Hex | null {
  try {
    // Parse as WitnessArgs
    const witnessArgs = ccc.WitnessArgs.fromBytes(witness);
    
    // Check if output_type field contains data
    if (witnessArgs.outputType && witnessArgs.outputType !== '0x') {
      // Return the recipe data from output_type field
      return witnessArgs.outputType;
    }
    
    return null;
  } catch (e) {
    // Not a standard WitnessArgs
    return null;
  }
}

/**
 * Debug helper to analyze witness structure
 */
export function analyzeWitness(witness: ccc.HexLike): void {
  const bytes = ccc.bytesFrom(witness);
  log.info('\n=== Witness Analysis ===');
  log.info('Hex:', ccc.hexFrom(bytes));
  log.info('Length:', bytes.length, 'bytes');
  
  try {
    // Try standard WitnessArgs
    const witnessArgs = ccc.WitnessArgs.fromBytes(witness);
    log.info('Type: Standard WitnessArgs');
    log.info('Fields:');
    log.info('  lock:', witnessArgs.lock || '(empty)');
    log.info('  inputType:', witnessArgs.inputType || '(empty)');
    log.info('  outputType:', witnessArgs.outputType || '(empty)');
    
    // If output_type contains recipe, try to decode it
    if (witnessArgs.outputType && witnessArgs.outputType !== '0x') {
      log.info('  outputType contains TransactionRecipe');
      try {
        // The recipe is molecule-encoded, but we can show its hex
        log.info('  Recipe hex:', witnessArgs.outputType);
      } catch {}
    }
  } catch (e) {
    log.info('Type: Not a standard WitnessArgs');
    log.error('Error:', e);
  }
  log.info('===================\n');
}
