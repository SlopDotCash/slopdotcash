import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { DirectBountyPaymentProps } from "./DirectBountyPayment.tsx";
import { uncertainLegs, unsentLegs, wallets } from "./fixtures.ts";

const onSend = fn();

export const meta: ComponentMeta<DirectBountyPaymentProps> = {
  args: {
    cancellation: false,
    network: "base-mainnet",
    legs: unsentLegs,
    confirmed: [],
    unsent: 2,
    uncertain: false,
    mismatched: false,
    wallets,
    address: "0x5a1f0c3b8e9d2a4f6c7b8d9e0f1a2b3c4d5e6f70",
    busy: false,
    hashes: {},
    error: null,
    stale: false,
    onConnect: fn(),
    onSend,
    onHash: fn(),
    onCheck: fn(),
    onRefresh: fn(),
  },
  examples: {
    Uncertain: { legs: uncertainLegs, unsent: 0, uncertain: true },
    Mismatched: { mismatched: true },
    Cancellation: { cancellation: true, legs: [{ slot: "FirstLeg", name: "Cancellation", saved: { identity: "", bytesId: "", hash: "", candidate: "" }, mismatched: false }], unsent: 1 },
    Refused: { error: "The payment request changed. Refresh the case before signing.", stale: true },
    Disconnected: { address: undefined },
  },
  play: {
    // spec/frontend/directBountyPrompt.md, "A wallet prompt starts only after an atomic storage write owns its nonce"
    Default: async () => {
      await userEvent.click(screen.getByRole("button", { name: "Pay remaining transfers" }));
      await expect(onSend).toHaveBeenCalled();
    },
    // spec/frontend/directBountyPrompt.md, "A late wallet result updates only the prompt that still owns the stored entry"
    Uncertain: async () => {
      await expect(screen.queryByRole("button", { name: "Pay remaining transfers" })).toBeNull();
      await expect(screen.getByText("Unknown result: paste hash")).toBeVisible();
      await expect(screen.getByRole("button", { name: "Verify submitted payments" })).toBeEnabled();
    },
    // spec/frontend/directBountyPrompt.md, "Storage keeps the other leg and never grants settlement authority"
    Mismatched: async () => {
      await expect(screen.getByRole("button", { name: "Pay remaining transfers" })).toBeDisabled();
    },
    // spec/frontend/directBountyPrompt.md, "A wallet prompt starts only after an atomic storage write owns its nonce"
    Disconnected: async () => {
      await expect(screen.getByRole("button", { name: "Pay remaining transfers" })).toBeDisabled();
    },
  },
};
