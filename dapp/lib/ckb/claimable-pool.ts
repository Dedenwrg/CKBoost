import { ccc } from "@ckb-ccc/connector-react";
import {
  decodeClaimablePoolData,
  type ClaimablePoolEntry,
} from "ckb-claimable-pool-lock";
import claimablePoolDeployments from "../../../contracts/contracts/claimable-pool-lock/deployments.json";
import { createScopedLogger } from "ssri-ckboost";
import { deploymentManager, type Network } from "./deployment-manager";

const log = createScopedLogger("ClaimablePool");

export type ClaimablePoolClaimCell = {
  cell: ccc.Cell;
  amount: bigint;
};

export type ClaimablePointsSummary = {
  claimantLockHash: ccc.Hex;
  totalAmount: bigint;
  cells: ClaimablePoolClaimCell[];
};

type ClaimablePoolDeployment = {
  transactionHash: ccc.Hex;
  index: ccc.NumLike;
  typeHash?: ccc.Hex;
};

export function emptyClaimablePointsSummary(
  claimantLockHash: ccc.HexLike = `0x${"00".repeat(32)}`
): ClaimablePointsSummary {
  return {
    claimantLockHash: ccc.hexFrom(ccc.bytesFrom(claimantLockHash)),
    totalAmount: 0n,
    cells: [],
  };
}

export function getClaimablePoolLockDeployment(
  network: Network = deploymentManager.getCurrentNetwork()
): ClaimablePoolDeployment | null {
  return (
    (claimablePoolDeployments as unknown as {
      current?: Record<string, { claimablePoolLock?: ClaimablePoolDeployment }>;
    }).current?.[network]?.claimablePoolLock ?? null
  );
}

export function getClaimablePoolLockCodeHash(
  network: Network = deploymentManager.getCurrentNetwork()
): ccc.Hex | null {
  return getClaimablePoolLockDeployment(network)?.typeHash ?? null;
}

export function getClaimablePoolLockOutPoint(
  network: Network = deploymentManager.getCurrentNetwork()
): { txHash: ccc.Hex; index: ccc.NumLike } | null {
  const deployment = getClaimablePoolLockDeployment(network);
  if (!deployment) return null;
  return {
    txHash: deployment.transactionHash,
    index: deployment.index,
  };
}

export function addClaimablePoolLockCellDep(tx: ccc.Transaction): void {
  const outPoint = getClaimablePoolLockOutPoint();
  if (!outPoint) {
    throw new Error(
      "Claimable Pool Lock contract not found in claimable-pool-lock/deployments.json"
    );
  }

  tx.addCellDeps({
    outPoint,
    depType: "code",
  });
}

export async function queryClaimablePointsPools(params: {
  client: ccc.Client;
  claimantLock: ccc.Script;
  protocolTypeHash: ccc.HexLike;
}): Promise<ClaimablePointsSummary> {
  const { client, claimantLock, protocolTypeHash } = params;
  const claimantLockHash = normalizeByte32Hex(claimantLock.hash());
  const network = deploymentManager.getCurrentNetwork();
  const claimablePoolLockCodeHash = getClaimablePoolLockCodeHash(network);
  const pointsUdtCodeHash = deploymentManager.getContractCodeHash(
    network,
    "ckboostPointsUdt"
  );

  if (!claimablePoolLockCodeHash || !pointsUdtCodeHash) {
    log.warn("Claimable pool query skipped because deployments are incomplete", {
      hasClaimablePoolLock: !!claimablePoolLockCodeHash,
      hasPointsUdt: !!pointsUdtCodeHash,
    });
    return emptyClaimablePointsSummary(claimantLockHash);
  }

  const pointsType = ccc.Script.from({
    codeHash: pointsUdtCodeHash,
    hashType: "type" as ccc.HashType,
    args: ccc.hexFrom(ccc.bytesFrom(protocolTypeHash)),
  });

  const searchKey = {
    script: {
      codeHash: claimablePoolLockCodeHash,
      hashType: "type" as const,
      args: "0x",
    },
    scriptType: "lock" as const,
    scriptSearchMode: "prefix" as const,
    filter: {
      script: pointsType,
    },
    withData: true,
  };

  const cells: ClaimablePoolClaimCell[] = [];

  for await (const cell of client.findCells(searchKey)) {
    if (!cell.cellOutput.type) {
      continue;
    }

    try {
      const decoded = decodeClaimablePoolData(cell.outputData);
      const amount = sumClaimableEntriesForLock(
        decoded.entries,
        claimantLockHash
      );
      if (amount <= 0n) {
        continue;
      }

      cells.push({
        cell,
        amount,
      });
    } catch (error) {
      log.warn("Skipping invalid claimable pool cell", {
        outPoint: cell.outPoint,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    claimantLockHash,
    totalAmount: cells.reduce((total, item) => total + item.amount, 0n),
    cells,
  };
}

function normalizeByte32Hex(value: ccc.HexLike): ccc.Hex {
  const bytes = ccc.bytesFrom(value);
  if (bytes.length !== 32) {
    throw new Error(`Expected 32 bytes, received ${bytes.length}`);
  }
  return ccc.hexFrom(bytes).toLowerCase() as ccc.Hex;
}

function sumClaimableEntriesForLock(
  entries: ClaimablePoolEntry[],
  claimantLockHash: ccc.HexLike
): bigint {
  const normalizedClaimantLockHash = normalizeByte32Hex(claimantLockHash);
  return entries.reduce((total, entry) => {
    const entryLockHash = normalizeByte32Hex(entry.claimantLockHash);
    if (entryLockHash !== normalizedClaimantLockHash) {
      return total;
    }
    return total + ccc.numFrom(entry.amount);
  }, 0n);
}
