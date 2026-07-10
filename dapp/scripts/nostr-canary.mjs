import { finalizeEvent, getEventHash, verifyEvent } from "nostr-tools";
import { randomBytes } from "node:crypto";
import { WebSocket } from "ws";

const relays = (
  process.env.NOSTR_RELAYS ||
  "wss://relay.damus.io,wss://relay.primal.net,wss://relay.nostr.net,wss://nos.lol"
)
  .split(",")
  .map((relay) => relay.trim())
  .filter(Boolean);
const quorum = Number(process.env.NOSTR_MIN_RELAY_COPIES || 2);
const timeoutMs = Number(process.env.NOSTR_RELAY_TIMEOUT_MS || 5000);
const secretKey = new Uint8Array(randomBytes(32));
const event = finalizeEvent(
  {
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["d", `ckboost-canary-${Date.now()}`],
      ["client", "ckboost-dapp"],
      ["type", "relay-canary"],
    ],
    content: "CKBoost staging relay canary",
  },
  secretKey,
);

const withSocket = (relay, onOpen, onMessage) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(relay);
    let settled = false;
    let timeout;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.close();
      callback(value);
    };
    timeout = setTimeout(() => finish(reject, new Error("timeout")), timeoutMs);
    socket.on("open", () => {
      try {
        onOpen(socket);
      } catch (error) {
        finish(reject, error);
      }
    });
    socket.on("message", (raw) => {
      try {
        onMessage(JSON.parse(String(raw)), (value) => finish(resolve, value));
      } catch (error) {
        finish(reject, error);
      }
    });
    socket.on("error", (error) => finish(reject, error));
  });

const publish = (relay) =>
  withSocket(
    relay,
    (socket) => socket.send(JSON.stringify(["EVENT", event])),
    (message, resolve) => {
      if (message[0] === "OK" && message[1] === event.id) {
        if (message[2]) resolve(true);
        else throw new Error(String(message[3] || "rejected"));
      }
    },
  );

const readBack = (relay) => {
  const subscription = `canary-${Math.random().toString(36).slice(2)}`;
  return withSocket(
    relay,
    (socket) =>
      socket.send(
        JSON.stringify([
          "REQ",
          subscription,
          { ids: [event.id], kinds: [event.kind], limit: 1 },
        ]),
      ),
    (message, resolve) => {
      if (message[0] === "EVENT" && message[1] === subscription) {
        const candidate = message[2];
        if (
          candidate.id === event.id &&
          getEventHash(candidate) === candidate.id &&
          verifyEvent(candidate)
        ) {
          return resolve(true);
        }
        throw new Error("invalid event");
      }
      if (message[0] === "EOSE" && message[1] === subscription) {
        throw new Error("event absent");
      }
    },
  );
};

const results = await Promise.allSettled(
  relays.map(async (relay) => {
    const startedAt = Date.now();
    await publish(relay);
    await readBack(relay);
    return { relay, elapsedMs: Date.now() - startedAt };
  }),
);
const verified = results.flatMap((result) =>
  result.status === "fulfilled" ? [result.value] : [],
);

for (const result of results) {
  if (result.status === "fulfilled") {
    console.log(
      `${result.value.relay}: verified (${result.value.elapsedMs}ms)`,
    );
  } else {
    console.log(
      `relay failed: ${result.reason instanceof Error ? result.reason.message : result.reason}`,
    );
  }
}
console.log(`event ${event.id}: ${verified.length}/${quorum} verified relays`);
if (verified.length < quorum) process.exit(1);
