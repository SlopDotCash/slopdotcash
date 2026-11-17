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
  },
  play: {
    // spec/frontend/ownerVault.md, "A wallet reply settles only its own attempt; an unclear one waits for the owner"
    Unclear: async () => {
      onEnterHash.mockClear();
      await userEvent.type(screen.getByRole("textbox", { name: "Transaction hash" }), walletHash);
      await userEvent.click(screen.getByRole("button", { name: "Check transaction" }));
      await expect(onEnterHash).toHaveBeenCalledWith(walletHash);
    },
    // spec/frontend/ownerVault.md, "A wallet reply settles only its own attempt; an unclear one waits for the owner"
    Disconnected: async () => {
      onCheck.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Check transaction" }));
      await expect(onCheck).not.toHaveBeenCalled();
    },
  },
};
