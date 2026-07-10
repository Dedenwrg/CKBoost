const { getEventHash, nip19, verifyEvent } = require("nostr-tools");

const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://relay.nostr.net",
  "wss://nos.lol",
];

// njump exposes its cached events through a read-only Nostr relay. Keep it out
// of the normal source and publish sets: it is only a last-resort recovery
// source for this manual backfill tool.
const DEFAULT_RECOVERY_RELAYS = ["wss://njump.me"];

const relayKey = (relay) => {
  try {
    const url = new URL(relay);
    if (url.protocol !== "wss:" && url.protocol !== "ws:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
};

const mergeRelays = (...lists) => {
  const seen = new Set();
  const result = [];
  for (const relay of lists.flat()) {
    const trimmed = String(relay || "").trim();
    const key = relayKey(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
};

const decodeNevent = (neventId) => {
  const decoded = nip19.decode(neventId);
  if (decoded.type !== "nevent") throw new Error("NEVENT_ID must be a nevent");
  return decoded.data;
};

const isValidCkboostEvent = (event, eventId, kind = 30078) => {
  try {
    return (
      event?.id === eventId &&
      event.kind === kind &&
      event.tags?.some(
        (tag) => tag[0] === "client" && tag[1] === "ckboost-dapp",
      ) &&
      getEventHash(event) === event.id &&
      verifyEvent(event)
    );
  } catch {
    return false;
  }
};

const publishAndVerifyRelay = async ({
  relay,
  event,
  publishEvent,
  readEvent,
  now = Date.now,
}) => {
  const startedAt = now();
  let publish = "failed";
  let publishError;

  try {
    await publishEvent({ relay, event });
    publish = "accepted";
  } catch (error) {
    publishError = error instanceof Error ? error.message : String(error);
    publish = publishError === "timeout" ? "timeout" : "failed";
  }

  try {
    await readEvent({ relay, eventId: event.id, kind: event.kind });
    return {
      publish,
      verification: "verified",
      elapsedMs: now() - startedAt,
      ...(publishError ? { error: publishError } : {}),
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
      elapsedMs: now() - startedAt,
      error: message || publishError,
    };
  }
};

const runBackfill = async ({
  neventId,
  configuredRelays = DEFAULT_RELAYS,
  recoveryRelays = DEFAULT_RECOVERY_RELAYS,
  quorum = 2,
  fetchEvent,
  publishAndVerify,
}) => {
  const decoded = decodeNevent(neventId);
  const targets = mergeRelays(configuredRelays);
  const sourceRelays = mergeRelays(decoded.relays || [], targets);
  const recoverySources = mergeRelays(sourceRelays, recoveryRelays).slice(
    sourceRelays.length,
  );
  let event;
  let source = "relay";

  try {
    event = await fetchEvent({
      eventId: decoded.id,
      kind: 30078,
      relays: sourceRelays,
    });
  } catch (primaryError) {
    if (recoverySources.length === 0) throw primaryError;
    source = "recovery";
    try {
      event = await fetchEvent({
        eventId: decoded.id,
        kind: 30078,
        relays: recoverySources,
      });
    } catch (recoveryError) {
      throw new AggregateError(
        [primaryError, recoveryError],
        "Unable to retrieve the event from primary or recovery relays",
      );
    }
  }

  if (!isValidCkboostEvent(event, decoded.id, 30078)) {
    throw new Error("Unable to retrieve a valid CKBoost event");
  }

  const settled = await Promise.allSettled(
    targets.map(async (relay) => ({
      relay,
      ...(await publishAndVerify({ relay, event })),
    })),
  );
  const attempts = settled.map((result, index) =>
    result.status === "fulfilled"
      ? result.value
      : {
          relay: targets[index],
          publish: "failed",
          verification: "skipped",
          elapsedMs: 0,
          error:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
        },
  );
  const verifiedRelays = attempts
    .filter((attempt) => attempt.verification === "verified")
    .map((attempt) => attempt.relay);

  return {
    event,
    source,
    sourceRelays: source === "recovery" ? recoverySources : sourceRelays,
    attempts,
    verifiedRelays,
    requiredCopies: quorum,
    quorumReached: verifiedRelays.length >= quorum,
  };
};

module.exports = {
  DEFAULT_RECOVERY_RELAYS,
  DEFAULT_RELAYS,
  decodeNevent,
  isValidCkboostEvent,
  mergeRelays,
  publishAndVerifyRelay,
  runBackfill,
};
