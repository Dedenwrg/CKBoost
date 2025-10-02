import type { Handler } from "@netlify/functions";
import { AuthDataValidator } from "@telegram-auth/server";
import type { AuthDataMap, TelegramUserData } from "@telegram-auth/server";
import { ccc } from "@ckb-ccc/shell";
import { deploymentManager } from "@/lib/ckb/deployment-manager";
import { UserData } from "ssri-ckboost/types";
import { VerificationDataEntries } from "@/lib/types/verify";
import { TelegramVerificationData } from "../../lib/types/verify";
import { log } from "console";

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
  const log = (...args: unknown[]) =>
    console.log(`[telegram-authenticate][${reqId}]`, ...args);
  const mask = (val?: string | number | null) => {
    if (val === undefined || val === null) return val;
    const s = String(val);
    if (s.length <= 8) return s;
    return `${s.slice(0, 6)}…${s.slice(-4)}`;
  };

  log("request", {
    method: event.httpMethod,
    path: event.path,
    query: event.rawQuery || event.queryStringParameters,
  });

  log("JSON Body", event.body);
  // Support GET to expose authenticator lock script (public info)
  // if (event.httpMethod === "GET") {
  //   try {
  //     const serverKey = process.env.TELEGRAM_AUTH_PRIVATE_KEY as
  //       | Hex
  //       | undefined;
  //     const rpcUrl =
  //       process.env.NEXT_PUBLIC_CKB_RPC_URL || "https://testnet.ckb.dev";
  //     if (!serverKey) {
  //       log("config_error_get", { hasServerKey: !!serverKey });
  //       return {
  //         statusCode: 500,
  //         headers: { "Content-Type": "application/json" },
  //         body: JSON.stringify({
  //           success: false,
  //           error: "missing_private_key",
  //         }),
  //       };
  //     }
  //     const client = new ccc.ClientPublicTestnet({ url: rpcUrl });
  //     const signer = new ccc.SignerCkbPrivateKey(client, serverKey as ccc.Hex);
  //     const addrObj = await signer.getRecommendedAddressObj();
  //     const script = addrObj.script;
  //     const address = await signer.getRecommendedAddress();
  //     log("authenticator_info", {
  //       addressPreview: address.slice(0, 10) + "...",
  //     });
  //     return {
  //       statusCode: 200,
  //       headers: { "Content-Type": "application/json" },
  //       body: JSON.stringify({
  //         success: true,
  //         address,
  //         script: {
  //           codeHash: script.codeHash,
  //           hashType: script.hashType,
  //           args: script.args,
  //         } as ccc.ScriptLike,
  //       }),
  //     };
  //   } catch (e) {
  //     log("get_error", { message: (e as Error)?.message });
  //     return {
  //       statusCode: 500,
  //       body: JSON.stringify({ success: false, error: "internal_error" }),
  //     };
  //   }
  // }

  if (event.httpMethod !== "POST") {
    log("method_not_allowed");
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      log("config_error", { botTokenPresent: !!botToken });
      return { statusCode: 500, body: "Missing TELEGRAM_BOT_TOKEN" };
    }

    let tx;
    try {
      tx = ccc.Transaction.fromBytes(event.body as ccc.Hex);
    } catch (e) {
      log("body_parse_error", { message: (e as Error)?.message });
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, error: "invalid_json" }),
      };
    }

    if (!tx) {
      log("missing_tx");
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: "missing_tx" }),
      };
    }

    // Derive authenticator lock to locate the data cell
    const serverKey = process.env.TELEGRAM_AUTH_PRIVATE_KEY as Hex | undefined;
    const rpcUrl =
      process.env.NEXT_PUBLIC_CKB_RPC_URL || "https://testnet.ckb.dev";
    if (!serverKey) {
      log("config_error_post", { hasServerKey: !!serverKey });
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
      log("auth_output_not_found");
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: "auth_output_missing" }),
      };
    }
    const rawData = tx.outputsData?.[userCellOutputIndex] as
      | ccc.Hex
      | undefined;
    if (!rawData || rawData === "0x") {
      log("auth_output_empty_data", { userCellOutputIndex });
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
      log("user_verification_data_array_string", s);
      userVerificationDataArray = JSON.parse(s) as VerificationDataEntries[];
      log(
        "user_verification_data_array",
        JSON.stringify(userVerificationDataArray)
      );
    } catch (e) {
      log("auth_output_data_parse_error", { message: (e as Error)?.message });
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
        log("validating verification data", {
          source: verificationData.source,
          data: verificationData.data,
        });
        switch (verificationData.source) {
          case "telegram":
            await validateTelegramAuth(
              verificationData.data as TelegramVerificationData
            );
            break;
          default:
            throw new Error(
              `Unsupported verification source: ${verificationData.source}`
            );
        }
      }
    } catch (e) {
      const err = e as Error;
      log("validator_error", {
        message: err?.message,
        type: err?.name,
      });
      invalidated = true;
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: "invalid_telegram_auth",
        }),
      };
    }
    log("invalidated", invalidated);
    if (!invalidated) {
      throw new Error("invalid_telegram_auth");
    } else {
      log("validated_success");
      let proxyAuthenticatedTx: ccc.Transaction | undefined;

      // Compute tx hash and sign with authenticator key (attestation)
      try {
        proxyAuthenticatedTx = await serverSigner.signTransaction(tx);
        log("proxy_authenticated_tx");
      } catch (e) {
        log("signing_error", { message: (e as Error)?.message });
        // Still return validation success if signing fails
      }

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: true, proxyAuthenticatedTx }),
      };
    }
  } catch (err) {
    const e = err as Error;
    log("unhandled_error", {
      message: e?.message,
      stack: e?.stack?.split("\n").slice(0, 3).join(" | "),
    });
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, error: "invalid_telegram_auth" }),
    };
  }
};

async function validateTelegramAuth(
  telegramVerificationData: TelegramVerificationData
) {
  // Build AuthDataMap for validator from embedded data
  const auth_date_raw = telegramVerificationData.auth_date as
    | string
    | number
    | undefined;
  const auth_date_num =
    auth_date_raw !== undefined ? Number(auth_date_raw) : undefined;
  const now = Math.floor(Date.now() / 1000);
  const disableTtl = process.env.TELEGRAM_AUTH_DISABLE_TTL === "true";
  const ttl = disableTtl
    ? Number.MAX_SAFE_INTEGER
    : Number(process.env.TELEGRAM_AUTH_TTL_SEC || 600);
  const dataAge = auth_date_num !== undefined ? now - auth_date_num : undefined;

  const dataMap: AuthDataMap = new Map<string, string | number>();
  try {
    dataMap.set("id", telegramVerificationData.id);
    dataMap.set("username", telegramVerificationData.username || "");
    dataMap.set("first_name", telegramVerificationData.first_name || "");
    dataMap.set("last_name", telegramVerificationData.last_name || "");
    dataMap.set("photo_url", telegramVerificationData.photo_url || "");
    dataMap.set("auth_date", auth_date_num || 0);
    dataMap.set("hash", telegramVerificationData.hash);
  } catch (e) {
    const err = e as Error;
    log("validator_error", {
      message: err?.message,
      type: err?.name,
    });
    throw err;
  }

  const validator = new AuthDataValidator({
    botToken: process.env.TELEGRAM_BOT_TOKEN as string,
    // inValidateDataAfter: ttl,
  });
  let user: TelegramUserData & { auth_date?: number | string };
  try {
    user = await validator.validate<
      TelegramUserData & { auth_date?: number | string }
    >(dataMap);
  } catch (e) {
    const err = e as Error;
    log("validator_error", {
      message: err?.message,
      type: err?.name,
      dataMapKeys: Array.from(dataMap.keys()),
      hasHash: dataMap.has("hash"),
      hasAuthDate: dataMap.has("auth_date"),
      authDate: auth_date_num,
      dataAge,
      ttl,
    });
    throw err;
  }
}

export default handler;
