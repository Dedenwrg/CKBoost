"use client";

import { Navigation } from "@/components/navigation";
import { Loader2 } from "lucide-react";

const placeholderCards = new Array(3).fill(null);
const placeholderRows = new Array(4).fill(null);

interface PageLoadingProps {
  title?: string;
  description?: string;
  showNavigation?: boolean;
  statusLabel?: string;
}

export function PageLoading({
  title = "Loading CKBoost",
  description = "Fetching the latest protocol, campaign, and tipping data.",
  showNavigation = true,
  statusLabel = "Content is loading",
}: PageLoadingProps) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-muted/40 to-background">
      {showNavigation && <Navigation />}
      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-12">
        <section
          className="rounded-3xl border border-border/50 bg-background/80 p-10 text-center shadow-xl backdrop-blur"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="mx-auto flex max-w-md flex-col items-center gap-4">
            <Loader2
              className="h-10 w-10 animate-spin text-primary"
              aria-hidden="true"
            />
            <div>
              <p className="text-lg font-semibold tracking-tight">{title}</p>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
          </div>
          <span className="sr-only">{statusLabel}</span>
        </section>

        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {placeholderCards.map((_, index) => (
            <div
              key={index}
              className="flex h-40 flex-col justify-between rounded-2xl border border-border/60 bg-muted/50 p-6 shadow-sm"
            >
              <div className="space-y-3">
                <div className="h-4 w-28 animate-pulse rounded-full bg-primary/20" />
                <div className="h-3 w-2/3 animate-pulse rounded-full bg-foreground/10" />
                <div className="h-3 w-1/2 animate-pulse rounded-full bg-foreground/10" />
              </div>
              <div className="flex gap-2">
                <div className="h-8 flex-1 animate-pulse rounded-full bg-primary/10" />
                <div className="h-8 w-16 animate-pulse rounded-full bg-primary/20" />
              </div>
            </div>
          ))}
        </section>

        <section className="rounded-3xl border border-border/50 bg-background/80 p-6 shadow-xl backdrop-blur">
          <div className="mb-6 h-6 w-48 animate-pulse rounded-full bg-primary/20" />
          <div className="space-y-4">
            {placeholderRows.map((_, index) => (
              <div
                key={index}
                className="flex flex-wrap gap-4 rounded-2xl border border-dashed border-border/60 p-4"
              >
                <div className="h-12 min-w-[140px] flex-1 animate-pulse rounded-2xl bg-muted/70" />
                <div className="h-12 min-w-[140px] flex-1 animate-pulse rounded-2xl bg-muted/60" />
                <div className="h-12 min-w-[140px] flex-1 animate-pulse rounded-2xl bg-muted/50" />
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
