import { expect, fn, screen, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { offers, signInHref, wallets } from "./fixtures.ts";
import type { WalletManagementProps } from "./WalletManagement.tsx";

const onReload = fn();
const onConnect = fn();
const onConfirmChange = fn();
const onKeepSaved = fn();

export const meta: ComponentMeta<WalletManagementProps> = {
  args: { panel: wallets.loaded, offers, signInHref, onReload, onConnect, onConfirmChange, onKeepSaved },
  examples: {
    Loading: { panel: wallets.loading },
    SignedOut: { panel: wallets.signedOut },
    Busy: { panel: wallets.busy },
    Change: { panel: wallets.change },
    Failed: { panel: wallets.failed },
    Empty: { panel: wallets.empty },
    NoWallets: { panel: wallets.empty, offers: [] },
  },
  play: {
    // spec/backend/wallets.md, "Registration appends an immutable successor or returns the current registry row"
    Default: async () => {
      onConnect.mockClear();
      const evm = screen.getByRole("article", { name: "EVM wallet" });
      await expect(within(evm).getByRole("img", { name: "Not confirmed" })).toBeTruthy();
      await expect(within(evm).getByRole("img", { name: "Robinhood Chain, not confirmed" })).toBeTruthy();
      await expect(within(evm).getByRole("img", { name: "Base, confirmed" })).toBeTruthy();
      await userEvent.click(within(evm).getByRole("button", { name: "Change EVM wallet" }));
      await userEvent.click(await screen.findByRole("button", { name: "Connect Rabby" }));
      await expect(onConnect).toHaveBeenCalledWith(1, "evm");
    },
    // spec/backend/wallets.md, "The server issues an expiring challenge for the exact current registry claim"
    Change: async () => {
      onConfirmChange.mockClear();
      onKeepSaved.mockClear();
      await expect(screen.getByRole("button", { name: "Change Solana wallet" }).hasAttribute("disabled")).toBe(true);
      await userEvent.click(screen.getByRole("button", { name: "Keep saved" }));
      await expect([onKeepSaved.mock.calls.length, onConfirmChange.mock.calls.length]).toEqual([1, 0]);
    },
    // spec/frontend/presentation.md, "Settings keeps wallet and email controls expanded without account navigation tabs"
    SignedOut: async () => {
      await expect(screen.getByRole("link", { name: "Sign in with GitHub" }).getAttribute("href")).toBe(signInHref);
    },
    // spec/frontend/walletConsent.md, "Discovery offers announced and legacy providers and refuses conflicting ones"
    NoWallets: async () => {
      await userEvent.click(screen.getByRole("button", { name: "Connect Solana wallet" }));
      await expect(await screen.findByRole("link", { name: "Solflare" })).toBeTruthy();
    },
  },
};
