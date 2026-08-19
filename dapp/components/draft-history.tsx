"use client"

import { useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import type { ReactJsonViewProps } from "react-json-view"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { DraftVersion, DraftStore } from "@/lib/utils/draft-storage"
import { History, RotateCcw, Save } from "lucide-react"
import { useTheme } from "next-themes"
import { createScopedLogger } from "ssri-ckboost"

const log = createScopedLogger("DraftHistory")

export interface DraftHistoryStorage<T> {
  load: DraftStore<T>["load"]
  save: DraftStore<T>["save"]
  history: DraftStore<T>["history"]
  clear: DraftStore<T>["clear"]
}

export interface DraftHistoryProps<T> {
  title?: string
  storage: DraftHistoryStorage<T>
  data: T
  isEmpty: (data: T) => boolean
  onRestore: (data: T) => void
  onClear?: () => void
  getVersionLabel?: (data: T, savedAt: number, index: number) => string
  pollMs?: number
  className?: string
}

export function DraftHistory<T>(props: DraftHistoryProps<T>) {
  const {
    title = "Draft Autosave",
    storage,
    data,
    isEmpty,
    onRestore,
    onClear,
    getVersionLabel,
    pollMs = 3000,
    className,
  } = props

  const [versions, setVersions] = useState<DraftVersion<T>[]>([])
  const [expanded, setExpanded] = useState(false)
  const [openPreview, setOpenPreview] = useState<Record<string, boolean>>({})

  // Load react-json-view only on client
  const ReactJson = useMemo(
    () => dynamic<ReactJsonViewProps>(() => import("react-json-view"), { ssr: false }),
    []
  )

  const { resolvedTheme } = useTheme()
  const jsonTheme = useMemo(() => (resolvedTheme === 'dark' ? 'monokai' : 'rjv-default'), [resolvedTheme])

  const lastSavedAt = useMemo(() => {
    if (!versions.length) return null as number | null
    return versions[versions.length - 1].savedAt
  }, [versions])

  const refresh = () => {
    try {
      const h = storage.history()
      setVersions(h)
    } catch {
      setVersions([])
    }
  }

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, Math.max(1000, pollMs))
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleManualSave = () => {
    storage.save(data, { force: true })
    refresh()
  }

  const handleRestore = (v: DraftVersion<T>) => {
    try {
      if (!isEmpty(data)) {
        const shouldSave = window.confirm(
          "Current draft is not empty. Save a version before restoring?"
        )
        if (shouldSave) storage.save(data, { force: true })
      }
      onRestore(v.data)
      refresh()
    } catch (e) {
      log.error("Failed to restore draft: ", e)
      alert("Failed to restore draft")
    }
  }

  const handleClear = () => {
    if (!versions.length) return
    const ok = window.confirm("Clear all saved draft versions?")
    if (!ok) return
    storage.clear()
    onClear?.()
    refresh()
  }

  const togglePreview = (key: string) => {
    setOpenPreview((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const toInspectableObject = (data: T): object => {
    if (Array.isArray(data)) return data as unknown[]
    if (data && typeof data === "object") return data as Record<string, unknown>
    return { value: data as unknown }
  }

  const formatTime = (ts: number | null) => {
    if (!ts) return "Never"
    try {
      return new Date(ts).toLocaleString()
    } catch {
      return String(ts)
    }
  }

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">Autosave On</Badge>
          <Button onClick={handleManualSave} size="sm" variant="outline">
            <Save className="w-4 h-4 mr-1" /> Save Now
          </Button>
          <Button onClick={() => setExpanded((v) => !v)} size="sm" variant="ghost">
            <History className="w-4 h-4 mr-1" /> {expanded ? "Hide History" : `Show History (${versions.length})`}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-sm text-muted-foreground mb-2">
          Last saved: <span className="font-medium text-foreground">{formatTime(lastSavedAt)}</span>
        </div>
        {expanded && (
          <div className="space-y-2">
            {!versions.length ? (
              <div className="text-sm text-muted-foreground">No saved versions yet.</div>
            ) : (
              versions
                .map((v, idx) => ({ v, idx }))
                .sort((a, b) => b.v.savedAt - a.v.savedAt)
                .map(({ v, idx }) => {
                  const key = `${v.signature}-${v.savedAt}`
                  const isOpen = !!openPreview[key]
                  return (
                    <div key={key} className="rounded-md border">
                      <div className="flex items-center justify-between p-2">
                        <div className="text-sm">
                          <div className="font-medium">
                            {getVersionLabel ? getVersionLabel(v.data, v.savedAt, idx) : new Date(v.savedAt).toLocaleString()}
                          </div>
                          <div className="text-muted-foreground text-xs break-all">{v.signature.slice(0, 16)}…</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="secondary" onClick={() => togglePreview(key)}>
                            {isOpen ? "Hide JSON" : "Preview JSON"}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleRestore(v)}>
                            <RotateCcw className="w-4 h-4 mr-1" /> Restore
                          </Button>
                        </div>
                      </div>
                      {isOpen && (
                        <div className="border-t p-2 bg-muted/30">
                          <ReactJson
                            name={false}
                            collapsed={2}
                            enableClipboard={false}
                            displayDataTypes={false}
                            theme={jsonTheme}
                            src={toInspectableObject(v.data)}
                          />
                        </div>
                      )}
                    </div>
                  )
                })
            )}
            {!!versions.length && (
              <div className="pt-2">
                <Button size="sm" variant="destructive" onClick={handleClear}>
                  Clear All Versions
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default DraftHistory
