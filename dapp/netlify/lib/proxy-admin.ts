import { ccc } from "@ckb-ccc/shell";

export type ProxyAdminCellErrorCode =
  | "proxy_input_missing"
  | "proxy_input_multiple"
  | "proxy_input_not_found"
  | "proxy_output_missing"
  | "proxy_output_multiple"
  | "proxy_output_capacity_mismatch";

export class ProxyAdminCellError extends Error {
  readonly code: ProxyAdminCellErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ProxyAdminCellErrorCode,
    details?: Record<string, unknown>
  ) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

type LoggerLike = {
  info: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
};

export const ensureProxyAdminCellPair = async ({
  tx,
  client,
  signer,
  logger,
}: {
  tx: ccc.Transaction;
  client: ccc.Client;
  signer: ccc.SignerCkbPrivateKey;
  logger: LoggerLike;
}): Promise<void> => {
  const proxyAdminLockScript = (await signer.getRecommendedAddressObj()).script;
  logger.info("proxy_admin_cell_check_start", {
    inputs: tx.inputs.length,
    outputs: tx.outputs.length,
  });

  let proxyAdminInputCell: ccc.Cell | undefined;
  let proxyAdminInputIndex = -1;

  for (let i = 0; i < tx.inputs.length; i += 1) {
    const input = tx.inputs[i];
    const previousOutput = input.previousOutput;
    if (!previousOutput) {
      logger.error("proxy_input_previous_output_missing", { inputIndex: i });
      throw new ProxyAdminCellError("proxy_input_not_found", { inputIndex: i });
    }
    let resolvedCell: ccc.Cell | undefined;
    if (input.cellOutput && input.outputData) {
      resolvedCell = ccc.Cell.from({
        previousOutput,
        cellOutput: input.cellOutput,
        outputData: input.outputData,
      });
    } else {
      resolvedCell = await client.getCell(previousOutput);
    }

    if (!resolvedCell) {
      logger.error("proxy_input_cell_unresolved", {
        inputIndex: i,
        previousOutput,
      });
      throw new ProxyAdminCellError("proxy_input_not_found", {
        inputIndex: i,
        previousOutput,
      });
    }

    if (
      !resolvedCell.cellOutput.type &&
      resolvedCell.cellOutput.lock.eq(proxyAdminLockScript)
    ) {
      if (proxyAdminInputCell) {
        logger.error("proxy_input_multiple", {
          firstIndex: proxyAdminInputIndex,
          duplicateIndex: i,
        });
        throw new ProxyAdminCellError("proxy_input_multiple", {
          firstIndex: proxyAdminInputIndex,
          duplicateIndex: i,
        });
      }
      proxyAdminInputCell = resolvedCell;
      proxyAdminInputIndex = i;
    }
  }

  if (!proxyAdminInputCell) {
    logger.error("proxy_input_cell_missing", { totalInputs: tx.inputs.length });
    throw new ProxyAdminCellError("proxy_input_missing", {
      totalInputs: tx.inputs.length,
    });
  }

  const candidateOutputIndexes = tx.outputs.reduce<number[]>(
    (indexes, output, idx) => {
      if (!output.type && output.lock.eq(proxyAdminLockScript)) {
        indexes.push(idx);
      }
      return indexes;
    },
    []
  );

  if (candidateOutputIndexes.length === 0) {
    logger.error("proxy_output_cell_missing", {
      totalOutputs: tx.outputs.length,
    });
    throw new ProxyAdminCellError("proxy_output_missing", {
      totalOutputs: tx.outputs.length,
    });
  }

  if (candidateOutputIndexes.length > 1) {
    logger.error("proxy_output_multiple", {
      indexes: candidateOutputIndexes,
    });
    throw new ProxyAdminCellError("proxy_output_multiple", {
      indexes: candidateOutputIndexes,
    });
  }

  const proxyAdminOutputIndex = candidateOutputIndexes[0];
  const proxyAdminOutput = tx.outputs[proxyAdminOutputIndex];
  const proxyAdminInputCapacity = ccc.numFrom(
    proxyAdminInputCell.cellOutput.capacity
  );
  const proxyAdminOutputCapacity = ccc.numFrom(
    proxyAdminOutput.capacity ?? "0x0"
  );

  if (proxyAdminInputCapacity !== proxyAdminOutputCapacity) {
    logger.error("proxy_output_capacity_mismatch", {
      proxyAdminInputIndex,
      proxyAdminOutputIndex,
      proxyAdminInputCapacity: proxyAdminInputCapacity.toString(),
      proxyAdminOutputCapacity: proxyAdminOutputCapacity.toString(),
    });
    throw new ProxyAdminCellError("proxy_output_capacity_mismatch", {
      proxyAdminInputIndex,
      proxyAdminOutputIndex,
      proxyAdminInputCapacity: proxyAdminInputCapacity.toString(),
      proxyAdminOutputCapacity: proxyAdminOutputCapacity.toString(),
    });
  }

  logger.info("proxy_admin_cell_verified", {
    proxyAdminInputIndex,
    proxyAdminOutputIndex,
    capacity: proxyAdminInputCapacity.toString(),
  });
};
