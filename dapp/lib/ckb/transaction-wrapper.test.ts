jest.mock("@ckb-ccc/connector-react", () => ({
  KnownScript: { Secp256k1Blake160: "Secp256k1Blake160" },
  ccc: {
    stringify: JSON.stringify,
    hexFrom: (value: string) => value,
    CellOutput: { from: jest.fn() },
  },
}));

jest.mock(
  "../../../packages/ssri-ckboost/dist",
  () => ({
    createScopedLogger: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    }),
  })
);

jest.mock("@/lib/pending-transactions", () => ({
  registerPendingTransaction: jest.fn(),
}));

import { sendTransactionWithFeeRetry } from "./transaction-wrapper";

it("keeps an exact corrected fee rate across the 2 KB boundary", async () => {
  const tx = {
    outputs: [],
    outputsData: [],
    inputs: [],
    witnesses: [],
    addCellDepsOfKnownScripts: jest.fn().mockResolvedValue(undefined),
    completeInputsByCapacity: jest.fn().mockResolvedValue(undefined),
    completeFeeBy: jest.fn().mockResolvedValue(undefined),
    clone: jest.fn(),
    // This reproduces issue #63: rounding 2049 bytes up to 3 KW made the old
    // calculation return the unchanged 1000 shannons/KW rate.
    toBytes: jest.fn(() => new Uint8Array(2049)),
  };
  tx.clone.mockReturnValue(tx);

  const signer = {
    client: {
      getFeeRate: jest.fn().mockRejectedValue(new Error("null fee estimate")),
    },
    getRecommendedAddressObj: jest.fn().mockResolvedValue({
      script: { codeHash: "0x1", hashType: "type", args: "0x2" },
    }),
    sendTransaction: jest
      .fn()
      .mockRejectedValueOnce(
        new Error(
          "PoolRejectedTransactionByMinFeeRate: requiring a transaction fee of at least 2715 shannons"
        )
      )
      .mockResolvedValueOnce("0xabc"),
  };

  await expect(
    sendTransactionWithFeeRetry(signer as never, tx as never)
  ).resolves.toBe("0xabc");

  expect(tx.completeFeeBy.mock.calls.map(([, feeRate]) => feeRate)).toEqual([
    1000,
    1456,
    1456,
  ]);
  expect(signer.sendTransaction).toHaveBeenCalledTimes(2);
});

it("reports the last required fee without rebuilding after the final attempt", async () => {
  const tx = {
    outputs: [],
    outputsData: [],
    inputs: [],
    witnesses: [],
    addCellDepsOfKnownScripts: jest.fn().mockResolvedValue(undefined),
    completeInputsByCapacity: jest.fn().mockResolvedValue(undefined),
    completeFeeBy: jest.fn().mockResolvedValue(undefined),
    clone: jest.fn(),
    toBytes: jest.fn(() => new Uint8Array(2049)),
  };
  tx.clone.mockReturnValue(tx);

  const signer = {
    client: {
      getFeeRate: jest.fn().mockResolvedValue(1000),
    },
    getRecommendedAddressObj: jest.fn().mockResolvedValue({
      script: { codeHash: "0x1", hashType: "type", args: "0x2" },
    }),
    sendTransaction: jest.fn().mockRejectedValue(
      new Error(
        "PoolRejectedTransactionByMinFeeRate: requiring a transaction fee of at least 2715 shannons"
      )
    ),
  };

  await expect(
    sendTransactionWithFeeRetry(signer as never, tx as never)
  ).rejects.toThrow(
    "Transaction fee adjustment failed after 3 attempts. The node required a fee of at least 2715 shannons."
  );

  expect(signer.sendTransaction).toHaveBeenCalledTimes(3);
  expect(tx.completeFeeBy).toHaveBeenCalledTimes(5);
});
