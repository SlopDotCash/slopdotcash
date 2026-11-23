import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { walletHash } from "./fixtures.ts";
import { ProvisionalDeposit, type ProvisionalDepositProps, type VaultSetupProps } from "./VaultSetup.tsx";

const onReview = fn();
const onCreate = fn();
const onRegisterExisting = fn();
const onConfirmUnsent = fn();
const owner = "0x5e1f0000000000000000000000000000000000b0";
const summary = { network: "base-mainnet", owner, asset: "USDC", capDisplay: "1,000 USDC", automatic: true };
const onDeposit = fn();
const included = "The vault is on Base but its creation is not finalized yet. You can fund it below now. A deposit counts once Base finalizes it.";
const provisional: ProvisionalDepositProps = {
  deployment: { network: "base-mainnet", vault: "0x5e1f0000000000000000000000000000000000aa", owner, asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", deploymentTransaction: walletHash },
  wallets: [{ id: "1", name: "Rabby" }],
  address: owner,
  amount: "250",
  review: { operation: "deposit", gross: 250_000_000n, fee: 0n, net: 250_000_000n, decimals: 6, freeBalance: 0n, approvalNeeded: true, resetAllowance: false, batch: false },
  onConnect: fn(),
  onChooseAnother: fn(),
  onAmount: fn(),
  onReview: fn(),
  onDeposit,
  onCheck: fn(),
  onEnterHash: fn(),
};

export const meta: ComponentMeta<VaultSetupProps> = {
  args: {
    purpose: "ordinary",
    read: "ready",
    loginHref: "/login?return=/projects/slop/manage",
    networks: ["base-mainnet", "solana-mainnet"],
    network: "base-mainnet",
    wallets: [{ id: "1", name: "Rabby" }],
    claimed: false,
    recoverable: true,
    automatic: true,
    capDisplay: "1,000 USDC",
    onNetwork: fn(),
    onConnect: fn(),
    onChooseAnother: fn(),
    onAutomatic: fn(),
    onReview,
    onRecover: fn(),
    onCreate,
    onChangeReview: fn(),
    onRegisterExisting,
    onCheck: fn(),
    onEnterHash: fn(),
    onConfirmUnsent,
    onClearUnreadable: fn(),
    onReload: fn(),
  },
  examples: {
    Loading: { read: "loading" },
    SignIn: { read: "signIn" },
    Unconfirmed: { address: owner },
    Confirmed: { address: owner, claimed: true },
    Reviewed: { address: owner, claimed: true, summary },
    Existing: { claimed: true, summary, existing: true },
    Bounty: { purpose: "security-bounty", address: owner, claimed: true },
    Pending: { summary, pending: { hash: walletHash, unclear: false }, notice: "Creation sent. Check registration once it is finalized." },
    Unclear: { summary, pending: { hash: "", unclear: true } },
    Unavailable: { networks: [] },
    Unreadable: { unreadable: true },
    ProvisionalDeposit: { summary, pending: { hash: walletHash, unclear: false }, notice: included, funding: <ProvisionalDeposit {...provisional} /> },
    ProvisionalApprovalPending: { summary, pending: { hash: walletHash, unclear: false }, funding: <ProvisionalDeposit {...provisional} review={undefined} pending={{ action: "Token approval", hash: walletHash, sent: true }} /> },
  },
  play: {
    // spec/frontend/provisionalVault.md, "Reviewed identity and current chain evidence govern the form"
    Confirmed: async () => {
      onReview.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Review vault creation" }));
      await expect(onReview).toHaveBeenCalledTimes(1);
    },
    // spec/frontend/provisionalVault.md, "Reviewed identity and current chain evidence govern the form"
    Unconfirmed: async () => {
      await expect(screen.getByRole("button", { name: "Review vault creation" })).toBeDisabled();
    },
    // spec/frontend/ownerVault.md, "Only a finalized matching result registers or counts, and failures keep the saved request"
    Existing: async () => {
      onRegisterExisting.mockClear();
      await userEvent.type(screen.getByRole("textbox", { name: "Creation transaction hash" }), walletHash);
      await userEvent.click(screen.getByRole("button", { name: "Check vault registration" }));
      await expect([onRegisterExisting.mock.calls, screen.queryByRole("button", { name: "Create vault in wallet" })]).toEqual([[[walletHash]], null]);
    },
    // spec/frontend/provisionalVault.md, "Only the owner opens the provisional token deposit prompt, after storage saves its attempt"
    ProvisionalDeposit: async () => {
      onDeposit.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Approve exact token amount in wallet" }));
      await expect([onDeposit.mock.calls.length, screen.queryByRole("button", { name: "Confirm deposit in wallet" })]).toEqual([1, null]);
    },
    // spec/frontend/ownerVault.md, "Only a finalized matching result registers or counts, and failures keep the saved request"
    Unclear: async () => {
      onConfirmUnsent.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Nothing was sent?" }));
      await userEvent.click(screen.getByRole("button", { name: "Not sent — clear" }));
      await expect(onConfirmUnsent).toHaveBeenCalledTimes(1);
    },
  },
};
