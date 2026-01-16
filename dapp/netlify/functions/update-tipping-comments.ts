import type { Handler } from "@netlify/functions";
import { createLogger } from "../lib/log";
import {
  SimplePool,
  Event,
  nip19,
  getPublicKey,
  finalizeEvent,
} from "nostr-tools";
import { WebSocket } from "ws";
import { createHmac, createHash } from "crypto";
import { ccc } from "@ckb-ccc/shell";
import { deploymentManager } from "@/lib/ckb/deployment-manager";
import { ProtocolData } from "ssri-ckboost/types";
import {
  createClient,
  fetchProtocolCell,
  verifyPlatformAdmin,
} from "../lib/utils";
import { signerFromSignature } from "../lib/signature";
import { DEFAULT_NOSTR_RELAYS } from "../configs/nostr";
import {
  createReplaceableEvent,
  defaultPool,
  derivePrivateKey,
  updateReplaceableEvent,
} from "../lib/comments";
import { fetchReplaceableEvent } from "../lib/nostr";

if (!global.WebSocket) {
  // @ts-expect-error WebSocket polyfill
  global.WebSocket = WebSocket;
}

const logger = createLogger("update-tipping-comments");

type Action = "add" | "delete" | "blacklist" | "initialize";

type NostrComment = {
  neventId: string;
  senderAddress: string;
};

type commentListData = {
  comments: NostrComment[];
  blacklistedSenders: string[];
};

const handleInitialize = async ({
  dTag,
  privateKey,
  pubkey,
}: {
  dTag: string;
  privateKey: Uint8Array;
  pubkey: string;
}) => {
  console.log("initialize action");
  const storedCommentListEvent = await createReplaceableEvent(
    dTag,
    JSON.stringify({ comments: [], blacklistedSenders: [] }),
    [["client", "ckboost-dapp"]],
    privateKey,
    pubkey,
    30078
  );
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      success: true,
      action: "initialize",
      authorPubkey: storedCommentListEvent.pubkey,
      dTag: dTag,
    }),
  };
};

const handleAdd = async ({
  commentNeventId,
  senderAddress,
  senderLockHash,
  commentListNevent,
  privateKey,
  pubkey,
}: {
  commentNeventId: string;
  senderAddress: string;
  senderLockHash: string;
  commentListNevent: Event;
  privateKey: Uint8Array;
  pubkey: string;
}) => {
  logger.info("Entered handleAdd", {
    commentNeventId,
    senderAddress,
    senderLockHash,
    commentListNevent,
  });
  if (!commentNeventId) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "Missing required field: commentNeventId",
      }),
    };
  }

  const existingCommentListData = JSON.parse(
    commentListNevent.content
  ) as commentListData;

  logger.info("Existing comment list data", { existingCommentListData });

  if (
    senderLockHash &&
    existingCommentListData.blacklistedSenders.includes(senderLockHash)
  ) {
    return {
      statusCode: 403,
      body: JSON.stringify({
        error: "Forbidden",
        message: "Sender is blacklisted and cannot add comments",
      }),
    };
  }

  const newComment: NostrComment = {
    neventId: commentNeventId,
    senderAddress: senderAddress,
  };

  if (
    commentNeventId &&
    !existingCommentListData.comments.includes(newComment)
  ) {
    existingCommentListData.comments.push(newComment);
  }

  try {
    await updateReplaceableEvent(
      commentListNevent,
      JSON.stringify(existingCommentListData),
      privateKey,
      pubkey
    );
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    logger.error("Failed to update comments list event", { error });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to update comments list event" }),
    };
  }
};

const handleDelete = async ({
  commentNeventId,
  commentListNevent,
  privateKey,
  pubkey,
}: {
  commentNeventId: string;
  commentListNevent: Event;
  privateKey: Uint8Array;
  pubkey: string;
}) => {
  if (!commentNeventId) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "Missing required field: commentNeventId for delete operation",
      }),
    };
  }

  const existingCommentListData = JSON.parse(
    commentListNevent.content
  ) as commentListData;

  existingCommentListData.comments = existingCommentListData.comments.filter(
    (comment) => comment.neventId !== commentNeventId
  );

  await updateReplaceableEvent(
    commentListNevent,
    JSON.stringify(existingCommentListData),
    privateKey,
    pubkey
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true }),
  };
};

const handleBlacklist = async ({
  targetSenderAddress,
  privateKey,
  pubkey,
  commentListNevent,
}: {
  targetSenderAddress: string;
  privateKey: Uint8Array;
  pubkey: string;
  commentListNevent: Event;
}) => {
  if (!targetSenderAddress) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error:
          "Missing required field: targetSenderAddress for blacklist operation",
      }),
    };
  }

  const existingCommentListData = JSON.parse(
    commentListNevent.content
  ) as commentListData;

  if (
    !existingCommentListData.blacklistedSenders.includes(targetSenderAddress)
  ) {
    existingCommentListData.blacklistedSenders.push(targetSenderAddress);
  }

  await updateReplaceableEvent(
    commentListNevent,
    JSON.stringify(existingCommentListData),
    privateKey,
    pubkey
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true }),
  };
};

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  try {
    const tippingPrivateKey = process.env.NETLIFY_API_AUTHENTICATOR_PRIVATE_KEY;
    const seed = tippingPrivateKey
      ? createHash("sha256").update(tippingPrivateKey).digest("hex")
      : undefined;
    if (!seed) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Server configuration error",
          message:
            "Missing NETLIFY_API_AUTHENTICATOR_PRIVATE_KEY for deriving tipping seed",
        }),
      };
    }

    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing request body" }),
      };
    }

    const body = JSON.parse(event.body) as {
      action: "add" | "delete" | "blacklist" | "initialize";
      commentNeventId?: string;
      commentListAuthor?: string; // required now for addressing comments list
      message?: string;
      dTag?: string;
      signatureString?: string;
      signatureIdentity?: string;
      signatureSignType?: ccc.SignerSignType;
      targetSenderAddress?: string;
    };

    const {
      action,
      commentNeventId,
      commentListAuthor,
      dTag,
      message,
      signatureString,
      signatureIdentity,
      signatureSignType,
      targetSenderAddress,
    } = body;

    if (!signatureString || !signatureIdentity || !signatureSignType) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error:
            "Missing required fields: signatureString, signatureIdentity, signatureSignType",
        }),
      };
    }

    const signature = new ccc.Signature(
      signatureString,
      signatureIdentity,
      signatureSignType
    );

    const ckbNetwork = deploymentManager.getCurrentNetwork();
    const rpcUrl =
      process.env.NEXT_PUBLIC_CKB_RPC_URL ||
      process.env.CKB_RPC_URL ||
      (ckbNetwork === "mainnet"
        ? "https://mainnet.ckb.dev"
        : "https://testnet.ckb.dev");
    const client = createClient(ckbNetwork, rpcUrl);
    logger.info("Starting to get sender signer");
    const senderSigner = await signerFromSignature(client, signature, message);
    if (!senderSigner) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: "Invalid signature" }),
      };
    }
    const senderAddress = await senderSigner.getRecommendedAddress();
    const senderLockHash: ccc.Hex = (
      await senderSigner.getRecommendedAddressObj()
    ).script.hash();
    if (!senderLockHash) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid sender address" }),
      };
    }
    logger.info("Checking if sender is platform admin");
    if (action === "delete" || action === "blacklist") {
      const isPlatformAdmin = await verifyPlatformAdmin(senderLockHash, client);
      if (!isPlatformAdmin) {
        return {
          statusCode: 403,
          body: JSON.stringify({
            error: "Forbidden",
            message: "Only platform admins can perform this operation",
          }),
        };
      }
    }

    if (action != "initialize" && (!commentListAuthor || !dTag)) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error:
            "Missing required field: commentListAuthor or dTag for non-initialize action",
        }),
      };
    }

    const seedInput = `UPDATE_TIPPING_COMMENTS:${dTag}`;
    const privateKey = derivePrivateKey(seed, seedInput);
    const pubkey = getPublicKey(privateKey);

    logger.info("Fetching comment list event", { commentListAuthor, dTag });
    const commentListNevent =
      commentListAuthor && dTag
        ? await fetchReplaceableEvent(defaultPool, commentListAuthor, dTag)
        : null;

    logger.info("Going to switch on action", { action });
    try {
      switch (action) {
        case "initialize":
          if (!dTag) {
            return {
              statusCode: 400,
              body: JSON.stringify({
                error: "Missing required field: dTag for initialize action",
              }),
            };
          }
          return await handleInitialize({ dTag, privateKey, pubkey });
        case "add":
          if (!commentNeventId || !commentListNevent) {
            return {
              statusCode: 400,
              body: JSON.stringify({
                error: "Missing required field: commentNeventId for add action",
              }),
            };
          }
          return await handleAdd({
            commentNeventId,
            senderAddress,
            senderLockHash,
            commentListNevent,
            privateKey,
            pubkey,
          });
        case "delete":
          if (!commentNeventId || !commentListNevent) {
            return {
              statusCode: 400,
              body: JSON.stringify({
                error:
                  "Missing required field: commentNeventId for delete action",
              }),
            };
          }
          return await handleDelete({
            commentNeventId,
            commentListNevent,
            privateKey,
            pubkey,
          });
        case "blacklist":
          if (!targetSenderAddress || !commentListNevent) {
            return {
              statusCode: 400,
              body: JSON.stringify({
                error:
                  "Missing required field: targetSenderAddress for blacklist action",
              }),
            };
          }
          return await handleBlacklist({
            targetSenderAddress,
            privateKey,
            pubkey,
            commentListNevent,
          });
        default:
          return {
            statusCode: 400,
            body: JSON.stringify({ error: "Invalid action" }),
          };
      }
    } finally {
    }
  } catch (error) {
    logger.error("Handler error", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : "Unknown",
      }),
    };
  }
};
