import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DraftHistory } from "./draft-history";

jest.mock(
  "../../packages/ssri-ckboost/dist",
  () => ({
    createScopedLogger: () => ({ error: jest.fn() }),
  })
);

jest.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

it("clears storage and the active draft", async () => {
  const clear = jest.fn();
  const onClear = jest.fn();
  const storage = {
    load: jest.fn(() => null),
    save: jest.fn(() => ({ saved: true, skipped: false, versions: 1 })),
    history: jest.fn(() => [
      { savedAt: 1, data: { title: "old" }, signature: "old" },
    ]),
    clear,
  };
  jest.spyOn(window, "confirm").mockReturnValue(true);

  render(
    <DraftHistory
      storage={storage}
      data={{ title: "old" }}
      isEmpty={() => false}
      onRestore={jest.fn()}
      onClear={onClear}
    />
  );

  await waitFor(() =>
    expect(screen.queryByText("Show History (1)")).not.toBeNull()
  );
  fireEvent.click(screen.getByText("Show History (1)"));
  fireEvent.click(screen.getByText("Clear All Versions"));

  expect(clear).toHaveBeenCalledTimes(1);
  expect(onClear).toHaveBeenCalledTimes(1);
});
