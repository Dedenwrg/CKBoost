/** @jest-environment node */

import { finalizeEvent } from "nostr-tools";
import type { NostrEvent } from "@nostrify/types";
import { publishEventToConfiguredRelays } from "./browser-publish";
import type { NostrRelayClient } from "./relay-core";

const makeEvent = (): NostrEvent => {
  const secretKey = new Uint8Array(32);
  secretKey[31] = 11;
  return finalizeEvent(
    {
      kind: 30078,
      created_at: 1_700_000_000,
      tags: [["client", "ckboost-dapp"]],
      content: "configured relay test",
    },
    secretKey,
  );
};

describe("browser Nostr publishing", () => {
  it("never promotes relays opened by reads into write targets", async () => {
    const event = makeEvent();
    const published: string[] = [];
    const nostr = {
      relays: new Map([["wss://advertised.example", {}]]),
      event: jest.fn(async (_event, options) => {
        published.push(options?.relays?.[0] || "");
      }),
      query: jest.fn(async () => [event]),
    } as NostrRelayClient & { relays: Map<string, object> };

    await publishEventToConfiguredRelays({
      nostr,
      event,
      configuredRelays: [
        "wss://configured-one.example",
        "wss://configured-two.example",
      ],
      requiredCopies: 2,
      timeoutMs: 100,
      verificationRounds: 1,
    });

    expect(published).toEqual([
      "wss://configured-one.example",
      "wss://configured-two.example",
    ]);
    expect(published).not.toContain("wss://advertised.example");
  });

  it("allows a social event to succeed with one verified relay", async () => {
    const event = makeEvent();
    const nostr: NostrRelayClient = {
      event: jest.fn(async () => undefined),
      query: jest.fn(async (_filters, options) =>
        options?.relays?.[0] === "wss://available.example" ? [event] : [],
      ),
    };

    const result = await publishEventToConfiguredRelays({
      nostr,
      event,
      configuredRelays: [
        "wss://available.example",
        "wss://unavailable.example",
      ],
      requiredCopies: 1,
      timeoutMs: 100,
      verificationRounds: 1,
    });

    expect(result.verifiedRelays).toEqual(["wss://available.example"]);
  });
});
