export type PaymentChain = "base" | "solana";
export interface AccountPayment {
  id: string;
  projectId: string;
  network: string;
  chain: PaymentChain;
  grossMicro: string;
  netMicro: string;
  feeMicro: string;
  state: "reserved" | "paid";
  deliveryState:
    | "needs_wallet"
    | "awaiting_binding"
    | "submitted"
    | "held"
    | "paid";
  submittedTransactionId: string | null;
  transactionId: string | null;
}
export interface PaymentsAccount {
  githubUserId: string;
  wallets: {
    chain: PaymentChain;
    claimId: string;
    address: string;
    authorized: boolean;
    activationEligibleAt: string | null;
  }[];
  payments: AccountPayment[];
  balances: { chain: PaymentChain; netMicro: string }[];
}
/** Fees are deducted from the gross award; integer micro-USDC only. */
export function payoutFee(gross: bigint): bigint {
  if (gross <= 0n || gross > 18446744073709551615n)
    throw new Error("Invalid gross award");
  return gross / 50n;
}
