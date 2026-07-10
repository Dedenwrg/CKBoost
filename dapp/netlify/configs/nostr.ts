import { parseRelayList } from "../../lib/nostr/relay-core";

export const DEFAULT_NOSTR_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://relay.nostr.net",
  "wss://nos.lol",
];

export const getConfiguredNostrRelays = (): string[] => {
  const netlify = (
    globalThis as typeof globalThis & {
      Netlify?: { env?: { get(name: string): string | undefined } };
    }
  ).Netlify;
  return parseRelayList(
    netlify?.env?.get("NOSTR_RELAYS") || process.env.NOSTR_RELAYS,
    DEFAULT_NOSTR_RELAYS
  );
};

export const CKBOOST_SUBMISSION_KIND = 30078;

export const RELAY_TIMEOUT_MS = 5_000;
export const VERIFICATION_DELAY_MS = 1_000;
export const MAX_VERIFICATION_ROUNDS = 2;
