import { useState, useEffect } from "react";
import { createScopedLogger } from "ssri-ckboost";

const log = createScopedLogger("useSocialInteractions");

export interface SocialInteractions {
  commentsCount: number;
  likesCount: number;
  totalTipAmount: string;
}

export function useSocialInteractions(tippingTypeIds: string[]) {
  const [stats, setStats] = useState<Record<string, SocialInteractions>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idsKey = JSON.stringify(tippingTypeIds);

  useEffect(() => {
    if (!tippingTypeIds.length) return;

    const fetchStats = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const queryParams = new URLSearchParams();
        queryParams.append("mode", "stats");
        tippingTypeIds.forEach((id) => queryParams.append("ids", id));

        const response = await fetch(
          `/api/social-interactions?${queryParams.toString()}`
        );
        if (!response.ok) {
          throw new Error(
            `Failed to fetch interactions: ${response.statusText}`
          );
        }

        const data = await response.json();
        setStats(data);
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
