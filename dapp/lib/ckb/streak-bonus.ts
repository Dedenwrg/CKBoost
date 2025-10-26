import { ccc } from "@ckb-ccc/connector-react";
import { deploymentManager } from "@/lib/ckb/deployment-manager";
import {
  getLatestUserCellByAddress,
  parseUserData,
} from "@/lib/ckb/user-cells";
import { injectProxyAuthenticationCell } from "@/lib/utils/api";
import type { BonusStreakCalculation } from "@/netlify/lib/streak-bonus";
import { UserData, type UserDataLike } from "ssri-ckboost/types";

const readUdtAmount = (data: ccc.HexLike | undefined | null): bigint => {
  if (!data) return 0n;
  const hex = ccc.hexFrom(data);
  if (hex === "0x" || hex.length < 34) {
    return 0n;
  }
  const bytes = ccc.bytesFrom(hex);
  if (bytes.length < 16) {
    return 0n;
  }
  const slice = bytes.subarray(0, 16);
  return ccc.numLeFromBytes(slice);
};

const cloneUserData = (
  userData: ReturnType<typeof UserData.decode>
): UserDataLike => ({
  verification_data: {
    telegram_personal_chat_id: ccc.numFrom(
      userData.verification_data.telegram_personal_chat_id
    ),
    identity_verification_data:
      userData.verification_data.identity_verification_data,
  },
  total_points_earned: ccc.numFrom(userData.total_points_earned),
  last_activity_timestamp: ccc.numFrom(userData.last_activity_timestamp),
  submission_records: userData.submission_records.map((record) => ({
    campaign_type_id: ccc.hexFrom(record.campaign_type_id),
    quest_id: ccc.numFrom(record.quest_id),
    submission_timestamp: ccc.numFrom(record.submission_timestamp),
    submission_content: record.submission_content,
  })),
  profile_data: userData.profile_data.map((entry) => ccc.hexFrom(entry)),
  last_bonus_streak_at: ccc.numFrom(userData.last_bonus_streak_at),
});

const fetchUserPointsCell = async (
  client: ccc.Client,
  pointsTypeScript: ccc.Script,
  userLockScript: ccc.Script
): Promise<ccc.Cell | undefined> => {
  const searchKey = {
    script: pointsTypeScript,
    scriptType: "type" as const,
    scriptSearchMode: "exact" as const,
    filter: {
      script: userLockScript,
    },
    withData: true,
  };

  const iterator = client.findCells(searchKey);
  const { value } = await iterator.next();
  return value ?? undefined;
};

export const buildStreakBonusTransaction = async ({
  signer,
  calculation,
  protocolCell,
}: {
  signer: ccc.Signer;
  calculation: BonusStreakCalculation;
  protocolCell: ccc.Cell;
}): Promise<ccc.Transaction> => {
  if (!calculation.eligible) {
    throw new Error("Streak bonus is not currently eligible.");
  }
  if (!calculation.updatedLastBonusTimestamp) {
    throw new Error("Missing updated last bonus timestamp in calculation.");
  }

  const client = signer.client;
  const network = deploymentManager.getCurrentNetwork();

  const protocolTypeScript = protocolCell.cellOutput.type;
  if (!protocolTypeScript) {
    throw new Error("Protocol cell is missing a type script.");
  }
  const protocolTypeHash = protocolTypeScript.hash();

  const userTypeCodeHash = deploymentManager.getContractCodeHash(
    network,
    "ckboostUserType"
  );
  if (!userTypeCodeHash) {
    throw new Error("User type contract not configured.");
  }

  const pointsCodeHash = deploymentManager.getContractCodeHash(
    network,
    "ckboostPointsUdt"
  );
  if (!pointsCodeHash) {
    throw new Error("Points UDT contract not configured.");
  }

  const pointsTypeScript = ccc.Script.from({
    codeHash: pointsCodeHash,
    hashType: "type" as ccc.HashType,
    args: protocolTypeHash,
  });

  const recommended = await signer.getRecommendedAddressObj();
  const userAddress = await signer.getRecommendedAddress();

  const userCell = await getLatestUserCellByAddress(
    userAddress,
    client,
    userTypeCodeHash,
    ccc.hexFrom(protocolTypeHash)
  );

  if (!userCell) {
    throw new Error("User cell not found for streak bonus claim.");
  }

  const userData = parseUserData(userCell);
  if (!userData) {
    throw new Error("Unable to parse user data from user cell.");
  }

  const previousLastBonus = ccc
    .numFrom(userData.last_bonus_streak_at ?? 0n)
    .toString();
  if (previousLastBonus !== calculation.lastBonusTimestamp) {
    throw new Error(
      "User cell last bonus timestamp does not match calculation. Refresh streak bonus data and retry."
    );
  }

  const pointsCell = await fetchUserPointsCell(
    client,
    pointsTypeScript,
    recommended.script
  );

  if (!pointsCell) {
    throw new Error("Points UDT cell not found for streak bonus claim.");
  }

  const bonusAmount = BigInt(calculation.bonusAmount);
  if (bonusAmount <= 0n) {
    throw new Error("Calculated bonus amount must be positive.");
  }

  const currentPointsBalance = readUdtAmount(pointsCell.outputData);
  const updatedPointsBalance = currentPointsBalance + bonusAmount;

  const userDataLike = cloneUserData(userData);
  userDataLike.total_points_earned = ccc.numFrom(
    ccc.numFrom(userDataLike.total_points_earned) + bonusAmount
  );
  userDataLike.last_bonus_streak_at = ccc.numFrom(
    BigInt(calculation.updatedLastBonusTimestamp)
  );
  userDataLike.last_activity_timestamp = ccc.numFrom(Date.now());

  const updatedUserDataHex = ccc.hexFrom(UserData.encode(userDataLike));
  const updatedPointsDataHex = ccc.hexFrom(
    ccc.numToBytes(updatedPointsBalance, 16)
  );

  const tx = ccc.Transaction.from({});

  await tx.addInput(userCell);
  await tx.addInput(pointsCell);

  const userOutput = ccc.CellOutput.from({
    capacity: userCell.cellOutput.capacity,
    lock: userCell.cellOutput.lock,
    type: userCell.cellOutput.type,
  });
  await tx.addOutput(userOutput, updatedUserDataHex);

  const pointsOutput = ccc.CellOutput.from({
    capacity: pointsCell.cellOutput.capacity,
    lock: pointsCell.cellOutput.lock,
    type: pointsCell.cellOutput.type,
  });
  await tx.addOutput(pointsOutput, updatedPointsDataHex);

  await injectProxyAuthenticationCell(signer, tx);

  for (const name of [
    "ckboostUserType",
    "ckboostPointsUdt",
    "ckboostProtocolType",
    "ckboostProtocolLock",
  ] as const) {
    const outPoint = deploymentManager.getContractOutPoint(network, name);
    if (outPoint) {
      tx.addCellDeps({
        outPoint: { txHash: outPoint.txHash, index: outPoint.index },
        depType: "code",
      });
    }
  }

  tx.addCellDeps({
    outPoint: protocolCell.outPoint,
    depType: "code",
  });

  await tx.completeInputsByCapacity(signer);

  for (let i = 0; i < tx.inputs.length; i += 1) {
    const inputCell = await signer.client.getCell(tx.inputs[i].previousOutput);
    if (!inputCell) {
      throw new Error("Input cell not found while preparing streak bonus tx.");
    }
    tx.inputs[i] = ccc.CellInput.from({
      previousOutput: inputCell.outPoint,
      since: tx.inputs[i].since ?? "0x0",
      cellOutput: inputCell.cellOutput,
      outputData: inputCell.outputData,
    });
  }

  for (let i = 0; i < tx.outputs.length; i += 1) {
    const out = tx.outputs[i];
    if (out.type) {
      tx.outputs[i] = ccc.CellOutput.from(
        { lock: out.lock, type: out.type },
        tx.outputsData[i] as ccc.HexLike
      );
    }
  }

  await tx.completeFeeBy(signer);

  return tx;
};
