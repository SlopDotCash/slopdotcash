// spec/frontend/projections.md, "Award, funding and settlement status are independent facts"; spec/frontend/projections.md, "The row is Sent with a transfer, Unclaimed after the final batch, Scheduled with a timely wallet, and otherwise Awaiting wallet until the deadline and Unclaimed from it"
import type { AccountPayment, ContributorAllocation, PaymentsAccount } from "@repo/settlement/client";
import type { AllocationView } from "./payoutDesk.vibe";

const usdc = { network: "base-mainnet", chain: "base", assetAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", assetDecimals: 6 } as const;

export const vault = "0x5e1f0000000000000000000000000000000000aa";
export const payee = "0x2b7c0000000000000000000000000000000000c3";

const payment = (
  id: string,
  deliveryState: AccountPayment["deliveryState"],
  transactionId: string | null = null,
  contributionMonth: string | null = "2026-11",
): AccountPayment => ({
  ...usdc,
  id,
  vault,
  projectId: "slop",
  contributionMonth,
  grossBase: "125000000",
  feeBase: "2500000",
  netBase: "122500000",
  state: transactionId === null ? "reserved" : "paid",
  transactionId,
  submittedTransactionId: deliveryState === "submitted" ? "0x9c1d4c0a4b0e3c7d2f1e6a5b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f70812" : null,
  deliveryState,
});

export const reservedPayment = payment("pay-ready", "ready");

export const payouts: PaymentsAccount = {
  githubUserId: "4242",
  wallets: [{ chain: "base", claimId: "claim-1", address: payee, authorized: true, firstAuthorizedAt: "2026-11-02T10:00:00.000Z" }],
  payments: [
    payment("pay-paid", "paid", "0x7a1d4c0a4b0e3c7d2f1e6a5b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f70813"),
    payment("pay-submitted", "submitted"),
    reservedPayment,
    payment("pay-held", "held"),
    payment("pay-wallet", "needs_wallet", null, null),
  ],
  monthlyAwards: [
    { ...usdc, projectId: "slop", period: "2026-10", grossBase: "50000000", feeBase: "1000000", netBase: "49000000", state: "underfunded" },
    { ...usdc, projectId: "slop", period: "2026-09", grossBase: "50000000", feeBase: "1000000", netBase: "49000000", state: "awaiting-reservation" },
    { ...usdc, projectId: "slop", period: "2026-08", grossBase: "50000000", feeBase: "1000000", netBase: "49000000", state: "conflict" },
  ],
  balances: [],
  directTransfers: [
    {
      projectId: "slop",
      contributionMonth: "2026-07",
      githubUserId: "4242",
      login: "octo",
      network: "base-mainnet",
      chain: "base",
      recipient: payee,
      amountMicro: "30000000",
      transactionId: "0x5b1d4c0a4b0e3c7d2f1e6a5b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f70814",
      blockTime: "2026-08-01T12:00:00.000Z",
    },
  ],
  walletObservations: [],
};

export const noPayouts: PaymentsAccount = { ...payouts, payments: [], monthlyAwards: [], directTransfers: [] };

const allocation: ContributorAllocation = {
  network: "base-mainnet",
  chain: "base",
  token: { symbol: "SLOP", decimals: 18, address: "0x1111000000000000000000000000000000000001" },
  registrationClosesAt: "2027-02-08T00:00:00.000Z",
  closed: false,
  recipients: [{ githubId: "4242", amountBase: "1500000000000000000000", transactionId: null }],
  digest: "0".repeat(64),
};

type ShownAllocation = Extract<AllocationView, { tag: "AllocationShown" }>;

export const awaitingAllocation: ShownAllocation = {
  tag: "AllocationShown",
  display: "AllocationAwaitingWallet",
  walletPrompt: true,
  transferLink: false,
  allocation,
  recipient: { githubId: "4242", amountBase: "1500000000000000000000", transactionId: null },
};

export const sentAllocation: ShownAllocation = {
  ...awaitingAllocation,
  display: "AllocationSent",
  walletPrompt: false,
  transferLink: true,
  recipient: { ...awaitingAllocation.recipient, transactionId: "0x3c1d4c0a4b0e3c7d2f1e6a5b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f70815" },
};
