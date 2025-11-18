import type { Handler } from "@netlify/functions";
import { AuthDataValidator } from "@telegram-auth/server";
import type { TelegramUserData } from "@telegram-auth/server";
import { urlStrToAuthDataMap } from "@telegram-auth/server/utils";
import { ccc } from "@ckb-ccc/shell";
import { deploymentManager } from "@/lib/ckb/deployment-manager";
import { UserData } from "ssri-ckboost/types";
import { VerificationDataEntries } from "@/lib/types/identity";
import { TelegramVerificationData } from "../../lib/types/identity";
import { bytesFrom } from "../../../../ccc/packages/core/src/bytes/index";
import { stringify } from "../../../../ccc/packages/core/src/utils/index";
import { createLogger } from "@/netlify/lib/log";

const validatorLogger = createLogger("telegram-authenticate:validate");

// Types for safer payload handling
type Hex = string;

type HashType = "data" | "type" | "data1";

// The JSON stored in the authenticator output's data
interface TelegramAuthCellData {
  kind: "ckboost/telegram_auth";
  chat_id: string; // string to avoid bigint JSON issues
  username: string;
  auth: Record<string, string | number | undefined>;
  wallet_lock_hash?: string;
  user_type_id?: string;
  timestamp?: number;
}

export const handler: Handler = async (event) => {
  const reqId = Math.random().toString(36).slice(2, 8);
  const isDev =
    process.env.NETLIFY_DEV === "true" || process.env.NODE_ENV !== "production";
  const logger = createLogger(`telegram-authenticate:${reqId}`);
  const mask = (val?: string | number | null) => {
    if (val === undefined || val === null) return val;
    const s = String(val);
    if (s.length <= 8) return s;
    return `${s.slice(0, 6)}…${s.slice(-4)}`;
  };

  logger.info("request", {
    method: event.httpMethod,
    path: event.path,
    query: event.rawQuery || event.queryStringParameters,
  });

  logger.log("JSON Body", event.body);

  if (event.httpMethod !== "POST") {
    logger.warn("method_not_allowed");
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      logger.error("config_error", { botTokenPresent: !!botToken });
      return { statusCode: 500, body: "Missing TELEGRAM_BOT_TOKEN" };
    }

    let tx;
    try {
      tx = ccc.Transaction.fromBytes(event.body as ccc.Hex);
    } catch (e) {
      logger.error("body_parse_error", { message: (e as Error)?.message });
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, error: "invalid_json" }),
      };
    }

    if (!tx) {
      logger.error("missing_tx");
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: "missing_tx" }),
      };
    }

    // Derive authenticator lock to locate the data cell
    const serverKey = process.env.NETLIFY_API_AUTHENTICATOR_PRIVATE_KEY as
      | Hex
      | undefined;
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

    const network = deploymentManager.getCurrentNetwork();
    const userCellCodeHash = deploymentManager.getContractCodeHash(
      network,
      "ckboostUserType"
    );
    // Find the user cell and parse its data
    const userCellOutputIndex = tx.outputs?.findIndex(
      (o) =>
        o.type?.codeHash === userCellCodeHash && o.type?.hashType === "type"
    );
    if (userCellOutputIndex === -1) {
      logger.error("auth_output_not_found");
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: "auth_output_missing" }),
      };
    }
    const rawData = tx.outputsData?.[userCellOutputIndex] as
      | ccc.Hex
      | undefined;
    if (!rawData || rawData === "0x") {
      logger.error("auth_output_empty_data", { userCellOutputIndex });
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: "auth_output_empty_data",
        }),
      };
    }

    // Decode JSON from hex
    let userData;
    let userVerificationDataArray: VerificationDataEntries[];
    try {
      userData = UserData.decode(rawData);
      const userVerificationDataArrayHex =
        userData.verification_data.identity_verification_data;
      const bytes = ccc.bytesFrom(userVerificationDataArrayHex);
      const s = Buffer.from(bytes).toString("utf8");
      logger.log("user_verification_data_array_string", s);
      userVerificationDataArray = JSON.parse(s) as VerificationDataEntries[];
      logger.log(
        "user_verification_data_array",
        JSON.stringify(userVerificationDataArray)
      );
    } catch (e) {
      logger.error("auth_output_data_parse_error", { message: (e as Error)?.message });
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: "invalid_auth_output_data",
        }),
      };
    }
    let invalidated = false;
    try {
      for (const verificationData of userVerificationDataArray) {
        logger.info("validating verification data", {
          source: verificationData.source,
          data: verificationData.data,
        });
        switch (verificationData.source) {
          case "telegram":
            const telegramVerificationData =
              verificationData.data as TelegramVerificationData;
            const url = `https://feature-identity-verification--ckboost.netlify.app/identity?id=${telegramVerificationData.id}&first_name=${telegramVerificationData.first_name}&username=${telegramVerificationData.username}&photo_url=${telegramVerificationData.photo_url}&auth_date=${telegramVerificationData.auth_date}&hash=${telegramVerificationData.hash}`;
            await validateTelegramAuth(url);
            break;
          default:
            throw new Error(
              `Unsupported verification source: ${verificationData.source}`
            );
        }
      }
    } catch (e) {
      const err = e as Error;
      logger.error("validator_router_error", {
        message: err?.message,
        type: err?.name,
      });
      invalidated = true;
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: "validator_router_error",
          message: err?.message,
        }),
      };
    }
    logger.info("invalidated", invalidated);
    if (invalidated) {
      throw new Error("invalidated_error");
    } else {
      logger.info("validated_success");
      let proxyAuthenticatedTx: ccc.Transaction | undefined;
      const { script: proxyAdminLockScript } =
        await serverSigner.getAddressObjSecp256k1();

      let proxyAdminInputCell: ccc.Cell | undefined;
      let proxyAdminInputIndex = -1;

      for (let i = 0; i < tx.inputs.length; i += 1) {
        const input = tx.inputs[i];
        const previousOutput = input.previousOutput;
        if (!previousOutput) {
          continue;
        }
        const resolvedCell = await client.getCell(previousOutput);
        if (!resolvedCell) {
          logger.error("input_cell_not_found", {
            inputIndex: i,
            previousOutput: ccc.stringify(previousOutput),
          });
          return {
            statusCode: 400,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              success: false,
              error: "proxy_input_not_found",
            }),
          };
        }
        if (
          !resolvedCell.cellOutput.type &&
          resolvedCell.cellOutput.lock.eq(proxyAdminLockScript)
        ) {
          proxyAdminInputCell = resolvedCell;
          proxyAdminInputIndex = i;
          break;
        }
      }

      if (!proxyAdminInputCell) {
        logger.error("proxy_input_cell_missing", {
          totalInputs: tx.inputs.length,
        });
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            success: false,
            error: "proxy_input_missing",
          }),
        };
      }

      const proxyAdminInputCapacity = ccc.numFrom(
        proxyAdminInputCell.cellOutput.capacity
      );
      const proxyAdminOutputIndex = tx.outputs.findIndex(
        (output) =>
          !output.type &&
          output.lock.eq(proxyAdminLockScript) &&
          ccc.numFrom(output.capacity) === proxyAdminInputCapacity
      );

      if (proxyAdminOutputIndex === -1) {
        logger.error("proxy_output_cell_missing", {
          proxyAdminInputIndex,
          proxyAdminInputCapacity: proxyAdminInputCapacity.toString(),
        });
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            success: false,
            error: "proxy_output_missing",
          }),
        };
      }

      logger.info("proxy_cell_verified", {
        proxyAdminInputIndex,
        proxyAdminOutputIndex,
        capacity: proxyAdminInputCapacity.toString(),
      });

      // Compute tx hash and sign with authenticator key (attestation)
      try {
        logger.info("Before signing for proxy authentication", ccc.stringify(tx));
        proxyAuthenticatedTx = await serverSigner.signTransaction(tx);
        logger.log("proxy_authenticated_tx", ccc.stringify(proxyAuthenticatedTx));
      } catch (e) {
        logger.error("signing_error", { message: (e as Error)?.message });
        // Still return validation success if signing fails
      }

      if (!proxyAuthenticatedTx) {
        throw new Error("signing_error_no_tx");
      }

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          success: true,
          txHex: ccc.hexFrom(proxyAuthenticatedTx?.toBytes()),
        }),
      };
    }
  } catch (err) {
    const e = err as Error;
    logger.error("unhandled_error", {
      message: e?.message,
      stack: e?.stack?.split("\n").slice(0, 3).join(" | "),
    });
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, error: "authentication_error" }),
    };
  }
};

async function validateTelegramAuth(url: string) {
  const validator = new AuthDataValidator({
    botToken: process.env.TELEGRAM_BOT_TOKEN as string,
    // inValidateDataAfter: ttl,
  });
  let user: TelegramUserData & { auth_date?: number | string };
  validatorLogger.info("url", url);
  const data = urlStrToAuthDataMap(url);
  try {
    user = await validator.validate(data);
    validatorLogger.info("validated user", user);
  } catch (e) {
    const err = e as Error;
    validatorLogger.error("validateTelegramAuth", {
      message: err?.message,
      type: err?.name,
      dataMapKeys: Array.from(data.keys()),
      hasHash: data.has("hash"),
      hasAuthDate: data.has("auth_date"),
      authDate: data.get("auth_date"),
      dataAge: data.get("data_age"),
      ttl: data.get("ttl"),
    });
    throw err;
  }
}

export default handler;
