import type { Handler } from "@netlify/functions";
import { createLogger } from "@/netlify/lib/log";

const EXPLORER_ENDPOINT =
  "https://testnet-api.explorer.nervos.org/api/v1/suggest_queries";

const logger = createLogger("resolve-lock-script");

export const handler: Handler = async (event) => {
  const hash = event.queryStringParameters?.hash;

  if (!hash) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing hash parameter" }),
      headers: {
        "Content-Type": "application/json",
      },
    };
  }

  try {
    const url = new URL(EXPLORER_ENDPOINT);
    url.searchParams.set("q", hash);
    url.searchParams.set("filter_by", "0");

    const response = await fetch(url.toString(), {
      headers: {
        accept: "application/vnd.api+json",
        "accept-language": "en-GB,en;q=0.7",
        "content-type": "application/vnd.api+json",
        origin: "https://testnet.explorer.nervos.org",
        priority: "u=1, i",
        referer: "https://testnet.explorer.nervos.org/",
        "sec-ch-ua":
          '"Chromium";v="140", "Not=A?Brand";v="24", "Brave";v="140"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
        "sec-gpc": "1",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: "Failed to resolve lock script",
          status: response.status,
        }),
        headers: {
          "Content-Type": "application/json",
        },
      };
    }

    const json = (await response.json()) as {
      data?: Array<{
        attributes?: {
          lock_script?: {
            args: string;
            code_hash: string;
            hash_type: "data" | "type" | "data1";
          };
        };
      }>;
    };

    const lockScript = json.data?.[0]?.attributes?.lock_script;
    if (!lockScript) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: "Lock script not found for provided hash",
        }),
        headers: {
          "Content-Type": "application/json",
        },
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify(lockScript),
      headers: {
        "Content-Type": "application/json",
      },
    };
  } catch (error) {
    logger.error("Failed to resolve lock script", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Unexpected error resolving lock script" }),
      headers: {
        "Content-Type": "application/json",
      },
    };
  }
};
