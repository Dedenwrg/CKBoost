/** @jest-environment node */

import { finalizeEvent, nip19 } from "nostr-tools";

const { publishAndVerifyRelay, runBackfill } = require(
  "./backfill-nostr-relays-lib.cjs",
) as {
  publishAndVerifyRelay: (options: {
    relay: string;
    event: ReturnType<typeof finalizeEvent>;
    publishEvent: () => Promise<void>;
    readEvent: () => Promise<ReturnType<typeof finalizeEvent>>;
  }) => Promise<{
    publish: string;
    verification: string;
    elapsedMs: number;
    error?: string;
  }>;
  runBackfill: (options: {
    neventId: string;
    configuredRelays: string[];
    recoveryRelays?: string[];
    quorum: number;
    fetchEvent: (input: {
      eventId: string;
      kind: number;
      relays: string[];
    }) => Promise<ReturnType<typeof finalizeEvent>>;
    publishAndVerify: (input: {
      relay: string;
      event: ReturnType<typeof finalizeEvent>;
    }) => Promise<{
      publish: string;
      verification: string;
      elapsedMs: number;
    }>;
  }) => Promise<{
    event: ReturnType<typeof finalizeEvent>;
    source: "relay" | "recovery";
    sourceRelays: string[];
    verifiedRelays: string[];
    quorumReached: boolean;
  }>;
};

describe("generic Nostr relay backfill", () => {
  it("verifies an existing event after a duplicate publish rejection", async () => {
    const secretKey = new Uint8Array(32);
    secretKey[31] = 12;
    const event = finalizeEvent(
      {
        kind: 30078,
        created_at: 1_700_000_003,
        tags: [["client", "ckboost-dapp"]],
        content: "already stored",
      },
      secretKey,
    );
    const readEvent = jest.fn(async () => event);

    const result = await publishAndVerifyRelay({
      relay: "wss://duplicate.example",
      event,
      publishEvent: async () => {
        throw new Error("duplicate: already exists");
      },
      readEvent,
    });

    expect(result).toMatchObject({
      publish: "failed",
      verification: "verified",
      error: "duplicate: already exists",
    });
    expect(readEvent).toHaveBeenCalledTimes(1);
  });

  it("republishes the exact signed event without depending on content structure", async () => {
    const secretKey = new Uint8Array(32);
    secretKey[31] = 8;
    const event = finalizeEvent(
      {
        kind: 30078,
        created_at: 1_700_000_000,
        tags: [["client", "ckboost-dapp"]],
        content: "not JSON and intentionally unrelated to answer counts",
      },
      secretKey,
    );
    const neventId = nip19.neventEncode({
      id: event.id,
      relays: ["wss://advertised.example"],
    });
    const fetchEvent = jest.fn(async () => event);
    const publishAndVerify = jest.fn(
      async (_input: { relay: string; event: typeof event }) => ({
        publish: "accepted",
        verification: "verified",
        elapsedMs: 1,
      }),
    );

    const result = await runBackfill({
      neventId,
      configuredRelays: [
        "wss://one.example",
        "wss://two.example",
        "wss://three.example",
      ],
      quorum: 2,
      fetchEvent,
      publishAndVerify,
    });

    expect(fetchEvent).toHaveBeenCalledWith({
      eventId: event.id,
      kind: 30078,
      relays: [
        "wss://advertised.example",
        "wss://one.example",
        "wss://two.example",
        "wss://three.example",
      ],
    });
    expect(publishAndVerify).toHaveBeenCalledTimes(3);
    for (const [call] of publishAndVerify.mock.calls) {
      expect(call.event).toBe(event);
    }
    expect(result.event).toBe(event);
    expect(result.source).toBe("relay");
    expect(result.verifiedRelays).toHaveLength(3);
    expect(result.quorumReached).toBe(true);
  });

  it("uses the recovery relay only after all primary relays fail", async () => {
    const secretKey = new Uint8Array(32);
    secretKey[31] = 9;
    const event = finalizeEvent(
      {
        kind: 30078,
        created_at: 1_700_000_001,
        tags: [["client", "ckboost-dapp"]],
        content: "opaque signed submission",
      },
      secretKey,
    );
    const neventId = nip19.neventEncode({
      id: event.id,
      relays: ["wss://advertised.example"],
    });
    const fetchEvent = jest
      .fn()
      .mockRejectedValueOnce(new AggregateError([], "primary unavailable"))
      .mockResolvedValueOnce(event);
    const publishAndVerify = jest.fn(
      async (_input: { relay: string; event: typeof event }) => ({
        publish: "accepted",
        verification: "verified",
        elapsedMs: 1,
      }),
    );

    const result = await runBackfill({
      neventId,
      configuredRelays: ["wss://one.example", "wss://two.example"],
      quorum: 2,
      fetchEvent,
      publishAndVerify,
    });

    expect(fetchEvent).toHaveBeenNthCalledWith(1, {
      eventId: event.id,
      kind: 30078,
      relays: ["wss://advertised.example", "wss://one.example", "wss://two.example"],
    });
    expect(fetchEvent).toHaveBeenNthCalledWith(2, {
      eventId: event.id,
      kind: 30078,
      relays: ["wss://njump.me"],
    });
    expect(result.source).toBe("recovery");
    expect(result.sourceRelays).toEqual(["wss://njump.me"]);
    expect(publishAndVerify).toHaveBeenCalledTimes(2);
    expect(
      publishAndVerify.mock.calls.map(([call]) => call.relay),
    ).toEqual(["wss://one.example", "wss://two.example"]);
    for (const [call] of publishAndVerify.mock.calls) {
      expect(call.event).toBe(event);
    }
  });

  it("rejects a tampered event returned by a recovery relay", async () => {
    const secretKey = new Uint8Array(32);
    secretKey[31] = 10;
    const event = finalizeEvent(
      {
        kind: 30078,
        created_at: 1_700_000_002,
        tags: [["client", "ckboost-dapp"]],
        content: "original signed content",
      },
      secretKey,
    );
    const tamperedEvent = { ...event, content: "tampered content" };
    const neventId = nip19.neventEncode({ id: event.id });
    const fetchEvent = jest
      .fn()
      .mockRejectedValueOnce(new AggregateError([], "primary unavailable"))
      .mockResolvedValueOnce(tamperedEvent);
    const publishAndVerify = jest.fn();

    await expect(
      runBackfill({
        neventId,
        configuredRelays: ["wss://one.example"],
        recoveryRelays: ["wss://njump.me"],
        quorum: 1,
        fetchEvent,
        publishAndVerify,
      }),
    ).rejects.toThrow("Unable to retrieve a valid CKBoost event");
    expect(publishAndVerify).not.toHaveBeenCalled();
  });
});
