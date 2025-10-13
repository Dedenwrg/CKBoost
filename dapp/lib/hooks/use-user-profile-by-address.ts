"use client";

import { useEffect, useMemo, useState } from "react";
import { ccc } from "@ckb-ccc/connector-react";
import { ckboost } from "ssri-ckboost";
import { useProtocol } from "@/lib/providers/protocol-provider";
import {
  extractTypeIdFromUserCell,
  getLatestUserCellByAddress,
  parseUserData,
} from "@/lib/ckb/user-cells";

type UserDataType = ReturnType<typeof ckboost.types.UserData.decode>;

interface UserProfileState {
  userData: UserDataType | null;
  userTypeId: ccc.Hex | null;
  isFetching: boolean;
  error: string | null;
}

export function useUserProfileByAddress(address: string | null) {
  const { client } = ccc.useCcc();
  const {
    protocolData,
    protocolCell,
    isLoading: protocolLoading,
    error: protocolError,
  } = useProtocol();

  const [state, setState] = useState<UserProfileState>({
    userData: null,
    userTypeId: null,
    isFetching: false,
    error: null,
  });

  useEffect(() => {
    if (!address) {
      setState({
        userData: null,
        userTypeId: null,
        isFetching: false,
        error: null,
      });
      return;
    }

    if (
      !client ||
      !protocolData ||
      !protocolCell ||
      !protocolCell.cellOutput.type
    ) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      setState({
        userData: null,
        userTypeId: null,
        isFetching: true,
        error: null,
      });

      try {
        const userTypeCodeHash =
          protocolData.protocol_config.script_code_hashes
            .ckb_boost_user_type_code_hash;
        const protocolTypeHash = protocolCell.cellOutput.type?.hash();

        const cell = await getLatestUserCellByAddress(
          address,
          client,
          userTypeCodeHash,
          protocolTypeHash
        );

        if (cancelled) {
          return;
        }

        if (!cell) {
          setState({
            userData: null,
            userTypeId: null,
            isFetching: false,
            error: null,
          });
          return;
        }

        const typeId = extractTypeIdFromUserCell(cell);
        const parsed = parseUserData(cell);

        if (!parsed) {
          setState({
            userData: null,
            userTypeId: typeId ?? null,
            isFetching: false,
            error: "Failed to decode user cell data",
          });
          return;
        }

        setState({
          userData: parsed,
          userTypeId: typeId ?? null,
          isFetching: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) {
          return;
        }

        const message =
          err instanceof Error ? err.message : "Failed to load user profile";
        const friendlyMessage = /invalid ckb address/i.test(message)
          ? "Invalid CKB address"
          : message;

        setState({
          userData: null,
          userTypeId: null,
          isFetching: false,
          error: friendlyMessage,
        });
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [address, client, protocolData, protocolCell]);

  const isLoading = useMemo(() => {
    if (!address) return false;
    if (!client || !protocolData || !protocolCell?.cellOutput.type) {
      return true;
    }
    return protocolLoading || state.isFetching;
  }, [
    address,
    client,
    protocolData,
    protocolCell,
    protocolLoading,
    state.isFetching,
  ]);

  const loadError = state.error ?? protocolError ?? null;

  return {
    userData: state.userData,
    userTypeId: state.userTypeId,
    isLoading,
    error: loadError,
  };
}
