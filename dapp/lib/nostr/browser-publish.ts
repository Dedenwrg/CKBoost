import type { NostrEvent } from "@nostrify/types";
import {
  mergeRelayLists,
  publishEventWithQuorum,
  type NostrRelayClient,
  type RelayAttemptResult,
} from "./relay-core";

export const publishEventToConfiguredRelays = ({
  nostr,
  event,
  configuredRelays,
  requiredCopies,
  timeoutMs,
  verificationRounds,
  verificationDelayMs,
}: {
  nostr: NostrRelayClient;
  event: NostrEvent;
  configuredRelays: readonly string[];
  requiredCopies: number;
  timeoutMs?: number;
  verificationRounds?: number;
  verificationDelayMs?: number;
}): Promise<{
  verifiedRelays: string[];
  attempts: RelayAttemptResult[];
}> =>
  publishEventWithQuorum({
    nostr,
    event,
    // Deliberately ignore the pool's active relay map. Reads may open relays
    // advertised by arbitrary nevents; those relays must never become writers.
    relays: mergeRelayLists([...configuredRelays]),
    requiredCopies,
    timeoutMs,
    verificationRounds,
    verificationDelayMs,
  });
