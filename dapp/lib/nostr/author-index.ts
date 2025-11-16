import { NostrFilter } from "@nostrify/types";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  bytesToHex,
  hexToBytes,
  utf8ToBytes,
} from "@noble/hashes/utils.js";
import { nip19, getPublicKey } from "nostr-tools";

export const DEFAULT_AUTHOR_INDEX_NAMESPACE = "ckboost:author-index";

export type AuthorIndexConfig =
  | {
      /** Arbitrary seed used to deterministically derive a signing key. */
      seed: string;
      /** Optional namespace to avoid collisions across feature domains. */
      namespace?: string;
      /** Optional salt to mix into the derivation. */
      salt?: string;
    }
  | {
      /** Raw private key (hex, 0x-prefixed hex, nsec, or bytes). */
      privateKey: string | Uint8Array;
    };

export type AuthorReference = string | AuthorIndexConfig;

export interface AuthorKeys {
  secretKey: Uint8Array;
  secretKeyHex: string;
  pubkey: string;
  npub: string;
}

const ensure32Bytes = (bytes: Uint8Array): Uint8Array => {
  if (bytes.length === 32) {
    return new Uint8Array(bytes);
  }

  if (bytes.length > 32) {
    return bytes.slice(bytes.length - 32);
  }

  const padded = new Uint8Array(32);
  padded.set(bytes, 32 - bytes.length);
  return padded;
};

const deriveSecretFromSeed = (
  seed: string,
  namespace?: string,
  salt?: string
): Uint8Array => {
  const payload = `${namespace ?? DEFAULT_AUTHOR_INDEX_NAMESPACE}:${seed}${
    salt ? `:${salt}` : ""
  }`;
  return new Uint8Array(sha256(utf8ToBytes(payload)));
};

const normalizePrivateKey = (value: string | Uint8Array): Uint8Array => {
  if (value instanceof Uint8Array) {
    return ensure32Bytes(value);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Author index private key cannot be empty");
  }

  if (trimmed.startsWith("nsec1")) {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== "nsec") {
      throw new Error("Provided key is not a valid nsec reference");
    }
    return ensure32Bytes(decoded.data as Uint8Array);
  }

  const hex = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  try {
    return ensure32Bytes(hexToBytes(hex));
  } catch {
    throw new Error("Invalid hex private key for author index");
  }
};

export function deriveAuthorKeys(config: AuthorIndexConfig): AuthorKeys {
  const secretKey =
    "seed" in config
      ? deriveSecretFromSeed(config.seed, config.namespace, config.salt)
      : normalizePrivateKey(config.privateKey);

  if (secretKey.every((byte) => byte === 0)) {
    throw new Error("Derived secret key cannot be all zeros");
  }

  const pubkey = getPublicKey(secretKey);
  const secretKeyHex = bytesToHex(secretKey);
  const npub = nip19.npubEncode(pubkey);

  return { secretKey, secretKeyHex, pubkey, npub };
}

export function resolveAuthorPubkey(author: AuthorReference): string {
  if (typeof author !== "string") {
    return deriveAuthorKeys(author).pubkey;
  }

  const trimmed = author.trim();
  if (!trimmed) {
    throw new Error("Author reference cannot be empty");
  }

  if (trimmed.startsWith("npub1")) {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== "npub") {
      throw new Error("Invalid npub reference");
    }
    return (decoded.data as string).toLowerCase();
  }

  if (trimmed.startsWith("nprofile1")) {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== "nprofile") {
      throw new Error("Invalid nprofile reference");
    }
    return (decoded.data as { pubkey: string }).pubkey.toLowerCase();
  }

  return trimmed.startsWith("0x")
    ? trimmed.slice(2).toLowerCase()
    : trimmed.toLowerCase();
}

export type AuthorFilterOverrides = Omit<NostrFilter, "authors">;

export function buildAuthorFilter(
  author: AuthorReference,
  overrides: AuthorFilterOverrides = {}
): NostrFilter {
  return {
    ...overrides,
    authors: [resolveAuthorPubkey(author)],
  };
}
