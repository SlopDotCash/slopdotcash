import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { walletHash } from "../vault/fixtures.ts";
import type { ReserveReleaseProps } from "./ReserveRelease.tsx";

const onCheckReserve = fn();
const onSign = fn();
const onEnterHash = fn();
const onConfirmUnsent = fn();
const owner = "0x5e1f0000000000000000000000000000000000b0";

export const meta: ComponentMeta<ReserveReleaseProps> = {
  args: {
    network: "base-mainnet",
    wallets: [{ id: "1", name: "Rabby" }],
    defaultOpen: true,
    onCheckReserve,
    onConnect: fn(),
    onSign,
    onCheck: fn(),
    onEnterHash,
    onConfirmUnsent,
    onClearUnreadable: fn(),
  },
  examples: {
    Held: { notice: { tone: "Neutral", text: "Total correct. Nothing to release." } },
    Approved: { released: "120 USDC" },
    Signing: { released: "120 USDC", address: owner },
    Pending: { pending: { hash: walletHash, unclear: false }, notice: { tone: "Neutral", spinner: true, text: "Submitted" } },
    Unclear: { pending: { hash: "", unclear: true } },
    Released: { notice: { tone: "Positive", text: "Released." } },
    Failed: { notice: { tone: "Negative", text: "Transaction failed. Nothing released." } },
    Unreadable: { unreadable: true },
  },
  play: {
    // spec/frontend/ownerMonthly.md, "Commitment, automatic-payment setting and reserve release each keep one recoverable attempt"
    Signing: async () => {
      onSign.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Sign release" }));
      await expect(onSign).toHaveBeenCalledTimes(1);
    },
    // spec/frontend/ownerMonthly.md, "Commitment, automatic-payment setting and reserve release each keep one recoverable attempt"
    Unclear: async () => {
      onEnterHash.mockClear();
      onConfirmUnsent.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Nothing was sent?" }));
      await userEvent.click(screen.getByRole("button", { name: "Not sent — clear" }));
      await userEvent.type(screen.getByRole("textbox", { name: "Transaction hash" }), walletHash);
      await userEvent.click(screen.getByRole("button", { name: "Check transaction" }));
      await expect([onEnterHash.mock.calls, onConfirmUnsent.mock.calls.length]).toEqual([[[walletHash]], 1]);
    },
  },
};
