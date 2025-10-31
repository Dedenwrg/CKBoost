import { deploymentManager } from "@/lib/ckb/deployment-manager";
import { ccc } from "@ckb-ccc/shell";
import {
  AchievementDataVec,
  ConnectedTypeID,
  UserData,
  UserDataLike,
  type AchievementDataLike,
} from "ssri-ckboost/types";
import { createLogger } from "./log";

const log = createLogger("NetlifyUtils");

/**
 * Minimal definition for an achievement validation rule.
 */
export interface AchievementRule {
  /** Human readable title, also expected to match the achievement title stored on-chain. */
  title: string;
  /**
   * Validate whether the user satisfies the achievement requirements.
   * Should throw an error describing the invalid state when requirements fail.
   */
  validate: (userData: UserDataLike) => boolean;
}

/**
 * Supported achievements for the validator.
 * Additional achievements should extend this array, keeping the interface stable.
 */
export const ACHIEVEMENT_RULES: readonly AchievementRule[] = [
  {
    title: "Telegram Verification",
    validate: (userData: UserDataLike) => {
      const verificationData =
        userData.verification_data.identity_verification_data;

      // Check if verification data exists
      if (
        verificationData === undefined ||
        verificationData === null ||
        ccc.hexFrom(verificationData).toLowerCase() === "0x"
      ) {
        log.info(
          "Telegram verification achievement requires valid identity verification data."
        );
        return false;
      }

      // Parse identity_verification_data as JSON
      try {
        const hex = ccc.hexFrom(verificationData);
        const bytes = ccc.bytesFrom(hex);
        const jsonString = Buffer.from(bytes).toString("utf8");
        const parsedData = JSON.parse(jsonString);

        // Check if parsed data is an array
        if (!Array.isArray(parsedData)) {
          log.info(
            "Telegram verification achievement requires identity verification data to be an array."
          );
          return false;
        }

        // Check if there's at least one entry with source "telegram"
        const hasTelegramEntry = parsedData.some(
          (entry: { source?: string }) => entry.source === "telegram"
        );

        if (!hasTelegramEntry) {
          log.info(
            "Telegram verification achievement requires an entry with source 'telegram'."
          );
          return false;
        }

        return true;
      } catch (error) {
        log.info(
          "Failed to parse identity verification data as JSON:",
          error instanceof Error ? error.message : String(error)
        );
        return false;
      }
    },
  },
  {
    title: "First Submission",
    validate: (userData: UserDataLike) => {
      log.info("Validating first submission");
      const submissionCount = userData.submission_records.length;
      if (submissionCount === 0) {
        log.info(
          "First submission achievement requires at least one submission."
        );
        return false;
      }
      return true;
    },
  },
] as const;

/**
 * Create a quick lookup map for achievement rules by id.
 */
const ACHIEVEMENT_RULE_MAP = new Map(
  ACHIEVEMENT_RULES.map((rule) => [rule.title, rule])
);

export const getGrantableAchievements = async (
  signer: ccc.Signer,
  userAddress: string,
  achievementTypeCodeHash: ccc.Hex
): Promise<string[]> => {
  // Verify user lock matches the provided address.
  const addressObj = await ccc.Address.fromString(userAddress, signer.client);
  const addressLockScript = addressObj.script;

  const network = deploymentManager.getCurrentNetwork();
  const userTypeCodeHash = deploymentManager.getContractCodeHash(
    network,
    "ckboostUserType"
  );

  if (!userTypeCodeHash) {
    throw new Error("User type code hash not found.");
  }

  const protocolTypeScript = ccc.Script.from(getProtocolTypeScript());

  // Resolve on-chain user cell using lock hash + type script for additional certainty.
  const userCell = await getLatestUserCellByLock(
    addressLockScript,
    userTypeCodeHash,
    signer,
    protocolTypeScript.hash()
  );

  if (!userCell) {
    throw new Error(
      "Unable to locate existing on-chain user cell for the supplied address."
    );
  }
  // ISSUE #18: Here we assume only one achievement cell exists.
  const achievementCell = await findAchievementCell(
    signer.client,
    achievementTypeCodeHash
  );

  if (!achievementCell) {
    throw new Error("Unable to locate existing on-chain achievement cell.");
  }

  const achievementDataVec = AchievementDataVec.decode(
    ccc.hexFrom(achievementCell.outputData)
  ) as AchievementDataLike[];
  log.info("achievementDataVec", achievementDataVec);
  const availableAchievements = achievementDataVec.filter((achievement) => {
    const achievementReceiverHashes = achievement.receiver_user_record_vec?.map(
      (record) => {
        return record.receiver_user_type_hash;
      }
    );
    return !achievementReceiverHashes?.includes(
      userCell.cellOutput.type?.hash() ?? ""
    );
  });
  log.info("availableAchievements", availableAchievements);

  const userData = UserData.decode(userCell.outputData);

  const grantableAchievements: string[] = availableAchievements
    .filter((achievement) => {
      log.info("Checking achievement", achievement.achievement_title);
      const rule = ACHIEVEMENT_RULE_MAP.get(achievement.achievement_title);
      if (!rule) {
        log.info(
          "Rule not found for achievement",
          achievement.achievement_title
        );
        return false;
      }
      log.info("Validating achievement", achievement.achievement_title);
      return rule.validate(userData);
    })
    .map((achievement) => achievement.achievement_title);
  log.info("grantableAchievements", grantableAchievements);
  return grantableAchievements;
};

export interface EvaluateUserAchievementsInput {
  client: ccc.Client;
  userAddress: string;
  userTypeCodeHash: string;
  achievementTypeCodeHash: string;
}

export interface EvaluateUserAchievementsResult {
  completedIds: Set<string>;
  grantableIds: string[];
}

const findAchievementCell = async (
  client: ccc.Client,
  achievementTypeCodeHash: string
): Promise<ccc.Cell | null> => {
  for await (const cell of client.findCells({
    script: {
      codeHash: achievementTypeCodeHash,
      hashType: "type" as ccc.HashType,
      args: "0x",
    },
    scriptType: "type",
    scriptSearchMode: "prefix",
    withData: true,
  })) {
    return cell;
  }

  return null;
};

export const getProtocolTypeScript = () => {
  const network = deploymentManager.getCurrentNetwork();
  const deployment = deploymentManager.getCurrentDeployment(
    network,
    "ckboostProtocolType"
  );

  if (!deployment || !deployment.typeHash) {
    throw new Error(
      `Protocol type contract not found in deployments.json for ${network}`
    );
  }

  // For protocol cells, we need to use the actual protocol contract code hash (typeHash)
  // not the Type ID script code hash
  const protocolTypeScript = {
    codeHash: deployment.typeHash,
    hashType: "type" as const,
    args: process.env.NEXT_PUBLIC_PROTOCOL_TYPE_ARGS || "0x", // Empty args to search for any protocol cell
  };

  return protocolTypeScript;
};

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

export async function getLatestUserCellByLockWithClient(
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
      log.error(
        `Failed to load transaction info for ${cell.outPoint.txHash}:${cell.outPoint.index}`,
        error
      );
    }
  }

  return latestCell;
}

export async function getLatestUserCellByAddressWithClient(
  address: string,
  client: ccc.Client,
  userTypeCodeHash: ccc.Hex,
  protocolTypeHash?: ccc.Hex
): Promise<ccc.Cell | undefined> {
  const addressObj = await ccc.Address.fromString(address, client);
  return getLatestUserCellByLockWithClient(
    addressObj.script,
    client,
    userTypeCodeHash,
    protocolTypeHash
  );
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
    const connectedTypeId = ConnectedTypeID.decode(ccc.bytesFrom(args));
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
 * Fetch protocol cell from CKB blockchain
 * @param client - CCC client instance
 * @returns Protocol cell or null if not found
 */
export async function fetchProtocolCell(
  client: ccc.Client
): Promise<ccc.Cell | null> {
  try {
    // Check if client is properly initialized
    if (!client) {
      throw new Error("Client is not initialized.");
    }

    // Get protocol type script
    let protocolTypeScript;
    try {
      protocolTypeScript = getProtocolTypeScript();
    } catch (error) {
      throw new Error(
        `Protocol contract not found in deployments.json. ` +
          `Please ensure the CKBoost protocol contract is deployed on-chain first using the deployment scripts. ` +
          `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    log.info("Searching for protocol cell with type script:", {
      codeHash: protocolTypeScript.codeHash,
      hashType: protocolTypeScript.hashType,
      args: protocolTypeScript.args,
    });

    // Search for protocol cell by type script
    const cellsGenerator = client.findCells({
      script: protocolTypeScript,
      scriptType: "type",
      scriptSearchMode: "exact",
    });

    // Get first cell from async generator
    const firstCell = await cellsGenerator.next();
    log.info("Cell search result:", {
      done: firstCell.done,
      hasValue: !!firstCell.value,
    });

    if (firstCell.done || !firstCell.value) {
      log.warn(
        "No protocol cell found on blockchain with the configured type script"
      );
      // Provide more specific guidance based on the type script args
      if (protocolTypeScript.args === "0x") {
        throw new Error(
          "No protocol cell exists on the blockchain yet. " +
            "Please deploy a new protocol cell using the Protocol Management interface."
        );
      } else {
        throw new Error(
          `No protocol cell found with type script args: ${protocolTypeScript.args}. ` +
            "The protocol cell may have been consumed or the configuration may be incorrect."
        );
      }
    }

    const cell = firstCell.value;
    return cell;
  } catch (error) {
    log.error("Failed to fetch protocol cell:", error);

    // Re-throw with the original error message if it's already descriptive
    if (
      error instanceof Error &&
      (error.message.includes("Signer") ||
        error.message.includes("protocol") ||
        error.message.includes("deploy"))
    ) {
      throw error;
    }

    // Otherwise, provide a generic error
    throw new Error(
      `Failed to fetch protocol data from blockchain: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
