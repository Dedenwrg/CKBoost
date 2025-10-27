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
import { ccc, ssri } from "@ckb-ccc/connector-react";
import {
  ConnectedTypeID,
  TippingMetadataLike,
  type TippingDataLike,
  type UDTAssetLike,
} from "ssri-ckboost/types";
import { useProtocol } from "./protocol-provider";
import {
  TippingService,
  InsufficientTippingFundingError,
  type FundingShortage,
} from "../services/tipping-service";
import { createScopedLogger } from "ssri-ckboost";
import { Tipping } from "ssri-ckboost/tipping";
import { deploymentManager } from "../ckb/deployment-manager";

interface TippingContextType {
  tippings: TippingInfo[];
  isLoading: boolean;
  error: string | null;
  refreshTippings: () => Promise<void>;
  updateTipping: (tipping: TippingInfo) => Promise<string>;
  fundingSummary: Awaited<ReturnType<TippingService["getFundingSummary"]>>;
  fundProtocolWithCKB: (amount: bigint) => Promise<string>;
  fundProtocolWithUDT: (assets: UDTAssetLike[]) => Promise<string>;
  fundingShortage: FundingShortage | null;
}

const TippingContext = createContext<TippingContextType | undefined>(undefined);

const log = createScopedLogger("TippingProvider");

export function TippingProvider({ children }: { children: ReactNode }) {
  const signer = ccc.useSigner();
  const { client } = ccc.useCcc();
  const { protocolCell, protocolData } = useProtocol();

  const [tippings, setTippings] = useState<TippingInfo[]>([]);
  const [fundingSummary, setFundingSummary] =
    useState<Awaited<ReturnType<TippingService["getFundingSummary"]>>>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fundingShortage, setFundingShortage] =
    useState<FundingShortage | null>(null);

  const service = useMemo(() => {
    if (!protocolCell) {
      return null;
    }

    try {
      return new TippingService(signer ?? undefined, null, protocolCell);
    } catch (err) {
      log.error("Failed to initialise tipping service", err);
      return null;
    }
  }, [protocolCell, signer]);

  const refreshTippings = useCallback(async () => {
    if (!service || !protocolCell || !client) {
      setTippings([]);
      setFundingSummary(null);
      setFundingShortage(null);
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
      setFundingShortage(null);

      if (signer) {
        const summary = await service.getFundingSummary();
        setFundingSummary(summary);
      } else {
        setFundingSummary(null);
      }
    } catch (err) {
      log.error("Failed to load tippings", err);
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
    async (tipping: TippingInfo): Promise<string> => {
      if (!service) {
        throw new Error("Tipping service not available");
      }

      if (!protocolCell) {
        throw new Error("Protocol cell not available");
      }

      const executor = new ssri.ExecutorJsonRpc(
        process.env.NEXT_PUBLIC_SSRI_EXECUTOR_URL || "http://localhost:9090"
      );

      const network = deploymentManager.getCurrentNetwork();
      const codeOutPoint = deploymentManager.getContractOutPoint(
        network,
        "ckboostTippingType"
      );
      if (!codeOutPoint) {
        log.warn(
          "Tipping type contract out point not found in deployments.json"
        );
        throw new Error(
          "Tipping type contract out point not found in deployments.json"
        );
      }

      const protocolTypeHash = protocolCell.cellOutput.type?.hash();
      if (!protocolTypeHash) {
        log.warn("Protocol cell missing type hash");
        throw new Error("Protocol cell missing type hash");
      }

      let tippingCodeArgs;

      if (tipping.typeId) {
        tippingCodeArgs = ConnectedTypeID.encode({
          type_id: tipping.typeId,
          connected_key: protocolTypeHash,
        });
      } else {
        tippingCodeArgs = ConnectedTypeID.encode({
          type_id: ("0x" + "00".repeat(32)) as ccc.Hex,
          connected_key: protocolTypeHash,
        });
      }

      const tippingTypeCodeHash = deploymentManager.getContractCodeHash(
        network,
        "ckboostTippingType"
      );
      if (!tippingTypeCodeHash) {
        throw new Error("Tipping type contract not deployed");
      }

      const script = ccc.Script.from({
        codeHash: tippingTypeCodeHash,
        hashType: "type" as const,
        args: ccc.hexFrom(tippingCodeArgs),
      });

      const newTippingInstance = new Tipping(
        codeOutPoint,
        script,
        protocolCell,
        { executor }
      );

      await service.setTipping(newTippingInstance);

      try {
        const result = await service.updateTipping(tipping.data);
        setFundingShortage(null);
        await refreshTippings();
        return result;
      } catch (err) {
        if (err instanceof InsufficientTippingFundingError) {
          setFundingShortage(err.shortage);
        }
        throw err;
      }
    },
    [service, refreshTippings]
  );

  const fundProtocolWithCKB = useCallback(
    async (amount: bigint): Promise<string> => {
      if (!service) {
        throw new Error("Tipping service not available");
      }

      const txHash = await service.fundProtocolWithCKB(amount);
      setFundingShortage(null);
      await refreshTippings();
      return txHash;
    },
    [service, refreshTippings]
  );

  const fundProtocolWithUDT = useCallback(
    async (assets: UDTAssetLike[]): Promise<string> => {
      if (!service) {
        throw new Error("Tipping service not available");
      }

      const txHash = await service.fundProtocolWithUDT(assets);
      setFundingShortage(null);
      await refreshTippings();
      return txHash;
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
    fundProtocolWithCKB,
    fundProtocolWithUDT,
    fundingShortage,
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
  typeId?: ccc.Hex;
  data: TippingDataLike;
  cell?: ccc.Cell;
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
          comments: tipping.comments,
          additionalTips: tipping.additionalTips,
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

export function useTipping(
  protocolCell: ccc.Cell | null,
  tippingTypeId: ccc.Hex
) {
  const { tippings, isLoading, error } = useTippingsData();

  const tipping = tippings.find((tipping) => tipping.typeId === tippingTypeId);

  return {
    tipping,
    isLoading,
    error,
  };
}
