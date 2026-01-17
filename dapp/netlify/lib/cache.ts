import { createLogger } from "@/netlify/lib/log";

const log = createLogger("cache");

type CacheRecord<T> = {
  value: T;
  createdAt: number;
};

export type CacheLookupResult<T> = {
  value: T;
  metadata: CacheMetadata;
  hit: boolean;
};

type CacheLike = {
  match: (request: RequestInfo | URL) => Promise<Response | undefined>;
  put: (request: RequestInfo | URL, response: Response) => Promise<void>;
  delete: (request: RequestInfo | URL) => Promise<boolean>;
};

type CacheStorageLike = {
  open: (name: string) => Promise<CacheLike>;
  default?: CacheLike | Promise<CacheLike>;
};

type CacheBinding =
  | CacheLike
  | CacheStorageLike
  | {
      default?: CacheLike | Promise<CacheLike>;
      open?: (name: string) => Promise<CacheLike>;
    };

export type CacheMetadata = {
  key: string;
  namespace: string;
  createdAt: number;
  ageMs: number;
  ttlMs?: number;
};

type WaitUntilFn = ((promise: Promise<unknown>) => void) | null | undefined;

export type CacheReadOptions = {
  namespace?: string;
  cacheBinding?: CacheBinding | null;
};

export type CacheWriteOptions = CacheReadOptions & {
  waitUntil?: WaitUntilFn;
};

export type CacheControlOptions = CacheReadOptions & {
  skipCache?: boolean;
  ttlMs?: number;
  waitUntil?: WaitUntilFn;
};

const DEFAULT_NAMESPACE = "ckboost:default";
const KEY_PREFIX = "ckboost::";

const memoryCache = new Map<string, CacheRecord<unknown>>();
let cacheApiAvailable = true;

const resolveCacheStorage = async (
  namespace: string,
  cacheBinding?: CacheBinding | null
): Promise<CacheLike | null> => {
  if (!cacheApiAvailable) {
    return null;
  }

  if (cacheBinding) {
    const defaultCandidate = (
      cacheBinding as { default?: CacheLike | Promise<CacheLike> }
    ).default;
    if (defaultCandidate) {
      try {
        const resolved = await Promise.resolve(defaultCandidate);
        if (resolved) {
          return resolved;
        }
      } catch (error) {
        log.warn("cache_default_failed", { namespace, error });
      }
    }

    if (isCache(cacheBinding)) {
      return cacheBinding;
    }

    if (
      typeof (cacheBinding as CacheStorageLike).open === "function" &&
      cacheBinding !== null
    ) {
      try {
        return await (cacheBinding as CacheStorageLike).open(namespace);
      } catch (error) {
        log.warn("cache_open_failed", { namespace, error });
        return null;
      }
    }
  }

  const isNetlifyRuntime =
    process.env.NETLIFY === "true" || process.env.NETLIFY_DEV === "true";

  if (isNetlifyRuntime) {
    return null;
  }

  const maybeCaches = (
    globalThis as unknown as {
      caches?: CacheStorageLike;
    }
  )?.caches;

  if (!maybeCaches || typeof maybeCaches.open !== "function") {
    return null;
  }

  try {
    return await maybeCaches.open(namespace);
  } catch (error) {
    log.warn("cache_open_failed", { namespace, error });
    return null;
  }
};

const toInternalKey = (key: string) => `${KEY_PREFIX}${key}`;

const buildMetadata = (
  key: string,
  namespace: string,
  createdAt: number,
  ttlMs: number | undefined
): CacheMetadata => ({
  key,
  namespace,
  createdAt,
  ageMs: Date.now() - createdAt,
  ttlMs,
});

export const readCache = async <T>(
  key: string,
  options: CacheReadOptions = {}
): Promise<CacheLookupResult<T> | null> => {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const cacheBinding = options.cacheBinding ?? undefined;
  const internalKey = toInternalKey(key);
  const cache = await resolveCacheStorage(namespace, cacheBinding);

  if (cache) {
    const response = await cache.match(internalKey);
    if (!response) {
      return null;
    }

    try {
      const body = (await response.json()) as CacheRecord<T>;
      // log.info("cache_read_hit", {
      //   key,
      //   namespace,
      //   storage: "netlify",
      //   ageMs: Date.now() - body.createdAt,
      // });
      return {
        value: body.value,
        hit: true,
        metadata: buildMetadata(key, namespace, body.createdAt, undefined),
      };
    } catch (error) {
      log.warn("cache_parse_failed", { key, namespace, error });
      return null;
    }
  }

  const record = memoryCache.get(`${namespace}:${internalKey}`);
  if (!record) {
    return null;
  }

  // log.info("cache_read_hit", {
  //   key,
  //   namespace,
  //   storage: "memory",
  //   ageMs: Date.now() - record.createdAt,
  // });

  return {
    value: record.value as T,
    hit: true,
    metadata: buildMetadata(key, namespace, record.createdAt, undefined),
  };
};

export const writeCache = async <T>(
  key: string,
  value: T,
  options: CacheWriteOptions = {}
): Promise<CacheMetadata> => {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const cacheBinding = options.cacheBinding ?? undefined;
  const waitUntil = options.waitUntil;
  const internalKey = toInternalKey(key);
  const createdAt = Date.now();
  const cache = await resolveCacheStorage(namespace, cacheBinding);
  const record: CacheRecord<T> = { value, createdAt };
  const memoryKey = `${namespace}:${internalKey}`;

  if (cache) {
    const putPromise = cache.put(
      internalKey,
      new Response(JSON.stringify(record), {
        headers: {
          "Content-Type": "application/json",
          "X-Cache-Created-At": createdAt.toString(),
        },
      })
    );

    if (waitUntil) {
      const task = putPromise
        .then(() => {
          log.info("cache_write_success", {
            key,
            namespace,
            storage: "netlify",
          });
        })
        .catch((error) => {
          log.warn("cache_write_failed", { key, namespace, error });
          memoryCache.set(memoryKey, record);
          log.info("cache_write_success", {
            key,
            namespace,
            storage: "memory-fallback",
          });
          cacheApiAvailable = false;
        });
      waitUntil(task);
    } else {
      try {
        await putPromise;
        log.info("cache_write_success", {
          key,
          namespace,
          storage: "netlify",
        });
      } catch (error) {
        log.warn("cache_write_failed", { key, namespace, error });
        memoryCache.set(memoryKey, record);
        log.info("cache_write_success", {
          key,
          namespace,
          storage: "memory-fallback",
        });
        cacheApiAvailable = false;
      }
    }
  } else {
    memoryCache.set(memoryKey, record);
    log.info("cache_write_success", {
      key,
      namespace,
      storage: "memory",
    });
  }

  return buildMetadata(key, namespace, createdAt, undefined);
};

const isCache = (value: unknown): value is CacheLike => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const maybe = value as Record<string, unknown>;
  return (
    typeof maybe.match === "function" &&
    typeof maybe.put === "function" &&
    typeof maybe.delete === "function"
  );
};

export const deleteCache = async (
  key: string,
  options: CacheReadOptions = {}
): Promise<boolean> => {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const cacheBinding = options.cacheBinding ?? undefined;
  const internalKey = toInternalKey(key);
  let deleted = false;
  const cache = await resolveCacheStorage(namespace, cacheBinding);

  if (cache) {
    try {
      deleted = await cache.delete(internalKey);
    } catch (error) {
      log.warn("cache_delete_failed", { key, namespace, error });
    }
  }

  if (memoryCache.delete(`${namespace}:${internalKey}`)) {
    deleted = true;
  }

  return deleted;
};

export const withCache = async <T>(
  key: string,
  loader: () => Promise<T>,
  options: CacheControlOptions = {}
): Promise<CacheLookupResult<T>> => {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const cacheBinding = options.cacheBinding ?? undefined;
  const waitUntil = options.waitUntil;
  const requestedTtl = options.ttlMs;
  const ttlMs =
    typeof requestedTtl === "number" && requestedTtl > 0
      ? requestedTtl
      : undefined;
  const skipCache = options.skipCache ?? false;
  const disableCaching =
    typeof requestedTtl === "number" && requestedTtl <= 0 ? true : false;

  if (!skipCache && !disableCaching) {
    const cached = await readCache<T>(key, { namespace, cacheBinding });
    if (cached) {
      if (ttlMs === undefined || cached.metadata.ageMs <= ttlMs) {
        return {
          value: cached.value,
          hit: true,
          metadata: { ...cached.metadata, ttlMs },
        };
      }
    }
  }

  const value = await loader();

  if (disableCaching) {
    const createdAt = Date.now();
    return {
      value,
      metadata: { key, namespace, createdAt, ageMs: 0, ttlMs },
      hit: false,
    };
  }

  const metadata = await writeCache(key, value, {
    namespace,
    cacheBinding,
    waitUntil,
  });

  return {
    value,
    metadata: { ...metadata, ttlMs },
    hit: false,
  };
};

export const getCacheAgeMs = (metadata?: CacheMetadata | null): number => {
  if (!metadata) return Number.POSITIVE_INFINITY;
  return Date.now() - metadata.createdAt;
};
