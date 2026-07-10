import { WebSocket } from "ws";
import backfill from "./backfill-nostr-relays-lib.cjs";

const {
  DEFAULT_RECOVERY_RELAYS,
  DEFAULT_RELAYS,
  isValidCkboostEvent,
  mergeRelays,
  runBackfill,
} = backfill;
const neventId = process.env.NEVENT_ID;
const configuredFromEnv = mergeRelays(
  (process.env.NOSTR_RELAYS || DEFAULT_RELAYS.join(",")).split(","),
);
const configuredRelays = configuredFromEnv.length
  ? configuredFromEnv
  : DEFAULT_RELAYS;
const configuredRecoveryRelays = mergeRelays(
  (
    process.env.NOSTR_RECOVERY_RELAYS || DEFAULT_RECOVERY_RELAYS.join(",")
  ).split(","),
);
const configuredQuorum = Number(process.env.NOSTR_MIN_RELAY_COPIES);
const quorum =
  Number.isInteger(configuredQuorum) && configuredQuorum > 0
    ? configuredQuorum
    : 2;
const configuredTimeout = Number(process.env.NOSTR_RELAY_TIMEOUT_MS);
const timeoutMs =
  Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : 5000;

if (!neventId) {
  console.error('Set NEVENT_ID, for example: NEVENT_ID="nevent1..."');
  process.exit(1);
}

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

const readFromRelay = ({ relay, eventId, kind }) => {
  const subscription = `backfill-${Math.random().toString(36).slice(2)}`;
  return withSocket(
    relay,
    (socket) =>
      socket.send(
        JSON.stringify([
          "REQ",
          subscription,
          { ids: [eventId], kinds: [kind], limit: 1 },
        ]),
      ),
    (message, resolve) => {
      if (message[0] === "EVENT" && message[1] === subscription) {
        if (isValidCkboostEvent(message[2], eventId, kind)) {
          return resolve(message[2]);
        }
        throw new Error("invalid event");
      }
      if (message[0] === "EOSE" && message[1] === subscription) {
        throw new Error("event absent");
      }
    },
  );
};

const fetchEvent = ({ eventId, kind, relays }) =>
  Promise.any(relays.map((relay) => readFromRelay({ relay, eventId, kind })));

const publishAndVerify = async ({ relay, event }) => {
  const startedAt = Date.now();
  let publish = "failed";
  try {
    await withSocket(
      relay,
      (socket) => socket.send(JSON.stringify(["EVENT", event])),
      (message, resolve) => {
        if (message[0] === "OK" && message[1] === event.id) {
          if (message[2]) return resolve(true);
          throw new Error(String(message[3] || "rejected"));
        }
      },
    );
    publish = "accepted";
  } catch (error) {
    return {
      publish:
        error instanceof Error && error.message === "timeout"
          ? "timeout"
          : "failed",
      verification: "skipped",
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    await readFromRelay({ relay, eventId: event.id, kind: event.kind });
    return {
      publish,
      verification: "verified",
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      publish,
      verification:
        message === "timeout"
          ? "timeout"
          : message === "event absent"
            ? "missing"
            : message === "invalid event"
              ? "invalid"
              : "failed",
      elapsedMs: Date.now() - startedAt,
      error: message,
    };
  }
};

try {
  const result = await runBackfill({
    neventId,
    configuredRelays,
    recoveryRelays: configuredRecoveryRelays,
    quorum,
    fetchEvent,
    publishAndVerify,
  });
  console.log(
    `event source: ${result.source} (${result.sourceRelays.join(", ")})`,
  );
  for (const attempt of result.attempts) {
    console.log(
      `${attempt.relay}: ${attempt.publish} / ${attempt.verification} (${attempt.elapsedMs}ms)`,
    );
  }
  console.log(
    `event ${result.event.id}: ${result.verifiedRelays.length}/${result.requiredCopies} verified relays`,
  );
  if (!result.quorumReached) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
