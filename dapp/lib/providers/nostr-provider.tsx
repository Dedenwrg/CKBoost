"use client";

import React, { useEffect, useRef } from "react";
import { NostrContext } from "@nostrify/react";
import { NPool, NRelay1 } from "@nostrify/nostrify";
import {
  DEFAULT_NOSTR_RELAYS as BUILTIN_NOSTR_RELAYS,
  parseRelayList,
} from "@/lib/nostr/relay-core";
import { flushNostrRelayRepairQueue } from "@/lib/nostr/relay-repair-queue";

export const DEFAULT_NOSTR_RELAYS = parseRelayList(
  process.env.NEXT_PUBLIC_NOSTR_RELAYS,
  BUILTIN_NOSTR_RELAYS
);

/**
 * Nostr Provider component for the app
 * Provides Nostr pool functionality via context
 */
interface NostrProviderProps {
  children: React.ReactNode;
}

export function NostrProvider({ children }: NostrProviderProps) {
  // Create a stable pool instance using useRef
  const poolRef = useRef<NPool | undefined>(undefined);

  if (!poolRef.current) {
    poolRef.current = new NPool({
      open(url: string) {
        return new NRelay1(url);
      },
      reqRouter(filters) {
        // Route all filters to all relays
        return new Map(DEFAULT_NOSTR_RELAYS.map((url) => [url, filters]));
      },
      eventRouter() {
        // Send events to all relays
        return DEFAULT_NOSTR_RELAYS;
      },
    });
  }

  useEffect(() => {
    const pool = poolRef.current;
    if (!pool) return;
    void flushNostrRelayRepairQueue(pool);
    const interval = window.setInterval(() => {
      void flushNostrRelayRepairQueue(pool);
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <NostrContext.Provider value={{ nostr: poolRef.current }}>
      <>{children}</>
    </NostrContext.Provider>
  );
}

// Re-export the useNostr hook from @nostrify/react
export { useNostr } from "@nostrify/react";
