/** @jest-environment node */

import { finalizeEvent, nip19 } from "nostr-tools";
import type { NostrEvent } from "@nostrify/types";
import {
  NOSTR_EVENT_CACHE_KEY,
  cacheNostrEvent,
  getCachedNostrEvent,
} from "./event-cache";
import { installMemoryStorage } from "./memory-storage.test-helper";

const storage = installMemoryStorage();

const makeEvent = (): NostrEvent => {
  const secretKey = new Uint8Array(32);
  secretKey[31] = 6;
  return finalizeEvent(
    {
      kind: 30078,
      created_at: 1_700_000_000,
      tags: [["client", "ckboost-dapp"]],
      content: "public signed content",
    },
    secretKey,
  );
};

describe("local Nostr event cache", () => {
  beforeEach(() => storage.clear());

  it("returns a valid cache hit", () => {
    const event = makeEvent();
    const neventId = nip19.neventEncode({
      id: event.id,
      relays: ["wss://relay.example"],
    });

    expect(
      cacheNostrEvent({
        event,
        neventId,
        verifiedRelays: ["wss://relay.example"],
      }),
    ).toBe(true);
    expect(getCachedNostrEvent(event.id)).toMatchObject({
      neventId,
      event: { id: event.id },
      verifiedRelays: ["wss://relay.example"],
    });
  });

  it("deletes a tampered cached event", () => {
    const event = makeEvent();
    const neventId = nip19.neventEncode({ id: event.id });
    localStorage.setItem(
      NOSTR_EVENT_CACHE_KEY,
      JSON.stringify({
        [event.id]: {
          event: { ...event, content: "tampered" },
          neventId,
          cachedAt: Date.now(),
          verifiedRelays: [],
        },
      }),
    );

    expect(getCachedNostrEvent(event.id)).toBeNull();
    expect(
      JSON.parse(localStorage.getItem(NOSTR_EVENT_CACHE_KEY) || "{}"),
    ).not.toHaveProperty(event.id);
  });
});
