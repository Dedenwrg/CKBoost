/**
 * Transaction wrapper utilities for handling common transaction errors
 * Provides automatic retry with correct fees when minimum fee errors occur
 */

import { ccc, KnownScript } from "@ckb-ccc/connector-react";
import { createScopedLogger } from "ssri-ckboost";
import {
  PendingTransactionMetadata,
  registerPendingTransaction,
} from "@/lib/pending-transactions";

const log = createScopedLogger("TransactionWrapper");

function serializeTransactionError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  try {
    return JSON.stringify(error, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value
    );
  } catch {
    return String(error);
  }
}

function assertHexArray(values: ccc.Hex[], label: string): void {
  values.forEach((value, index) => {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) {
      throw new Error(`${label}[${index}] must be a hex string`);
    }
  });
}

function normalizeTransactionForWallet(tx: ccc.Transaction): void {
  if (tx.outputsData.length > tx.outputs.length) {
    throw new Error(
      `Transaction has ${tx.outputsData.length} outputsData entries for ${tx.outputs.length} outputs`
    );
  }

  while (tx.outputsData.length < tx.outputs.length) {
    tx.outputsData.push("0x");
  }

  while (tx.witnesses.length < tx.inputs.length) {
    tx.witnesses.push("0x");
  }

  assertHexArray(tx.outputsData, "outputsData");
  assertHexArray(tx.witnesses, "witnesses");
}

/**
 * Parse the required fee from a PoolRejectedTransactionByMinFeeRate error message
 * @param errorMessage The error message from the blockchain
 * @returns The required fee in shannons or null if not found
 */
function parseRequiredFee(errorMessage: string): bigint | null {
  // Pattern: "requiring a transaction fee of at least XXXX shannons"
  const match = errorMessage.match(
    /requiring a transaction fee of at least (\d+) shannons/
  );
  if (match && match[1]) {
    return BigInt(match[1]);
  }
  return null;
}

function isChangeCellCapacityError(errorMessage: string): boolean {
  return errorMessage.includes("for the change cell");
}

function pickFeeSinkOutputIndex(
  tx: ccc.Transaction,
  preserveOutputCapacityIndices?: ReadonlySet<number>
): number | null {
  const canUseOutput = (_output: ccc.CellOutput, index: number) =>
    !preserveOutputCapacityIndices?.has(index);

  const typedOutputIndex = tx.outputs.findIndex(
    (output, index) => !!output.type && canUseOutput(output, index)
  );
  if (typedOutputIndex >= 0) {
    return typedOutputIndex;
  }

  const outputIndex = tx.outputs.findIndex(canUseOutput);
  if (outputIndex >= 0) {
    return outputIndex;
  }

  return null;
}

async function completeTransactionForSend(
  signer: ccc.Signer,
  tx: ccc.Transaction,
  feeRate?: number,
  preserveOutputCapacityIndices?: ReadonlySet<number>
): Promise<void> {
  await tx.completeInputsByCapacity(signer);

  // Wallet signers can add required cell deps and placeholder witnesses while
  // preparing a transaction. CCC core versions before 1.18.2 ignored a newly
  // returned prepared transaction during fee completion. Copy it back here so
  // fees include wallet preparation even across different core instances.
  const preparedTx = await signer.prepareTransaction(tx);
  if (preparedTx !== tx) {
    tx.copy(preparedTx);
  }

  try {
    await tx.completeFeeBy(signer, feeRate);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    if (!isChangeCellCapacityError(errorMessage)) {
      throw error;
    }

    const outputIndex = pickFeeSinkOutputIndex(
      tx,
      preserveOutputCapacityIndices
    );
    if (outputIndex === null) {
      throw error;
    }

    log.warn(
      `Change cell cannot be created with current capacity, redirecting change to output ${outputIndex}`
    );
    await tx.completeFeeChangeToOutput(signer, outputIndex, feeRate);
  }
}

/**
 * Get fee rate from the node via CCC client; optionally boost to satisfy a parsed required fee.
 * Returns shannons per kiloweight (KW) as number.
 */
async function calculateFeeRate(
  signer: ccc.Signer,
  tx?: ccc.Transaction,
  requiredFee?: bigint
): Promise<number> {
  // 1) Ask node for recommended fee rate
  let recommended = 1000; // default fallback (shannons/KW)
  try {
    const nodeRate = await signer.client.getFeeRate();
    // getFeeRate may return bigint or number depending on client version
    const parsedRate = Number(nodeRate);
    if (Number.isFinite(parsedRate) && parsedRate > 0) {
      recommended = parsedRate;
    }
  } catch (_) {
    // ignore and use fallback
  }

  // 2) If we know the required total fee from the error and have tx size, compute a minimum
  if (requiredFee && tx) {
    // CCC charges ceil(size * feeRate / 1000), including a 4-byte
    // serialization offset. Keep the byte size exact here: rounding it to a
    // whole kilobyte first can underestimate the rate (for example, a
    // 2049-byte transaction would incorrectly be treated as three full KW).
    const txSizeBytes = BigInt(tx.toBytes().length + 4);
    // ceil(requiredFee * 1000 / txSizeBytes)
    const minRateBig =
      (requiredFee * 1000n + txSizeBytes - 1n) / txSizeBytes;
    // add ~10% buffer safely with BigInt: ceil(minRate * 1.1)
    const bufferedBig = (minRateBig * 11n + 9n) / 10n;
    const buffered = Number(bufferedBig);
    return Math.max(recommended, buffered);
  }

  return recommended;
}

/**
 * Send a transaction with automatic fee retry
 *
 * This wrapper will:
 * 1. Try to send the transaction
 * 2. If it fails due to low fee, parse the required fee
 * 3. Rebuild the transaction with the correct fee
 * 4. Ask the user to sign again
 *
 * @param signer The signer to use
 * @param tx The transaction to send
 * @returns The transaction hash
 */
export type SendTransactionOptions = {
  pendingMetadata?: PendingTransactionMetadata;
  preserveOutputCapacityIndices?: ReadonlySet<number>;
};

export async function sendTransactionWithFeeRetry(
  signer: ccc.Signer,
  tx: ccc.Transaction,
  options?: SendTransactionOptions
): Promise<ccc.Hex> {
  let attempts = 0;
  const maxAttempts = 3;
  let feeRate = await calculateFeeRate(signer);

  while (attempts < maxAttempts) {
    attempts++;
    // ISSUE #16: Provide cell deps for known scripts that are often missing
    await tx.addCellDepsOfKnownScripts(
      signer.client,
      KnownScript.Secp256k1Blake160
    );

    try {
      // Reinitialize outputs for auto capacity calculation
      for (let i = 0; i < tx.outputs.length; i++) {
        const out = tx.outputs[i];
        if (out.type) {
          const cellOutputLike = options?.preserveOutputCapacityIndices?.has(i)
            ? { capacity: out.capacity, lock: out.lock, type: out.type }
            : { lock: out.lock, type: out.type };
          tx.outputs[i] = ccc.CellOutput.from(
            cellOutputLike,
            tx.outputsData[i] as ccc.HexLike
          );
        }
      }

      await completeTransactionForSend(
        signer,
        tx,
        feeRate,
        options?.preserveOutputCapacityIndices
      );

      log.info(`Transaction send attempt ${attempts}/${maxAttempts}`);

      // Try to send the transaction. Normalize a clone so fee-retry can keep
      // rebuilding from the same transaction object if RPC submission fails.
      const txForWallet = tx.clone();
      normalizeTransactionForWallet(txForWallet);
      log.log("JSON.stringify(tx)", ccc.stringify(txForWallet));
      const txHash = await signer.sendTransaction(txForWallet);
      log.info("Transaction sent successfully! TxHash:", txHash);
      registerPendingTransaction(txHash, options?.pendingMetadata);
      return txHash;
    } catch (error) {
      const errorMessage = serializeTransactionError(error);
      log.error(`Transaction send attempt ${attempts} failed:`, errorMessage);

      // Check if it's a minimum fee error
      if (errorMessage.includes("PoolRejectedTransactionByMinFeeRate")) {
        log.warn(
          "Transaction rejected due to insufficient fee. Attempting to fix..."
        );

        // Parse the required fee from the error message
        const requiredFee = parseRequiredFee(errorMessage);
        if (!requiredFee) {
          log.error("Could not parse required fee from error message");
          throw error;
        }

        log.info(`Required fee: ${requiredFee} shannons`);

        if (attempts >= maxAttempts) {
          throw new Error(
            `Transaction fee adjustment failed after ${maxAttempts} attempts. ` +
              `The node required a fee of at least ${requiredFee} shannons.`
          );
        }

        // Query fee rate from node and ensure it covers requiredFee
        feeRate = await calculateFeeRate(signer, tx, requiredFee);
        log.info(`Calculated fee rate: ${feeRate} shannons/KW`);

        // Clear existing fee outputs and rebuild with new fee rate
        // Remove any existing change outputs (usually the last output if it goes back to sender)
        const senderAddress = await signer.getRecommendedAddressObj();
        const senderLockScript = senderAddress.script;

        // Filter out change outputs (lock-only, back to sender)
        const nextOutputs: ccc.CellOutput[] = [];
        const nextOutputsData: ccc.Hex[] = [];
        for (let i = 0; i < tx.outputs.length; i++) {
          const output = tx.outputs[i];
          const isChange =
            !output.type &&
            output.lock.codeHash === senderLockScript.codeHash &&
            output.lock.hashType === senderLockScript.hashType &&
            ccc.hexFrom(output.lock.args) === ccc.hexFrom(senderLockScript.args);

          if (isChange) {
            log.info(`Removing change output at index ${i}`);
            continue;
          }

          nextOutputs.push(output);
          nextOutputsData.push(ccc.hexFrom(tx.outputsData[i] ?? "0x"));
        }
        tx.outputs = nextOutputs;
        tx.outputsData = nextOutputsData;

        // Ensure inputs satisfy capacity at new fee stage, then recalc fees
        await completeTransactionForSend(
          signer,
          tx,
          feeRate,
          options?.preserveOutputCapacityIndices
        );

        log.info(
          "Transaction rebuilt with new fee. Requesting signature again..."
        );

        // Show user-friendly message
        if (attempts === 1) {
          log.info(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  Transaction Fee Adjustment Required
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The blockchain requires a higher transaction fee.

Original fee was too low. Adjusting to meet minimum requirements...
Required minimum fee: ${requiredFee} shannons

Please sign the transaction again with the corrected fee.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          `);
        }

        // Continue to next attempt
        continue;
      }

      // If it's not a fee error, throw it
      throw error;
    }
  }

  throw new Error(`Failed to send transaction after ${maxAttempts} attempts`);
}
