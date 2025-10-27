import { createScopedLogger } from "ssri-ckboost";

type StorageMode = "local-storage" | "memory";

type CacheRecord<T> = {
  value: T;
  createdAt: number;
  ttlMs: number | null;
  sessionId: string | null;
  version: number;
};

export type CacheEntryMetadata = {
  key: string;
  namespace: string;
  createdAt: number;
  ageMs: number;
  ttlMs: number | null;
  expiresAt: number | null;
  sessionId: string | null;
  storage: StorageMode;
};

export type CacheLookupResult<T> = {
  value: T;
  metadata: CacheEntryMetadata;
  hit: boolean;
  stale: boolean;
};

export type CacheGetOptions = {
  /** Override the TTL check for this lookup only. */
  ttlMs?: number | null;
  /** When true, expired records are returned with `stale: true`. */
  allowStale?: boolean;
};

export type CacheSetOptions = {
  ttlMs?: number | null;
  /** Override session scoping for this write. */
  sessionScoped?: boolean;
};

export type CacheWithLoaderOptions = CacheGetOptions & {
  /** Force bypassing cache before executing the loader. */
  refresh?: boolean;
  /** Override the TTL used when writing the loaded value. */
  writeTtlMs?: number | null;
};

export interface LocalStorageCache {
  get<T>(key: string, options?: CacheGetOptions): CacheLookupResult<T> | null;
  set<T>(key: string, value: T, options?: CacheSetOptions): CacheEntryMetadata | null;
  delete(key: string): void;
  clear(): void;
  withLoader<T>(
    key: string,
    loader: () => Promise<T>,
    options?: CacheWithLoaderOptions
  ): Promise<CacheLookupResult<T>>;
}

type CacheConfig = {
  namespace?: string;
  defaultTtlMs?: number | null;
  sessionScoped?: boolean;
  storage?: Storage | null;
  now?: () => number;
};

const GLOBAL_SESSION_ID =
  typeof window === "undefined"
    ? null
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const FALLBACK_MEMORY_CACHE = new Map<string, CacheRecord<unknown>>();
const CURRENT_VERSION = 1;

const resolveStorage = (provided?: Storage | null): Storage | null => {
  if (typeof window === "undefined") {
    return null;
  }

  if (provided) {
    return provided;
  }

  try {
    const { localStorage } = window;
    const testKey = "__ckboost_cache_test__";
    localStorage.setItem(testKey, testKey);
    localStorage.removeItem(testKey);
    return localStorage;
  } catch {
    return null;
  }
};

const buildMetadata = <T>(
  key: string,
  namespace: string,
  record: CacheRecord<T>,
  now: number,
  storage: StorageMode
): CacheEntryMetadata => {
  const ttlMs = record.ttlMs ?? null;
  const expiresAt = ttlMs === null ? null : record.createdAt + ttlMs;
  return {
    key,
    namespace,
    createdAt: record.createdAt,
    ageMs: now - record.createdAt,
    ttlMs,
    expiresAt,
    sessionId: record.sessionId,
    storage,
  };
};

const safeParse = <T>(
  raw: string | null
): { record: CacheRecord<T> | null; invalid: boolean } => {
  if (!raw) {
    return { record: null, invalid: false };
  }
  try {
    const value = JSON.parse(raw) as CacheRecord<T>;
    if (
      value &&
      typeof value === "object" &&
      typeof (value as CacheRecord<T>).createdAt === "number"
    ) {
      return { record: value, invalid: false };
    }
  } catch {
    // intentionally ignored; caller will drop the entry
  }
  return { record: null, invalid: true };
};

export const createLocalStorageCache = (config: CacheConfig = {}): LocalStorageCache => {
  const namespace = config.namespace ?? "ckboost:cache";
  const defaultTtlMs =
    typeof config.defaultTtlMs === "number" ? config.defaultTtlMs : 60_000;
  const sessionScoped = config.sessionScoped ?? true;
  const nowFn = config.now ?? (() => Date.now());
  const storage = resolveStorage(config.storage);
  const log = createScopedLogger(`cache:${namespace}`);

  const toStorageKey = (key: string) => `${namespace}::${key}`;

  const readRecord = <T>(key: string): { record: CacheRecord<T> | null; mode: StorageMode } => {
    const storageKey = toStorageKey(key);
    if (storage) {
      const { record, invalid } = safeParse<T>(storage.getItem(storageKey));
      if (record) {
        return { record, mode: "local-storage" };
      }
      // fall through to memory cache for backward compatibility
      if (invalid) {
        try {
          storage.removeItem(storageKey);
        } catch (error) {
          log.warn("cache_cleanup_failed", { namespace, key, error });
        }
        return { record: null, mode: "local-storage" };
      }
    }

    const memoryKey = `${storageKey}`;
    const record = (FALLBACK_MEMORY_CACHE.get(memoryKey) as CacheRecord<T> | undefined) ?? null;
    return { record, mode: "memory" };
  };

  const writeRecord = <T>(
    key: string,
    record: CacheRecord<T>,
    mode: StorageMode
  ): StorageMode => {
    const storageKey = toStorageKey(key);
    if (mode === "local-storage" && storage) {
      try {
        storage.setItem(storageKey, JSON.stringify(record));
        return "local-storage";
      } catch (error) {
        log.warn("cache_write_failed", { namespace, key, error });
      }
    }

    FALLBACK_MEMORY_CACHE.set(storageKey, record);
    return "memory";
  };

  const deleteRecord = (key: string): void => {
    const storageKey = toStorageKey(key);
    if (storage) {
      try {
        storage.removeItem(storageKey);
      } catch (error) {
        log.warn("cache_delete_failed", { namespace, key, error });
      }
    }
    FALLBACK_MEMORY_CACHE.delete(storageKey);
  };

  const shouldInvalidateBySession = (record: CacheRecord<unknown>, scoped: boolean): boolean => {
    if (!scoped) {
      return false;
    }
    if (record.sessionId === null || GLOBAL_SESSION_ID === null) {
      return false;
    }
    return record.sessionId !== GLOBAL_SESSION_ID;
  };

  const isExpired = (record: CacheRecord<unknown>, ttlOverride: number | null, now: number) => {
    const ttlMs = ttlOverride ?? record.ttlMs ?? defaultTtlMs;
    if (ttlMs === null) {
      return false;
    }
    const age = now - record.createdAt;
    return age > ttlMs;
  };

  const cache: LocalStorageCache = {
    get<T>(key: string, options: CacheGetOptions = {}): CacheLookupResult<T> | null {
      const { ttlMs: ttlOverride = undefined, allowStale = false } = options;
      const now = nowFn();
      const { record, mode } = readRecord<T>(key);
      if (!record) {
        return null;
      }

      if (record.version !== CURRENT_VERSION) {
        deleteRecord(key);
        return null;
      }

      if (shouldInvalidateBySession(record, sessionScoped)) {
        deleteRecord(key);
        return null;
      }

      const ttlMs =
        ttlOverride === undefined
          ? record.ttlMs ?? defaultTtlMs
          : ttlOverride;

      const expired = isExpired(record, ttlMs, now);
      const metadata = buildMetadata(key, namespace, record, now, mode);

      if (expired && !allowStale) {
        deleteRecord(key);
        return null;
      }

      if (expired && allowStale) {
        return {
          value: record.value as T,
          metadata,
          hit: true,
          stale: true,
        };
      }

      return {
        value: record.value as T,
        metadata,
        hit: true,
        stale: false,
      };
    },

    set<T>(key: string, value: T, options: CacheSetOptions = {}): CacheEntryMetadata | null {
      const now = nowFn();
      const ttlMs =
        options.ttlMs === undefined ? defaultTtlMs : options.ttlMs ?? null;
      const scoped =
        options.sessionScoped === undefined ? sessionScoped : options.sessionScoped;
      const record: CacheRecord<T> = {
        value,
        createdAt: now,
        ttlMs,
        sessionId: scoped ? GLOBAL_SESSION_ID : null,
        version: CURRENT_VERSION,
      };

      const mode = writeRecord(
        key,
        record,
        storage ? "local-storage" : "memory"
      );

      return buildMetadata(key, namespace, record, now, mode);
    },

    delete(key: string): void {
      deleteRecord(key);
    },

    clear(): void {
      if (storage) {
        try {
          const prefix = `${namespace}::`;
          for (let i = storage.length - 1; i >= 0; i -= 1) {
            const storageKey = storage.key(i);
            if (storageKey && storageKey.startsWith(prefix)) {
              storage.removeItem(storageKey);
            }
          }
        } catch (error) {
          log.warn("cache_clear_failed", { namespace, error });
        }
      }
      for (const key of FALLBACK_MEMORY_CACHE.keys()) {
        if (key.startsWith(`${namespace}::`)) {
          FALLBACK_MEMORY_CACHE.delete(key);
        }
      }
    },

    async withLoader<T>(
      key: string,
      loader: () => Promise<T>,
      options: CacheWithLoaderOptions = {}
    ): Promise<CacheLookupResult<T>> {
      const { refresh = false, allowStale = false } = options;
      const readTtl =
        options.ttlMs === undefined ? undefined : options.ttlMs ?? null;
      if (!refresh) {
        const cached = cache.get<T>(key, { ttlMs: readTtl, allowStale });
        if (cached && (!cached.stale || allowStale)) {
          return cached;
        }
      }

      const value = await loader();
      const writeTtl =
        options.writeTtlMs === undefined
          ? options.ttlMs === undefined
            ? undefined
            : options.ttlMs
          : options.writeTtlMs;
      const metadata =
        cache.set<T>(key, value, {
          ttlMs: writeTtl === undefined ? undefined : writeTtl,
        }) ?? (() => {
          const createdAt = nowFn();
          const ttlMsValue =
            writeTtl === undefined
              ? options.ttlMs === undefined
                ? defaultTtlMs
                : options.ttlMs ?? null
              : writeTtl ?? null;
          const fallbackRecord: CacheRecord<T> = {
            value,
            createdAt,
            ttlMs: ttlMsValue,
            sessionId: sessionScoped ? GLOBAL_SESSION_ID : null,
            version: CURRENT_VERSION,
          };
          return buildMetadata(
            key,
            namespace,
            fallbackRecord,
            createdAt,
            storage ? "local-storage" : "memory"
          );
        })();

      return {
        value,
        metadata,
        hit: false,
        stale: false,
      };
    },
  };

  return cache;
};
