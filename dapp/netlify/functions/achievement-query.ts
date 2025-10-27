import type { Handler } from "@netlify/functions";
import { ccc } from "@ckb-ccc/shell";
import { deploymentManager, type Network } from "@/lib/ckb/deployment-manager";
import { getGrantableAchievements } from "@/netlify/lib/utils";
import type { AchievementQueryResponse } from "@/netlify/lib/achievement/types";
import { createLogger } from "@/netlify/lib/log";

export const handler: Handler = async (event) => {
  const reqId = Math.random().toString(36).slice(2, 8);
  const logger = createLogger(`achievement-query:${reqId}`);
  logger.info("Achievement query handler");
  const serverKey = process.env.NETLIFY_API_AUTHENTICATOR_PRIVATE_KEY;
  const rpcUrl =
    process.env.NEXT_PUBLIC_CKB_RPC_URL || "https://testnet.ckb.dev";
  if (!serverKey) {
    logger.error("config_error_post", { hasServerKey: !!serverKey });
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: "missing_private_key" }),
    };
  }
  const client = new ccc.ClientPublicTestnet({ url: rpcUrl });
  const serverSigner = new ccc.SignerCkbPrivateKey(
    client,
    serverKey as ccc.Hex
  );

  if (event.httpMethod !== "POST") {
    logger.warn("method_not_allowed");
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

    const userAddress = payload.userAddress;

    if (!userAddress || typeof userAddress !== "string") {
      throw new Error("Expected string field 'userAddress'.");
    }

    const network = deploymentManager.getCurrentNetwork();
    const rpcUrl =
      process.env.NEXT_PUBLIC_CKB_RPC_URL || "https://testnet.ckb.dev";
    const client = createClient(network, rpcUrl);
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

    const grantableAchievements = await getGrantableAchievements(
      serverSigner,
      userAddress,
      achievementTypeCodeHash
    );

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        grantable: grantableAchievements,
      }),
    };
  } catch (error) {
    const err = error as Error;
    logger.error("validation_failed", err);

    const response: AchievementQueryResponse = {
      success: false,
      error: "achievement_validation_failed",
      message: err.message,
    };

    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(response),
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
