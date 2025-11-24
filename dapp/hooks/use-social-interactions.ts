import { useState, useEffect } from "react";
import { createScopedLogger } from "ssri-ckboost";

const log = createScopedLogger("useSocialInteractions");

export interface SocialInteractions {
  commentsCount: number;
  likesCount: number;
  totalTipAmount: string;
}

type SocialInput = { id: string; targetEventId?: string | null };

export function useSocialInteractions(inputs: SocialInput[]) {
  const [stats, setStats] = useState<Record<string, SocialInteractions>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idsKey = JSON.stringify(inputs);

  useEffect(() => {
    if (!inputs.length) return;

    const fetchStats = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const results = await Promise.all(
          inputs.map(async ({ id, targetEventId }) => {
            if (!id || !targetEventId) return null;
            const params = new URLSearchParams();
            params.append("mode", "stats");
            params.append("id", id);
            params.append("targetEventId", targetEventId);
            const response = await fetch(
              `/api/social-interactions?${params.toString()}`
            );
            if (!response.ok) {
              throw new Error(
                `Failed to fetch interactions for ${id}: ${response.statusText}`
              );
            }
            const data = await response.json();
            return { id, data };
          })
        );

        const next: Record<string, SocialInteractions> = {};
        results.forEach((item) => {
          if (item) next[item.id] = item.data;
        });
        setStats(next);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to fetch social interactions";
        log.error(message, err);
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchStats();
  }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return { stats, isLoading, error };
}
