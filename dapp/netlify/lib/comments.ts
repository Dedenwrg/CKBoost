import { createHmac, createHash } from "crypto";
import { Event, nip19, finalizeEvent } from "nostr-tools";

import { createLogger } from "../lib/log";
import { getConfiguredNostrRelays } from "../configs/nostr";
import { publishAndVerifyEvent } from "./nostr";
import { NPool, NRelay1, NostrFilter } from "@nostrify/nostrify";

const logger = createLogger("update-tipping-comments");

export function derivePrivateKey(seed: string, salt: string): Uint8Array {
  const hmac = createHmac("sha256", seed);
  hmac.update(salt);
  if (!process.env.NETLIFY_API_AUTHENTICATOR_PRIVATE_KEY) {
    throw new Error("NETLIFY_API_AUTHENTICATOR_PRIVATE_KEY is not set");
  }
  hmac.update(process.env.NETLIFY_API_AUTHENTICATOR_PRIVATE_KEY);
  return new Uint8Array(hmac.digest());
}

export const defaultPool = new NPool({
  open(url: string) {
    return new NRelay1(url);
  },
  reqRouter: async (filters) => {
    return new Map(
      getConfiguredNostrRelays().map(
        (url) => [url, filters as NostrFilter[]] as [string, NostrFilter[]]
      )
    );
  },
  eventRouter: async (event) => {
    return getConfiguredNostrRelays();
  },
});

export async function createReplaceableEvent(
  dTag: string,
  content: string,
  tags: string[][],
  privateKey: Uint8Array,
  pubkey: string,
  kind: number = 30078
): Promise<Event> {
  const unsignedEvent = {
    kind,
    content,
    tags: [["d", dTag], ...tags],
    created_at: Math.floor(Date.now() / 1000),
    pubkey,
  };
  const signedEvent = finalizeEvent(unsignedEvent, privateKey);
  const verifiedEvent = await publishAndVerifyEvent(
    defaultPool,
    signedEvent,
    "Failed to verify event"
  );
  if (verifiedEvent.length === 0) {
    throw new Error("Failed to verify event");
  }
  logger.info("Created replaceable event", { dTag, id: signedEvent.id });
  return signedEvent;
}

export async function updateReplaceableEvent(
  existingEvent: Event,
  newContent: string,
  privateKey: Uint8Array,
  pubkey: string
): Promise<Event> {
  const unsignedEvent = {
    kind: existingEvent.kind,
    content: newContent,
    tags: [...existingEvent.tags],
    created_at: Math.floor(Date.now() / 1000),
    pubkey,
  };
  const signedEvent = finalizeEvent(unsignedEvent, privateKey);
  const verifiedEvent = await publishAndVerifyEvent(
    defaultPool,
    signedEvent,
    "Failed to verify event"
  );
  if (verifiedEvent.length === 0) {
    throw new Error("Failed to verify event");
  }
  logger.info("Updated replaceable event", {
    oldId: existingEvent.id,
    newId: signedEvent.id,
  });
  return signedEvent;
}
