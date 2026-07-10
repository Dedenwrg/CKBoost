"use client"

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react"
import { NostrStorageModal } from "@/components/nostr-storage-modal"
import type { RelayAttemptResult } from "@/lib/nostr/relay-core"

type Mode = "storing" | "verifying"

type OpenArgs = {
  neventId: string
  onConfirm: () => Promise<string | void>
  onClose?: () => void
  mode?: Mode
  label?: string
  contentHint?: "image" | "html" | "text"
  queuePosition?: number
  queueTotal?: number
  queueItems?: Array<{
    neventId: string
    label?: string
    contentHint?: "image" | "html" | "text"
  }>
  queueIndex?: number
  cachedPayloads?: Record<string, { content: string; metadata: Record<string, string> }>
  relayAttempts?: RelayAttemptResult[]
  verifiedRelays?: string[]
  requiredRelayCopies?: number
}

type StorageModalContextType = {
  open: (args: OpenArgs) => void
  close: () => void
  isOpen: boolean
}

const StorageModalContext = createContext<StorageModalContextType | null>(null)

export function useStorageModal() {
  const ctx = useContext(StorageModalContext)
  if (!ctx) throw new Error("useStorageModal must be used within StorageModalProvider")
  return ctx
}

export function StorageModalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [neventId, setNeventId] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>("verifying")
  const [label, setLabel] = useState<string | undefined>(undefined)
  const [contentHint, setContentHint] = useState<"image" | "html" | "text" | undefined>(undefined)
  const [queuePosition, setQueuePosition] = useState<number | undefined>(undefined)
  const [queueTotal, setQueueTotal] = useState<number | undefined>(undefined)
  const [queueItems, setQueueItems] = useState<
    Array<{
      neventId: string
      label?: string
      contentHint?: "image" | "html" | "text"
    }>
  >([])
  const [queueIndex, setQueueIndex] = useState<number | undefined>(undefined)
  const [cachedPayloads, setCachedPayloads] = useState<Record<string, { content: string; metadata: Record<string, string> }>>({})
  const [relayAttempts, setRelayAttempts] = useState<RelayAttemptResult[]>([])
  const [verifiedRelays, setVerifiedRelays] = useState<string[]>([])
  const [requiredRelayCopies, setRequiredRelayCopies] = useState<number | undefined>(undefined)
  const onConfirmRef = useRef<(() => Promise<string | void>) | null>(null)
  const onCloseRef = useRef<(() => void) | null>(null)

  const open = useCallback((args: OpenArgs) => {
    setNeventId(args.neventId)
    onConfirmRef.current = args.onConfirm
    onCloseRef.current = args.onClose ?? null
    setMode(args.mode || "verifying")
    setLabel(args.label)
    setContentHint(args.contentHint)
    setQueuePosition(args.queuePosition)
    setQueueTotal(args.queueTotal)
    setQueueItems(args.queueItems || [])
    setQueueIndex(args.queueIndex)
    setCachedPayloads(args.cachedPayloads || {})
    setRelayAttempts(args.relayAttempts || [])
    setVerifiedRelays(args.verifiedRelays || [])
    setRequiredRelayCopies(args.requiredRelayCopies)
    setIsOpen(true)
  }, [])

  const close = useCallback(() => {
    setIsOpen(false)
  }, [])

  const handleClose = useCallback(() => {
    setIsOpen(false)
    // fire last provided onClose
    try { onCloseRef.current?.() } catch {}
    // do not clear refs immediately to allow finishing renders
    setLabel(undefined)
    setContentHint(undefined)
    setQueuePosition(undefined)
    setQueueTotal(undefined)
    setQueueItems([])
    setQueueIndex(undefined)
    setCachedPayloads({})
    setRelayAttempts([])
    setVerifiedRelays([])
    setRequiredRelayCopies(undefined)
  }, [])

  const handleConfirm = useCallback(async () => {
    if (!onConfirmRef.current) return undefined
    return onConfirmRef.current()
  }, [])

  const value = useMemo(() => ({ open, close, isOpen }), [open, close, isOpen])

  return (
    <StorageModalContext.Provider value={value}>
      {children}
      <NostrStorageModal
        isOpen={isOpen}
        onClose={handleClose}
        neventId={neventId}
        onConfirm={handleConfirm}
        mode={mode}
        label={label}
        contentHint={contentHint}
        queuePosition={queuePosition}
        queueTotal={queueTotal}
        queueItems={queueItems}
        queueIndex={queueIndex}
        cachedPayloads={cachedPayloads}
        relayAttempts={relayAttempts}
        verifiedRelays={verifiedRelays}
        requiredRelayCopies={requiredRelayCopies}
      />
    </StorageModalContext.Provider>
  )
}
