/** @jest-environment node */

import { finalizeEvent } from "nostr-tools";
import type { NostrEvent } from "@nostrify/types";
import {
  decodeNevent,
  encodeVerifiedNevent,
  fetchEventFromRelays,
  mergeRelayLists,
  NostrRelayQuorumError,
  publishEventWithQuorum,
  type NostrRelayClient,
} from "./relay-core";

const makeEvent = (): NostrEvent => {
  const secretKey = new Uint8Array(32);
  secretKey[31] = 1;
  return finalizeEvent(
    {
      kind: 30078,
      created_at: 1_700_000_000,
      tags: [["client", "ckboost-dapp"]],
      content: JSON.stringify({ subtasks: [] }),
    },
    secretKey,
  );
};

describe("Nostr relay core", () => {
  it("encodes only the supplied verified relays", () => {
    const event = makeEvent();
    const decoded = decodeNevent(
      encodeVerifiedNevent(event.id, [
        "wss://verified.example",
        "wss://verified.example/",
      ]),
    );

    expect(decoded).toEqual({
      id: event.id,
      relays: ["wss://verified.example"],
    });
  });

  it("deduplicates equivalent relay URLs before quorum accounting", () => {
    expect(
      mergeRelayLists([
        "wss://relay.example",
        "wss://relay.example/",
        "https://not-a-relay.example",
      ]),
    ).toEqual(["wss://relay.example"]);
  });

  it("publishes to every relay and only reports copies that can be read back", async () => {
    const event = makeEvent();
    const published: string[] = [];
    const client: NostrRelayClient = {
      event: jest.fn(async (_event, options) => {
        published.push(options?.relays?.[0] || "");
      }),
      query: jest.fn(async (_filters, options) =>
        options?.relays?.[0] === "wss://missing.example" ? [] : [event],
      ),
    };

    const result = await publishEventWithQuorum({
      nostr: client,
      event,
      relays: [
        "wss://one.example",
        "wss://missing.example",
        "wss://two.example",
      ],
      requiredCopies: 2,
      timeoutMs: 100,
      verificationRounds: 1,
    });

    expect(published).toEqual(
      expect.arrayContaining([
        "wss://one.example",
        "wss://missing.example",
        "wss://two.example",
      ]),
    );
    expect(result.verifiedRelays).toEqual([
      "wss://one.example",
      "wss://two.example",
    ]);
  });

  it("rejects storage before chain submission when relay quorum is not met", async () => {
    const event = makeEvent();
    const client: NostrRelayClient = {
      event: jest.fn(async () => undefined),
      query: jest.fn(async () => []),
    };

    await expect(
      publishEventWithQuorum({
        nostr: client,
        event,
        relays: ["wss://one.example", "wss://two.example"],
        requiredCopies: 2,
        timeoutMs: 50,
        verificationRounds: 1,
      }),
    ).rejects.toBeInstanceOf(NostrRelayQuorumError);
  });

  it("does not let a fast empty relay beat a slower valid relay", async () => {
    const event = makeEvent();
    const client: NostrRelayClient = {
      event: jest.fn(async () => undefined),
      query: jest.fn(async (_filters, options) => {
        if (options?.relays?.[0] === "wss://empty.example") return [];
        await new Promise((resolve) => setTimeout(resolve, 20));
        return [event];
      }),
    };

    const result = await fetchEventFromRelays({
      nostr: client,
      eventId: event.id,
      relays: ["wss://empty.example", "wss://valid.example"],
      timeoutMs: 100,
      rounds: 1,
    });

    expect(result.event?.id).toBe(event.id);
    expect(result.relay).toBe("wss://valid.example");
  });

  it("starts fresh relay queries on every fetch round", async () => {
    const event = makeEvent();
    let calls = 0;
    const client: NostrRelayClient = {
      event: jest.fn(async () => undefined),
      query: jest.fn(async () => {
        calls += 1;
        return calls === 1 ? [] : [event];
      }),
    };

    const result = await fetchEventFromRelays({
      nostr: client,
      eventId: event.id,
      relays: ["wss://relay.example"],
      timeoutMs: 100,
      rounds: 2,
      retryDelayMs: 0,
    });

    expect(calls).toBe(2);
    expect(result.event?.id).toBe(event.id);
  });

  it("rejects an event whose id or signature is invalid", async () => {
    const event = { ...makeEvent(), content: "tampered" };
    const client: NostrRelayClient = {
      event: jest.fn(async () => undefined),
      query: jest.fn(async () => [event]),
    };

    const result = await fetchEventFromRelays({
      nostr: client,
      eventId: event.id,
      relays: ["wss://relay.example"],
      timeoutMs: 100,
      rounds: 1,
    });

    expect(result.event).toBeNull();
    expect(result.attempts[0]?.status).toBe("invalid");
  });

  it("rejects a validly signed event without CKBoost client tags", async () => {
    const secretKey = new Uint8Array(32);
    secretKey[31] = 4;
    const event = finalizeEvent(
      {
        kind: 30078,
        created_at: 1_700_000_000,
        tags: [],
        content: "content",
      },
      secretKey,
    );
    const client: NostrRelayClient = {
      event: jest.fn(async () => undefined),
      query: jest.fn(async () => [event]),
    };

    const result = await fetchEventFromRelays({
      nostr: client,
      eventId: event.id,
      relays: ["wss://relay.example"],
      timeoutMs: 100,
      rounds: 1,
    });

    expect(result.event).toBeNull();
    expect(result.attempts[0]?.status).toBe("invalid");
  });
});
