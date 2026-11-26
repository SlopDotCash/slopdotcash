import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { walletHash } from "./fixtures.ts";
import type { PendingCheckProps } from "./PendingCheck.tsx";

const onCheck = fn();
const onEnterHash = fn();
const onConfirmUnsent = fn();

export const meta: ComponentMeta<PendingCheckProps> = {
  args: { action: "Deposit", hash: walletHash, canCheck: true, onCheck },
  examples: {
    Unclear: { hash: "", onEnterHash, onConfirmUnsent },
    Disconnected: { canCheck: false },
    Reserving: { action: "Commitment", status: "Pending · don't resend" },
  },
  play: {
    // spec/frontend/ownerVault.md, "A wallet reply settles only its own attempt; an unclear one waits for the owner"
    Unclear: async () => {
      onEnterHash.mockClear();
      onConfirmUnsent.mockClear();
      const field = screen.getByRole("textbox", { name: "Transaction hash" });
      await userEvent.type(field, walletHash);
      await userEvent.click(screen.getByRole("button", { name: "Check transaction" }));
      const hiddenWhileTyped = screen.queryByRole("button", { name: "Nothing was sent?" });
      await userEvent.clear(field);
      await userEvent.click(screen.getByRole("button", { name: "Nothing was sent?" }));
      await userEvent.click(screen.getByRole("button", { name: "Not sent — clear" }));
      await expect([onEnterHash.mock.calls, hiddenWhileTyped, onConfirmUnsent.mock.calls.length]).toEqual([[[walletHash]], null, 1]);
    },
    // spec/frontend/ownerVault.md, "A wallet reply settles only its own attempt; an unclear one waits for the owner"
    Disconnected: async () => {
      onCheck.mockClear();
      await expect(screen.getByRole("button", { name: "Check transaction" })).toBeDisabled();
      await expect(onCheck).not.toHaveBeenCalled();
    },
  },
};
