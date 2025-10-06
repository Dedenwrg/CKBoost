"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ccc } from "@ckb-ccc/connector-react";
import { TippingMetadataLike, type TippingDataLike } from "ssri-ckboost/types";
import { useProtocol } from "./protocol-provider";
import { TippingService } from "../services/tipping-service";
import { debug } from "../utils/debug";

interface TippingContextType {
  tippings: TippingInfo[];
  isLoading: boolean;
  error: string | null;
  refreshTippings: () => Promise<void>;
  updateTipping: (tippingData: TippingDataLike) => Promise<string>;
  fundingSummary: Awaited<ReturnType<TippingService["getFundingSummary"]>>;
}

const TippingContext = createContext<TippingContextType | undefined>(undefined);

export function TippingProvider({ children }: { children: ReactNode }) {
  const signer = ccc.useSigner();
  const { client } = ccc.useCcc();
  const { protocolCell, protocolData } = useProtocol();

  const [tippings, setTippings] = useState<TippingInfo[]>([]);
  const [fundingSummary, setFundingSummary] =
    useState<Awaited<ReturnType<TippingService["getFundingSummary"]>>>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const service = useMemo(() => {
    if (!protocolCell) {
      return null;
    }

    try {
      return new TippingService(signer ?? undefined, null, protocolCell);
    } catch (err) {
      debug.error("Failed to initialise tipping service", err);
      return null;
    }
  }, [protocolCell, signer]);

  const refreshTippings = useCallback(async () => {
    if (!service || !protocolCell || !client) {
      setTippings([]);
      setFundingSummary(null);
      if (!service) {
        setError("Tipping service not available");
      }
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const decoded = await service.loadApprovedTippings(protocolData, client);
      setTippings(decoded);

      if (signer) {
        const summary = await service.getFundingSummary();
        setFundingSummary(summary);
      } else {
        setFundingSummary(null);
      }
    } catch (err) {
      debug.error("Failed to load tippings", err);
      setError(err instanceof Error ? err.message : "Failed to load tippings");
      setTippings([]);
      setFundingSummary(null);
    } finally {
      setIsLoading(false);
    }
  }, [service, protocolData, client, signer, protocolCell]);

  useEffect(() => {
    refreshTippings();
  }, [refreshTippings]);

  const updateTipping = useCallback(
    async (tippingData: TippingDataLike) => {
      if (!service) {
        throw new Error("Tipping service not available");
      }

      const result = await service.updateTipping(tippingData);
      await refreshTippings();
      return result;
    },
    [service, refreshTippings]
  );

  const value: TippingContextType = {
    tippings,
    isLoading,
    error,
    refreshTippings,
    updateTipping,
    fundingSummary,
  };

  return (
    <TippingContext.Provider value={value}>{children}</TippingContext.Provider>
  );
}

export function useTippingContext() {
  const context = useContext(TippingContext);
  if (!context) {
    throw new Error("useTippingContext must be used within a TippingProvider");
  }
  return context;
}

// Helper hook exposing simplified data for components

export interface TippingInfo {
  typeId: ccc.Hex;
  data: TippingDataLike;
  cell: ccc.Cell;
  metadata: TippingMetadataLike;
  comments: Array<{
    id: string;
    author: string;
    content: string;
    timestamp: string;
    likes: number;
    isLiked: boolean;
  }>;
  additionalTips: Array<{
    id: string;
    from: string;
    amount: number;
    message?: string;
    timestamp: string;
    status: "completed" | "pending";
  }>;
}
export function useTippingsData() {
  const { tippings, isLoading, error, fundingSummary } = useTippingContext();

  const decodedTippings = useMemo(() => {
    return tippings.map(
      (tipping: TippingInfo) =>
        ({
          typeId: tipping.typeId,
          data: tipping.data,
          cell: tipping.cell,
          metadata: tipping.data.metadata,
        } as TippingInfo)
    );
  }, [tippings]);

  return {
    tippings: decodedTippings,
    isLoading,
    error,
    fundingSummary,
    totalTippings: decodedTippings.length,
  };
}
