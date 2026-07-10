/** @jest-environment node */

import { finalizeEvent, nip19 } from "nostr-tools";
import type { NostrEvent } from "@nostrify/types";
import type { NostrRelayClient, RelayAttemptResult } from "./relay-core";
import {
  enqueueNostrRelayRepair,
  enqueueUnverifiedRelayRepairs,
  flushNostrRelayRepairQueue,
  readNostrRelayRepairQueue,
} from "./relay-repair-queue";
import { installMemoryStorage } from "./memory-storage.test-helper";

const storage = installMemoryStorage();

const makeEvent = (): NostrEvent => {
  const secretKey = new Uint8Array(32);
  secretKey[31] = 7;
  return finalizeEvent(
    {
      kind: 30078,
      created_at: 1_700_000_000,
      tags: [["client", "ckboost-dapp"]],
      content: "public event",
    },
    secretKey,
  );
};

const makeTask = () => {
  const event = makeEvent();
  return {
    event,
    neventId: nip19.neventEncode({ id: event.id }),
    relays: ["wss://repair.example"],
  };
};

describe("Nostr relay repair queue", () => {
  beforeEach(() => storage.clear());

  it("queues failed or unverified relays and deduplicates the event", () => {
    const task = makeTask();
    const attempts: RelayAttemptResult[] = [
      {
        relay: "wss://verified.example",
        publish: "accepted",
        verification: "verified",
        elapsedMs: 1,
      },
      {
        relay: "wss://repair.example",
        publish: "failed",
        verification: "skipped",
        elapsedMs: 1,
      },
    ];

    enqueueUnverifiedRelayRepairs({ ...task, attempts });
    enqueueUnverifiedRelayRepairs({ ...task, attempts });

    expect(readNostrRelayRepairQueue()).toMatchObject([
      { remainingRelays: ["wss://repair.example"], attempts: 0 },
    ]);
  });

  it("removes a relay only after read-after-write succeeds", async () => {
    const task = makeTask();
    enqueueNostrRelayRepair(task);
    const nostr: NostrRelayClient = {
      event: jest.fn(async () => undefined),
      query: jest.fn(async () => [task.event]),
    };

    await flushNostrRelayRepairQueue(nostr);

    expect(nostr.event).toHaveBeenCalledWith(
      task.event,
      expect.objectContaining({ relays: ["wss://repair.example"] }),
    );
    expect(readNostrRelayRepairQueue()).toEqual([]);
  });

  it("retains a failed repair and increments attempts", async () => {
    const task = makeTask();
    enqueueNostrRelayRepair(task);
    const nostr: NostrRelayClient = {
      event: jest.fn(async () => {
        throw new Error("offline");
      }),
      query: jest.fn(async () => []),
    };

    await flushNostrRelayRepairQueue(nostr);

    expect(readNostrRelayRepairQueue()[0]).toMatchObject({
      remainingRelays: ["wss://repair.example"],
      attempts: 1,
    });
  });
});
