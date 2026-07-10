import type { NostrEvent } from "@nostrify/types";
import {
  decodeNevent,
  isValidCkboostEvent,
  mergeRelayLists,
  publishEventToRelays,
  type NostrRelayClient,
  type RelayAttemptResult,
} from "./relay-core";
import { cacheNostrEvent } from "./event-cache";

export const NOSTR_REPAIR_QUEUE_KEY = "ckboost:nostr-relay-repair-queue:v1";
const LOCK_KEY = "ckboost:nostr-relay-repair-lock:v1";
const MAX_TASK_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TASKS = 50;
const LOCK_TTL_MS = 60_000;

export interface NostrRelayRepairTask {
  event: NostrEvent;
  neventId: string;
  remainingRelays: string[];
  createdAt: number;
  updatedAt: number;
  attempts: number;
}

const getStorage = (): Storage | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const writeQueue = (
  storage: Storage,
  tasks: NostrRelayRepairTask[],
): boolean => {
  try {
    storage.setItem(NOSTR_REPAIR_QUEUE_KEY, JSON.stringify(tasks));
    return true;
  } catch {
    return false;
  }
};

const isValidTask = (
  value: unknown,
  cutoff: number,
): value is NostrRelayRepairTask => {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<NostrRelayRepairTask>;
  const decoded =
    typeof task.neventId === "string" ? decodeNevent(task.neventId) : null;
  return (
    !!task.event &&
    !!decoded &&
    decoded.id === task.event.id &&
    isValidCkboostEvent(task.event, task.event.id, task.event.kind) &&
    Array.isArray(task.remainingRelays) &&
    task.remainingRelays.length > 0 &&
    typeof task.createdAt === "number" &&
    task.createdAt >= cutoff &&
    typeof task.updatedAt === "number" &&
    typeof task.attempts === "number"
  );
};

export const readNostrRelayRepairQueue = (): NostrRelayRepairTask[] => {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const parsed = JSON.parse(
      storage.getItem(NOSTR_REPAIR_QUEUE_KEY) || "[]",
    ) as unknown;
    if (!Array.isArray(parsed)) {
      writeQueue(storage, []);
      return [];
    }
    const cutoff = Date.now() - MAX_TASK_AGE_MS;
    const valid = parsed
      .filter((task): task is NostrRelayRepairTask => isValidTask(task, cutoff))
      .map((task) => ({
        ...task,
        remainingRelays: mergeRelayLists(task.remainingRelays),
      }))
      .filter((task) => task.remainingRelays.length > 0)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_TASKS);
    if (valid.length !== parsed.length) writeQueue(storage, valid);
    return valid;
  } catch {
    writeQueue(storage, []);
    return [];
  }
};

export const enqueueNostrRelayRepair = ({
  event,
  neventId,
  relays,
}: {
  event: NostrEvent;
  neventId: string;
  relays: string[];
}): boolean => {
  const storage = getStorage();
  const decoded = decodeNevent(neventId);
  const remainingRelays = mergeRelayLists(relays);
  if (
    !storage ||
    !decoded ||
    decoded.id !== event.id ||
    !remainingRelays.length ||
    !isValidCkboostEvent(event, event.id, event.kind)
  ) {
    return false;
  }

  const now = Date.now();
  const tasks = readNostrRelayRepairQueue();
  const existing = tasks.find((task) => task.event.id === event.id);
  const merged: NostrRelayRepairTask = {
    event,
    neventId,
    remainingRelays: mergeRelayLists(
      existing?.remainingRelays || [],
      remainingRelays,
    ),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    attempts: existing?.attempts || 0,
  };
  const next = [
    merged,
    ...tasks.filter((task) => task.event.id !== event.id),
  ].slice(0, MAX_TASKS);
  return writeQueue(storage, next);
};

export const enqueueUnverifiedRelayRepairs = ({
  event,
  neventId,
  attempts,
}: {
  event: NostrEvent;
  neventId: string;
  attempts: RelayAttemptResult[];
}): boolean =>
  enqueueNostrRelayRepair({
    event,
    neventId,
    relays: attempts
      .filter((attempt) => attempt.verification !== "verified")
      .map((attempt) => attempt.relay),
  });

const acquireLock = (storage: Storage): string | null => {
  const owner = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    const now = Date.now();
    const current = JSON.parse(storage.getItem(LOCK_KEY) || "null") as {
      owner?: string;
      expiresAt?: number;
    } | null;
    if (current?.owner && Number(current.expiresAt) > now) return null;
    storage.setItem(
      LOCK_KEY,
      JSON.stringify({ owner, expiresAt: now + LOCK_TTL_MS }),
    );
    const confirmed = JSON.parse(storage.getItem(LOCK_KEY) || "null") as {
      owner?: string;
    } | null;
    return confirmed?.owner === owner ? owner : null;
  } catch {
    return null;
  }
};

const releaseLock = (storage: Storage, owner: string): void => {
  try {
    const current = JSON.parse(storage.getItem(LOCK_KEY) || "null") as {
      owner?: string;
    } | null;
    if (current?.owner === owner) storage.removeItem(LOCK_KEY);
  } catch {
    // Best-effort lock cleanup only.
  }
};

let activeFlush: Promise<void> | null = null;

export const flushNostrRelayRepairQueue = async (
  nostr: NostrRelayClient,
): Promise<void> => {
  if (activeFlush) return activeFlush;
  activeFlush = (async () => {
    const storage = getStorage();
    if (!storage) return;
    const owner = acquireLock(storage);
    if (!owner) return;

    try {
      const tasks = readNostrRelayRepairQueue();
      if (!tasks.length) return;
      const remaining: NostrRelayRepairTask[] = [];

      for (const task of tasks) {
        try {
          const result = await publishEventToRelays({
            nostr,
            event: task.event,
            relays: task.remainingRelays,
          });
          const unrepaired = task.remainingRelays.filter(
            (relay) => !result.verifiedRelays.includes(relay),
          );
          cacheNostrEvent({
            event: task.event,
            neventId: task.neventId,
            verifiedRelays: result.verifiedRelays,
          });
          if (unrepaired.length) {
            remaining.push({
              ...task,
              remainingRelays: unrepaired,
              updatedAt: Date.now(),
              attempts: task.attempts + 1,
            });
          }
        } catch {
          remaining.push({
            ...task,
            updatedAt: Date.now(),
            attempts: task.attempts + 1,
          });
        }
      }
      writeQueue(storage, remaining);
    } finally {
      releaseLock(storage, owner);
    }
  })().finally(() => {
    activeFlush = null;
  });
  return activeFlush;
};
