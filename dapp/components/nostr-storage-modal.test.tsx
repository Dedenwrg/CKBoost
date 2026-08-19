import { act, fireEvent, render, screen } from "@testing-library/react";
import { NostrStorageModal } from "./nostr-storage-modal";

jest.mock("../../packages/ssri-ckboost/dist", () => ({
  createScopedLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
  }),
}));

jest.mock("@/hooks/use-nostr-fetch", () => ({
  useNostrFetch: () => ({
    fetchSubmission: jest.fn().mockResolvedValue({
      content: "stored content",
      metadata: { type: "quest_content" },
    }),
  }),
}));

it("keeps the modal open while submitting and displays the failure", async () => {
  let rejectConfirmation: (error: Error) => void = () => undefined;
  const onConfirm = jest.fn(
    () =>
      new Promise<string>((_resolve, reject) => {
        rejectConfirmation = reject;
      })
  );
  const onClose = jest.fn();

  render(
    <NostrStorageModal
      isOpen
      onClose={onClose}
      neventId="nevent-test"
      onConfirm={onConfirm}
      mode="verifying"
      label="Quest Content"
      cachedPayloads={{
        "nevent-test": {
          content: "stored content",
          metadata: { type: "quest_content" },
        },
      }}
    />
  );

  const confirmButton = await screen.findByRole("button", {
    name: "Confirm & Submit",
  });
  fireEvent.click(confirmButton);
  fireEvent.click(screen.getByText("Close"));

  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();

  await act(async () => {
    rejectConfirmation(new Error("wallet transaction failed"));
  });

  expect(await screen.findByText("Transaction Failed")).not.toBeNull();
  expect(screen.getByText("wallet transaction failed")).not.toBeNull();
  expect(onClose).not.toHaveBeenCalled();
});
