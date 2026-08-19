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

it("keeps the corrected fee rate for the retry and falls back when fee estimation fails", async () => {
  const tx = {
    outputs: [],
    outputsData: [],
    inputs: [],
    witnesses: [],
    addCellDepsOfKnownScripts: jest.fn().mockResolvedValue(undefined),
    completeInputsByCapacity: jest.fn().mockResolvedValue(undefined),
    completeFeeBy: jest.fn().mockResolvedValue(undefined),
    clone: jest.fn(),
    toBytes: jest.fn(() => new Uint8Array(1900)),
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
          "PoolRejectedTransactionByMinFeeRate: requiring a transaction fee of at least 2495 shannons"
        )
      )
      .mockResolvedValueOnce("0xabc"),
  };

  await expect(
    sendTransactionWithFeeRetry(signer as never, tx as never)
  ).resolves.toBe("0xabc");

  expect(tx.completeFeeBy.mock.calls.map(([, feeRate]) => feeRate)).toEqual([
    1000,
    1373,
    1373,
  ]);
  expect(signer.sendTransaction).toHaveBeenCalledTimes(2);
});
