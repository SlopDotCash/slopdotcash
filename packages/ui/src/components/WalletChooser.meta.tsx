import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { WalletChooserProps } from "./WalletChooser.tsx";

type Context = { canvasElement: HTMLElement };

const wallets = [
  { id: "io.metamask", name: "MetaMask" },
  { id: "com.coinbase.wallet", name: "Coinbase Wallet" },
];
const announced = [{ ...wallets[0], icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" }, wallets[1]];
const address = "0x8f3a1c9e2b7d4f6a0c5e8b1d3f7a9c2e4b6d8f0a";
const onConnect = fn();
const written = fn(() => Promise.resolve());

export const meta: ComponentMeta<WalletChooserProps> = {
  args: { legend: "Payout wallet", wallets, onConnect },
  examples: {
    "Announced icon": { wallets: announced },
    Connected: { address, onCopy: written },
    "No Solana wallet": { family: "solana", wallets: [] },
  },
  play: {
    // spec/ui/controls.md, "Story: Act only when an action is available"
    Default: async ({ canvasElement }: Context) => {
      onConnect.mockClear();
      const canvas = within(canvasElement);
      await expect(canvas.getByRole("group", { name: "Payout wallet" })).toBeVisible();
      await userEvent.click(canvas.getByRole("button", { name: "Connect MetaMask" }));
      await userEvent.tab();
      await expect(document.activeElement).toBe(canvas.getByRole("button", { name: "Connect Coinbase Wallet" }));
      await userEvent.keyboard("{Enter}");
      await expect(onConnect.mock.calls).toEqual([[wallets[0]], [wallets[1]]]);
    },
    // spec/ui/copy.md, "Copying starts from ready and reports the browser's answer"
    Connected: async ({ canvasElement }: Context) => {
      written.mockClear();
      const canvas = within(canvasElement);
      await expect(canvas.queryByRole("button", { name: /^Connect/ })).toBeNull();
      await expect(canvas.getByRole("group", { name: "Connected wallet" }).textContent).toBe(address);
      await userEvent.click(canvas.getByRole("button", { name: "Copy address" }));
      await waitFor(() => expect(written.mock.calls).toEqual([[address]]));
    },
    // spec/ui/controls.md, "Story: Act only when an action is available"
    "No Solana wallet": async ({ canvasElement }: Context) => {
      const canvas = within(canvasElement);
      await expect(canvas.queryByRole("button")).toBeNull();
      await expect(canvas.getByText("No Solana wallet found. Install one, then reload.")).toBeVisible();
    },
  },
};
