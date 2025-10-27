import { ccc } from "@ckb-ccc/connector-react";
import { ckboost } from "ssri-ckboost";
import { createScopedLogger } from "ssri-ckboost";

const log = createScopedLogger("UserCells");

/**
 * Fetch all user cells for a given lock script
 * Searches by lock script first, then optionally filters by type code hash
 * This approach finds all cells with the lock, or specific typed cells if typeCodeHash is provided
 */
export async function getAllUserCellsByLock(
  lockScript: ccc.Script,
  signer: ccc.Signer,
  userTypeCodeHash?: ccc.Hex // Made optional
): Promise<ccc.Cell[]> {
  const cells: ccc.Cell[] = [];
  const startTime = Date.now();

  log.info(
    "Searching for cells with lock:",
    lockScript.hash().slice(0, 10) + "..."
  );

  // Construct the type script filter if userTypeCodeHash is provided
  const typeScript = userTypeCodeHash
    ? {
        codeHash: userTypeCodeHash,
        hashType: "type" as const,
        args: "", // Empty args to match any args - the type filter will handle the code hash matching
      }
    : null;

  if (userTypeCodeHash) {
    log.info("Using type filter:", userTypeCodeHash.slice(0, 10) + "...");
  } else {
    log.info("No type filter - returning all cells with this lock");
  }

  // Use findCellsByLock with optional type parameter
  // This is more efficient than filtering manually
  for await (const cell of signer.client.findCellsByLock(
    lockScript,
    typeScript
  )) {
    log.info(`✅ Found cell #${cells.length + 1}:`, {
      outPoint: cell.outPoint,
      typeArgs: cell.cellOutput.type?.args?.slice(0, 66) + "...",
      capacity: cell.cellOutput.capacity.toString(),
    });
    cells.push(cell);
  }

  log.info(
    `Found ${cells.length} matching user cells in ${Date.now() - startTime}ms`
  );
  return cells;
}

/**
 * Get the latest user cell by block height
 * When multiple user cells exist, returns the one created in the latest block
 * Optionally filters by protocol connection
 */
export async function getLatestUserCellByLock(
  lockScript: ccc.Script,
  userTypeCodeHash: ccc.Hex,
  signer: ccc.Signer,
  protocolTypeHash?: ccc.Hex
): Promise<ccc.Cell | undefined> {
  log.info("Starting search for user cells...");
  const searchStart = Date.now();

  let cells = await getAllUserCellsByLock(lockScript, signer, userTypeCodeHash);

  // Filter by protocol connection if specified
  if (protocolTypeHash) {
    log.info(
      `Filtering for cells connected to protocol: ${protocolTypeHash.slice(
        0,
        10
      )}...`
    );
    const originalCount = cells.length;
    cells = cells.filter((cell) =>
      isUserCellConnectedToProtocol(cell, protocolTypeHash)
    );
    log.info(
      `Filtered from ${originalCount} to ${cells.length} cells connected to current protocol`
    );
  }

  log.info(
    `Found ${cells.length} matching cells in ${Date.now() - searchStart}ms`
  );

  if (cells.length === 0) {
    return undefined;
  }

  if (cells.length === 1) {
    return cells[0];
  }

  // Multiple cells found - need to find the latest one
  log.warn(
    `Found ${cells.length} user cells for lock ${lockScript
      .hash()
      .slice(0, 10)}... - selecting latest by block height`
  );

  let latestCell = cells[0];
  let latestBlockNumber = 0n;

  // Get block number for each cell and find the latest
  for (const cell of cells) {
    try {
      // Get transaction info to find block number
      const txInfo = await signer.client.getTransaction(cell.outPoint.txHash);
      if (txInfo && txInfo.blockNumber) {
        const blockNumber = BigInt(txInfo.blockNumber);
        log.info(
          `Cell ${cell.outPoint.txHash.slice(0, 10)}:${
            cell.outPoint.index
          } is in block ${blockNumber}`
        );

        if (blockNumber > latestBlockNumber) {
          latestBlockNumber = blockNumber;
          latestCell = cell;
        }
      }
    } catch (error) {
      log.error(
        `Failed to get block info for cell ${cell.outPoint.txHash}:${cell.outPoint.index}`,
        error
      );
    }
  }

  log.info(
    `Selected cell from block ${latestBlockNumber} as the latest user cell (total time: ${
      Date.now() - searchStart
    }ms)`
  );
  return latestCell;
}

/**
 * Get the latest user cell for an arbitrary address using a read-only client
 */
export async function getLatestUserCellByAddress(
  address: string,
  client: ccc.Client,
  userTypeCodeHash: ccc.Hex,
  protocolTypeHash?: ccc.Hex
): Promise<ccc.Cell | undefined> {
  const addressObj = await ccc.Address.fromString(address, client);
  const lockScript = addressObj.script;
  return getLatestUserCellByLockWithClient(
    lockScript,
    client,
    userTypeCodeHash,
    protocolTypeHash
  );
}

async function getLatestUserCellByLockWithClient(
  lockScript: ccc.Script,
  client: ccc.Client,
  userTypeCodeHash: ccc.Hex,
  protocolTypeHash?: ccc.Hex
): Promise<ccc.Cell | undefined> {
  let cells = await getAllUserCellsByLockWithClient(
    lockScript,
    client,
    userTypeCodeHash
  );

  if (protocolTypeHash) {
    cells = cells.filter((cell) =>
      isUserCellConnectedToProtocol(cell, protocolTypeHash)
    );
  }

  if (cells.length === 0) {
    return undefined;
  }

  if (cells.length === 1) {
    return cells[0];
  }

  let latestCell = cells[0];
  let latestBlockNumber = 0n;

  for (const cell of cells) {
    try {
      const txInfo = await client.getTransaction(cell.outPoint.txHash);
      if (txInfo?.blockNumber) {
        const blockNumber = BigInt(txInfo.blockNumber);
        if (blockNumber > latestBlockNumber) {
          latestBlockNumber = blockNumber;
          latestCell = cell;
        }
      }
    } catch (error) {
      log.error("Failed to load transaction info", error);
    }
  }

  return latestCell;
}

async function getAllUserCellsByLockWithClient(
  lockScript: ccc.Script,
  client: ccc.Client,
  userTypeCodeHash: ccc.Hex
): Promise<ccc.Cell[]> {
  const cells: ccc.Cell[] = [];
  const searchKey = {
    script: lockScript,
    scriptType: "lock" as const,
    scriptSearchMode: "exact" as const,
    withData: true,
  };

  for await (const cell of client.findCells(searchKey)) {
    const typeScript = cell.cellOutput.type;
    if (
      !typeScript ||
      typeScript.codeHash.toLowerCase() !== userTypeCodeHash.toLowerCase()
    ) {
      continue;
    }
    cells.push(cell);
  }

  return cells;
}

/**
 * Fetch all user cells in the system (for debugging/admin purposes)
 * This searches ALL cells with the user type, regardless of owner
 */
export async function fetchAllUserCells(
  userTypeCodeHash: ccc.Hex,
  signer: ccc.Signer
): Promise<ccc.Cell[]> {
  const cells: ccc.Cell[] = [];
  let totalChecked = 0;
  const startTime = Date.now();

  log.info(
    "Searching for ALL user cells with type:",
    userTypeCodeHash.slice(0, 10) + "..."
  );

  // Try searching by type with null script (might work better than empty args)
  for await (const cell of signer.client.findCells({
    script: {
      codeHash: userTypeCodeHash,
      hashType: "type",
      args: "",
    },
    scriptType: "type",
    scriptSearchMode: "prefix",
  })) {
    totalChecked++;
    cells.push(cell);
    log.info(` Found user cell #${cells.length}:`, {
      lock: cell.cellOutput.lock.hash().slice(0, 10) + "...",
      typeArgs: cell.cellOutput.type?.args?.slice(0, 20) + "...",
    });
  }

  log.info(
    ` Found ${
      cells.length
    } total user cells in system (checked ${totalChecked} cells in ${
      Date.now() - startTime
    }ms)`
  );
  return cells;
}

/**
 * Fetch user cell by type_id (O(1) lookup)
 */
export async function fetchUserByTypeId(
  typeId: ccc.Hex,
  userTypeCodeHash: ccc.Hex,
  signer: ccc.Signer,
  protocolTypeHash?: ccc.Hex
): Promise<ccc.Cell | undefined> {
  // First try with the current user's lock script (more efficient)
  const lockScript = (await signer.getRecommendedAddressObj()).script;

  for await (const cell of signer.client.findCellsByLock(lockScript, null)) {
    // Check if this cell has the user type script
    if (
      cell.cellOutput.type &&
      cell.cellOutput.type.codeHash === userTypeCodeHash
    ) {
      // Verify this is the correct cell by checking the type_id
      const cellTypeId = extractTypeIdFromUserCell(cell);
      if (cellTypeId === typeId) {
        // If protocol type hash is provided, verify the cell is connected to it
        if (
          protocolTypeHash &&
          !isUserCellConnectedToProtocol(cell, protocolTypeHash)
        ) {
          log.warn(
            ` Cell with type_id ${typeId.slice(
              0,
              10
            )}... is not connected to protocol ${protocolTypeHash.slice(
              0,
              10
            )}...`
          );
          continue; // Skip this cell and continue searching
        }
        return cell;
      }
    }
  }

  // If not found with lock script, search all cells with this type (fallback)
  for await (const cell of signer.client.findCellsByType({
    codeHash: userTypeCodeHash,
    hashType: "type",
    args: "", // Empty args to match any args
  })) {
    // Verify this is the correct cell by checking the type_id
    const cellTypeId = extractTypeIdFromUserCell(cell);
    if (cellTypeId === typeId) {
      // If protocol type hash is provided, verify the cell is connected to it
      if (
        protocolTypeHash &&
        !isUserCellConnectedToProtocol(cell, protocolTypeHash)
      ) {
        log.warn(
          ` Cell with type_id ${typeId.slice(
            0,
            10
          )}... is not connected to protocol ${protocolTypeHash.slice(
            0,
            10
          )}...`
        );
        continue; // Skip this cell and continue searching
      }
      return cell;
    }
  }

  return undefined;
}

/**
 * Fetch user cell by lock hash
 * This now returns the latest user cell when multiple exist
 * Note: This function expects a lock script to be passed, not a lock hash
 * The parameter name is misleading and should be refactored in the future
 */
export async function fetchUserByLockHash(
  lockHash: ccc.Hex,
  userTypeCodeHash: ccc.Hex,
  signer: ccc.Signer,
  protocolTypeHash?: ccc.Hex
): Promise<ccc.Cell | undefined> {
  // The lockHash parameter is actually a lock script hash, but we need the actual lock script
  // Get the current user's lock script from the signer
  const lockScript = (await signer.getRecommendedAddressObj()).script;

  // Verify this is the correct lock by checking its hash matches
  if (lockScript.hash() !== lockHash) {
    log.warn(
      `Lock hash mismatch - expected ${lockHash.slice(
        0,
        10
      )}... but got ${lockScript.hash().slice(0, 10)}...`
    );
    // Fall back to searching without lock hash verification for now
  }

  // Use the new function that handles multiple cells properly
  // Pass the protocol type hash to filter by protocol connection
  return getLatestUserCellByLock(
    lockScript,
    userTypeCodeHash,
    signer,
    protocolTypeHash
  );
}

/**
 * Extract type_id from user cell's ConnectedTypeID args
 */
export function extractTypeIdFromUserCell(cell: ccc.Cell): ccc.Hex | null {
  if (!cell.cellOutput.type) {
    return null;
  }

  try {
    const args = cell.cellOutput.type.args;
    if (!args || args === "0x") {
      return null;
    }

    // Parse ConnectedTypeID from args
    const connectedTypeId = ckboost.types.ConnectedTypeID.decode(
      ccc.bytesFrom(args)
    );
    return ccc.hexFrom(connectedTypeId.type_id);
  } catch (error) {
    log.error("Failed to extract type_id from user cell:", error);
    return null;
  }
}

/**
 * Check if a user cell is connected to a specific protocol
 */
export function isUserCellConnectedToProtocol(
  cell: ccc.Cell,
  protocolTypeHash: ccc.Hex
): boolean {
  if (!cell.cellOutput.type) {
    return false;
  }

  try {
    const args = cell.cellOutput.type.args;
    if (!args || args === "0x") {
      return false;
    }

    // Parse ConnectedTypeID from args
    const connectedTypeId = ckboost.types.ConnectedTypeID.decode(
      ccc.bytesFrom(args)
    );
    const connectedKey = ccc.hexFrom(connectedTypeId.connected_key);
    const isMatch = connectedKey === protocolTypeHash;
    if (isMatch) {
      log.info(
        `Cell ${cell.outPoint.txHash.slice(0, 10)}:${
          cell.outPoint.index
        } is connected to protocol ${protocolTypeHash.slice(0, 10)}...`
      );
    } else {
      log.info(
        `Cell ${cell.outPoint.txHash.slice(0, 10)}:${
          cell.outPoint.index
        } is not connected to protocol ${protocolTypeHash.slice(0, 10)}...`
      );
    }
    return isMatch;
  } catch (error) {
    log.error("Failed to check protocol connection:", error);
    return false;
  }
}

/**
 * Parse user data from cell
 */
export function parseUserData(
  cell: ccc.Cell
): ReturnType<typeof ckboost.types.UserData.decode> | null {
  try {
    const rawData = cell.outputData;
    return ckboost.types.UserData.decode(rawData);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn("Failed to parse user data (skipping cell):", message);
    return null;
  }
}
