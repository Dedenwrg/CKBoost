import type { Handler } from "@netlify/functions";
import { ccc } from "@ckb-ccc/shell";
import { deploymentManager, type Network } from "@/lib/ckb/deployment-manager";
import { getGrantableAchievements } from "@/netlify/lib/utils";
import { AchievementDataLike, AchievementDataVec } from "ssri-ckboost/types";
import { getProtocolTypeScript } from "@/netlify/lib/utils";
import { getLatestUserCellByLock } from "@/netlify/lib/utils";
import { createLogger, log } from "@/netlify/lib/log";

export const handler: Handler = async (event) => {
  const reqId = Math.random().toString(36).slice(2, 8);
  const logger = createLogger(`achievement-validate:${reqId}`);
  logger.info("Achievement validate handler");
  logger.log("event", event);
  const serverKey = process.env.NETLIFY_API_AUTHENTICATOR_PRIVATE_KEY;
  if (!serverKey) {
    throw new Error("Missing ACHIEVEMENT_PROXY_PRIVATE_KEY in environment.");
  }

  const network = deploymentManager.getCurrentNetwork();
  const rpcUrl =
    process.env.NEXT_PUBLIC_CKB_RPC_URL || "https://testnet.ckb.dev";
  const client = createClient(network, rpcUrl);
  const signer = new ccc.SignerCkbPrivateKey(client, serverKey);

  if (event.httpMethod !== "POST") {
    logger.warn("method_not_allowed");
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    if (!event.body) {
      throw new Error("Missing request body.");
    }

    let payload: { txHex: string; userAddress: string };
    try {
      payload = JSON.parse(event.body) as {
        txHex: string;
        userAddress: string;
      };
    } catch (error) {
      throw new Error(`Invalid JSON payload: ${(error as Error).message}`);
    }

    const txHex = payload.txHex;
    const userAddress = payload.userAddress;

    if (!txHex || typeof txHex !== "string") {
      throw new Error("Expected string field 'txHex'.");
    }
    if (!userAddress || typeof userAddress !== "string") {
      throw new Error("Expected string field 'userAddress'.");
    }

    let tx: ccc.Transaction;
    try {
      tx = ccc.Transaction.fromBytes(txHex);
      for (let i = 0; i < tx.inputs.length; i++) {
        const inputCell = await signer.client.getCell(
          tx.inputs[i].previousOutput
        );
        if (!inputCell) {
          throw new Error("Input cell not found");
        }
        tx.inputs[i] = ccc.CellInput.from({
          previousOutput: inputCell?.outPoint,
          since: "0x0",
          cellOutput: inputCell?.cellOutput,
          outputData: inputCell?.outputData,
        });
      }

      for (let i = 0; i < tx.outputs.length; i++) {
        const out = tx.outputs[i];
        if (out.type) {
          tx.outputs[i] = ccc.CellOutput.from(
            { lock: out.lock, type: out.type },
            tx.outputsData[i] as ccc.HexLike
          );
        }
      }
      logger.log("tx", ccc.stringify(tx));
    } catch (error) {
      throw new Error(
        `Failed to parse transaction bytes: ${(error as Error).message}`
      );
    }

    const userTypeCodeHash = deploymentManager.getContractCodeHash(
      network,
      "ckboostUserType"
    );
    if (!userTypeCodeHash) {
      throw new Error("User type code hash not found.");
    }
    const addressObj = await ccc.Address.fromString(userAddress, signer.client);
    const addressLockScript = addressObj.script;

    const protocolTypeScript = ccc.Script.from(getProtocolTypeScript());

    // Resolve on-chain user cell using lock hash + type script for additional certainty.
    const userCell = await getLatestUserCellByLock(
      addressLockScript,
      userTypeCodeHash,
      signer,
      protocolTypeScript.hash()
    );
    if (!userCell) {
      throw new Error("User cell not found.");
    }
    const achievementTypeCodeHash = deploymentManager.getContractCodeHash(
      network,
      "ckboostAchievementType"
    );

    if (!userTypeCodeHash || !achievementTypeCodeHash) {
      throw new Error(
        "Missing deployment configuration for user or achievement type."
      );
    }

    const grantableAchievements = await getGrantableAchievements(
      signer,
      userAddress,
      achievementTypeCodeHash
    );
    if (
      !validateAchievementClaims(
        tx,
        grantableAchievements,
        userCell,
        achievementTypeCodeHash
      )
    ) {
      throw new Error("Achievement claims not valid.");
    }

    logger.log("Validated Tx Before Signing", ccc.stringify(tx));
    const signedTx = await signer.signTransaction(tx);

    logger.log("signedTx", ccc.stringify(signedTx));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        txHex: ccc.hexFrom(signedTx.toBytes()),
        newlyGranted: grantableAchievements,
      }),
    };
  } catch (error) {
    const err = error as Error;
    logger.error("validation_failed", err);
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: false,
        error: "achievement_validation_failed",
        message: err.message,
      }),
    };
  }
};

export default handler;

/**
 * Instantiate a public client for the current network.
 */
const createClient = (network: Network, url: string): ccc.Client => {
  if (network === "mainnet") {
    return new ccc.ClientPublicMainnet({ url });
  }
  return new ccc.ClientPublicTestnet({ url });
};

const validateAchievementClaims = async (
  tx: ccc.Transaction,
  grantableAchievements: string[],
  userCell: ccc.Cell,
  achievementTypeCodeHash: string
): Promise<boolean> => {
  const achievementCellPre = tx.inputs.find(
    (input) => input.cellOutput?.type?.codeHash === achievementTypeCodeHash
  );
  if (!achievementCellPre) {
    log.log("Achievement cell not found.");
    log.log("Inputs", tx.inputs);
    log.log("achievementTypeCodeHash", achievementTypeCodeHash);
    return false;
  }
  try {
    log.log("achievementCellPre", achievementCellPre);
    log.log("achievementCellPre outputData", achievementCellPre?.outputData);
    const achievementDataVecPre = AchievementDataVec.decode(
      ccc.hexFrom(achievementCellPre?.outputData ?? "0x")
    ) as AchievementDataLike[];
    const achievementCellPostIndex = tx.outputs.findIndex(
      (output) => output.type?.codeHash === achievementTypeCodeHash
    );
    const achievementDataVecPost = AchievementDataVec.decode(
      ccc.hexFrom(tx.outputsData[achievementCellPostIndex] ?? "0x")
    ) as AchievementDataLike[];
    if (achievementDataVecPost.length !== achievementDataVecPre.length) {
      log.log("Achievement data vector length mismatch.");
      return false;
    }
    for (const achievementPost of achievementDataVecPost) {
      const matchingAchievementPre = achievementDataVecPre.find(
        (achievementPre) =>
          achievementPre.achievement_title === achievementPost.achievement_title
      );
      if (!matchingAchievementPre) {
        log.log("Matching achievement not found.");
        return false;
      }
      for (const receiver of achievementPost.receiver_user_record_vec) {
        const matchingReceiverPre =
          matchingAchievementPre.receiver_user_record_vec.find(
            (record) =>
              receiver.receiver_user_type_hash ===
              record.receiver_user_type_hash
          );
        if (!matchingReceiverPre) {
          if (
            !grantableAchievements.includes(achievementPost.achievement_title)
          ) {
            log.log("Grantable achievement not found.");
            return false;
          } else {
            log.log(
              "Grantable achievement found: ",
              achievementPost.achievement_title
            );
          }
          if (
            receiver.receiver_user_type_hash !==
            userCell.cellOutput.type?.hash()
          ) {
            log.log("Receiver user type hash mismatch.");
            return false;
          } else {
            log.log(
              "Receiver user type hash matches. Granted achievement: ",
              achievementPost.achievement_title
            );
          }
        }
      }
    }
    return true;
  } catch (error) {
    log.error("Failed to validate achievement claims:", error);
    return false;
  }
};
