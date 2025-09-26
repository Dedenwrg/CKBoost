// Generic draft storage with versioning in localStorage
// - Stable signatures via normalized JSON (sorted keys, bigint->string)
// - Keeps up to `versionLimit` versions (default 10)

export interface DraftVersion<T> {
  savedAt: number
  data: T
  signature: string
}

export interface SaveResult {
  saved: boolean
  skipped: boolean
  versions: number
}

export interface DraftStore<T> {
  load: () => T | null
  save: (data: T, opts?: { force?: boolean }) => SaveResult
  history: () => DraftVersion<T>[]
  clear: () => void
}

export interface DraftStoreOptions<T> {
  storageKey: string // base key, e.g. "ckboost_campaign_create"
  versionLimit?: number // default 10
  canonicalize?: (data: T) => unknown // optional: transform to canonical shape before normalization
}

// Normalize values for JSON storage and stable signature
// - Sort object keys
// - Convert bigint to string
// - Convert Map/Set to sorted arrays
// - Convert Date to ISO string
export function normalizeForStorage(value: unknown): unknown {
  const seen = new WeakSet<object>()

  const normalize = (val: unknown): unknown => {
    if (typeof val === 'bigint') return val.toString()
    if (val instanceof Date) return val.toISOString()

    if (Array.isArray(val)) return val.map((v) => normalize(v))

    // Map -> sorted array of [key, value]
    if (val instanceof Map) {
      const arr = Array.from(val.entries()).map(([k, v]) => [normalize(k), normalize(v)])
      arr.sort((a, b) => JSON.stringify(a[0]).localeCompare(JSON.stringify(b[0])))
      return arr
    }

    // Set -> sorted array of values
    if (val instanceof Set) {
      const arr = Array.from(val.values()).map((v) => normalize(v))
      arr.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      return arr
    }

    if (val && typeof val === 'object') {
      if (seen.has(val as object)) {
        // Avoid cycles – replace with string marker
        return '[Circular]'
      }
      seen.add(val as object)

      const obj = val as Record<string, unknown>
      const keys = Object.keys(obj).sort()
      const out: Record<string, unknown> = {}
      for (const k of keys) out[k] = normalize(obj[k])
      return out
    }

    return val
  }

  return normalize(value)
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForStorage(value))
}

export function createDraftStore<T>(opts: DraftStoreOptions<T>): DraftStore<T> {
  const {
    storageKey,
    versionLimit = 10,
    canonicalize,
  } = opts

  const CURRENT_KEY = `${storageKey}_current`
  const HISTORY_KEY = `${storageKey}_history`

  const load = (): T | null => {
    try {
      const raw = localStorage.getItem(CURRENT_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      return parsed as T
    } catch {
      return null
    }
  }

  const history = (): DraftVersion<T>[] => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed as DraftVersion<T>[]
      return []
    } catch {
      return []
    }
  }

  const save = (data: T, opts?: { force?: boolean }): SaveResult => {
    try {
      const input = canonicalize ? canonicalize(data) : data
      const safeData = normalizeForStorage(input) as T
      const signature = stableStringify(input)

      const versions = history()
      const last = versions[versions.length - 1]

      // Deduplicate unless forced
      if (!opts?.force && last && last.signature === signature) {
        localStorage.setItem(CURRENT_KEY, JSON.stringify(safeData))
        return { saved: false, skipped: true, versions: versions.length }
      }

      const entry: DraftVersion<T> = {
        savedAt: Date.now(),
        data: safeData,
        signature,
      }
      versions.push(entry)
      while (versions.length > versionLimit) versions.shift()

      localStorage.setItem(CURRENT_KEY, JSON.stringify(safeData))
      localStorage.setItem(HISTORY_KEY, JSON.stringify(versions))
      return { saved: true, skipped: false, versions: versions.length }
    } catch {
      return { saved: false, skipped: true, versions: history().length }
    }
  }

  const clear = (): void => {
    try {
      localStorage.removeItem(CURRENT_KEY)
      localStorage.removeItem(HISTORY_KEY)
    } catch {
      // ignore
    }
  }

  return { load, save, history, clear }
}

