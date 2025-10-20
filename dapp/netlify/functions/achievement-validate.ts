import type { Handler } from "@netlify/functions";
import { ccc } from "@ckb-ccc/shell";
import { deploymentManager, type Network } from "@/lib/ckb/deployment-manager";
import {
  getGrantableAchievements,
  type CkbClient,
} from "@/netlify/lib/achievement/utils";

export const handler: Handler = async (event) => {
  const reqId = Math.random().toString(36).slice(2, 8);
  const log = (...args: unknown[]) =>
    console.log(`[achievement-validate][${reqId}]`, ...args);

  if (event.httpMethod !== "POST") {
    log("method_not_allowed");
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    if (!event.body) {
      throw new Error("Missing request body.");
    }

    let payload: { txHex?: string; userAddress?: string };
    try {
      payload = JSON.parse(event.body) as {
        txHex?: string;
        userAddress?: string;
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
    } catch (error) {
      throw new Error(
        `Failed to parse transaction bytes: ${(error as Error).message}`
      );
    }

    const serverKey = process.env.ACHIEVEMENT_PROXY_PRIVATE_KEY;
    if (!serverKey) {
      throw new Error("Missing ACHIEVEMENT_PROXY_PRIVATE_KEY in environment.");
    }

    const network = deploymentManager.getCurrentNetwork();
    const rpcUrl =
      process.env.NEXT_PUBLIC_CKB_RPC_URL || "https://testnet.ckb.dev";
    const client = createClient(network, rpcUrl);
    const signer = new ccc.SignerCkbPrivateKey(client, serverKey);
    const userTypeCodeHash = deploymentManager.getContractCodeHash(
      network,
      "ckboostUserType"
    );
    const achievementTypeCodeHash = deploymentManager.getContractCodeHash(
      network,
      "ckboostAchievementType"
    );

    if (!userTypeCodeHash || !achievementTypeCodeHash) {
      throw new Error(
        "Missing deployment configuration for user or achievement type."
      );
    }

    const evaluation = await getGrantableAchievements({
      tx,
      client,
      userAddress,
      userTypeCodeHash,
      achievementTypeCodeHash,
    });

    const signedTx = await signer.signTransaction(tx);
    const completedCount = evaluation.outputAchievementIds.size;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        txHex: ccc.hexFrom(signedTx.toBytes()),
        completedAchievements: completedCount,
        newlyGranted: evaluation.newAchievementIds,
      }),
    };
  } catch (error) {
    const err = error as Error;
    console.error("[achievement-validate] validation_failed", err);
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
const createClient = (network: Network, url: string): CkbClient => {
  if (network === "mainnet") {
    return new ccc.ClientPublicMainnet({ url });
  }
  return new ccc.ClientPublicTestnet({ url });
};
