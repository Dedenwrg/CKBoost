"use client";

import React, { useRef } from 'react';
import { NostrContext } from '@nostrify/react';
import { NPool, NRelay1 } from '@nostrify/nostrify'

export const DEFAULT_NOSTR_RELAYS = [
  'wss://relay.damus.io',     // Most reliable
  'wss://nos.lol',             // Good uptime  
  'wss://relay.nostr.band',    // Comprehensive
  'wss://relay.primal.net',    // Primal relay
];

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

  return (
    <NostrContext.Provider value={{ nostr: poolRef.current }}>
      <>{children}</>
    </NostrContext.Provider>
  );
}

// Re-export the useNostr hook from @nostrify/react
export { useNostr } from '@nostrify/react';
