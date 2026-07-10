/** @jest-environment node */

import { finalizeEvent, nip19 } from "nostr-tools";
import type { NostrEvent } from "@nostrify/types";
import { fetchNeventWithCache } from "./browser-fetch";
import {
  NOSTR_EVENT_CACHE_KEY,
  cacheNostrEvent,
  getCachedNostrEvent,
} from "./event-cache";
import type { NostrRelayClient } from "./relay-core";
import { installMemoryStorage } from "./memory-storage.test-helper";

const storage = installMemoryStorage();

const defaultRelays = [
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://relay.nostr.net",
  "wss://nos.lol",
];

const makeEvent = (): NostrEvent => {
  const secretKey = new Uint8Array(32);
  secretKey[31] = 5;
  return finalizeEvent(
    {
      kind: 30078,
      created_at: 1_700_000_000,
      tags: [
        ["client", "ckboost-dapp"],
        ["campaign", "0xcampaign"],
        ["quest", "2"],
        ["user", "ckt1user"],
      ],
      content: "public event content",
    },
    secretKey,
  );
};

describe("browser Nostr fetch", () => {
  beforeEach(() => {
    storage.clear();
    jest.restoreAllMocks();
  });

  it("returns a validated local cache hit before querying relays", async () => {
    const event = makeEvent();
    const neventId = nip19.neventEncode({ id: event.id });
    cacheNostrEvent({ event, neventId, verifiedRelays: [] });
    const nostr: NostrRelayClient = {
      event: jest.fn(),
      query: jest.fn(),
    };

    const result = await fetchNeventWithCache({
      nostr,
      neventId,
      configuredRelays: defaultRelays,
    });

    expect(result).toMatchObject({ event: { id: event.id }, source: "local" });
    expect(nostr.query).not.toHaveBeenCalled();
  });

  it("deletes an invalid cache entry and falls through to relays", async () => {
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
    const nostr: NostrRelayClient = {
      event: jest.fn(),
      query: jest.fn(async () => [event]),
    };

    const result = await fetchNeventWithCache({
      nostr,
      neventId,
      configuredRelays: defaultRelays,
    });

    expect(result.source).toBe("relay");
    expect(nostr.query).toHaveBeenCalled();
    expect(getCachedNostrEvent(event.id)?.event.id).toBe(event.id);
  });

  it("queries advertised relays first, supplements defaults, and caches the result", async () => {
    const event = makeEvent();
    const advertisedRelay = "wss://advertised.example";
    const neventId = nip19.neventEncode({
      id: event.id,
      relays: [advertisedRelay],
    });
    const queried: string[] = [];
    const nostr: NostrRelayClient = {
      event: jest.fn(),
      query: jest.fn(async (_filters, options) => {
        const relay = options?.relays?.[0] || "";
        queried.push(relay);
        return relay === advertisedRelay ? [event] : [];
      }),
    };

    const result = await fetchNeventWithCache({
      nostr,
      neventId,
      configuredRelays: defaultRelays,
    });

    expect(result).toMatchObject({ event: { id: event.id }, source: "relay" });
    expect(queried).toEqual([advertisedRelay, ...defaultRelays]);
    expect(getCachedNostrEvent(event.id)?.event.id).toBe(event.id);
  });

  it("returns a relay result when localStorage quota is exceeded", async () => {
    const event = makeEvent();
    const neventId = nip19.neventEncode({ id: event.id });
    const nostr: NostrRelayClient = {
      event: jest.fn(),
      query: jest.fn(async () => [event]),
    };
    jest.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    await expect(
      fetchNeventWithCache({
        nostr,
        neventId,
        configuredRelays: defaultRelays,
      }),
    ).resolves.toMatchObject({ event: { id: event.id }, source: "relay" });
  });
});
