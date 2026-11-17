// spec/settlement/signer.md, "Each service key permits only its named operations and none can pay, withdraw or upgrade"; spec/fees/conversion.md, "Native gas is reserved before signing and committed atomically with the signed row"
import type { Address, Hex } from "viem";
import type { Network } from "../../gen/fees__runtime.ts";

export type EvmNetwork = Exclude<Network, "Solana">;

interface EvmSend {
  readonly network: EvmNetwork;
  readonly nonceFloor: bigint;
  readonly valueMicro: bigint;
}

export interface KyberApprove extends EvmSend {
  readonly kind: "KyberApprove";
  readonly token: Address;
  readonly amount: bigint;
}

export interface KyberSwap extends EvmSend {
  readonly kind: "KyberSwap";
  readonly token: Address;
  readonly target: Address;
  readonly amountIn: bigint;
  readonly minimumOutput: bigint;
  readonly slippageBps: number;
}

export interface EvmClaimFees extends EvmSend {
  readonly kind: "EvmClaimFees";
  readonly vault: Address;
}

export interface DlnApprove extends EvmSend {
  readonly kind: "DlnApprove";
  readonly amount: bigint;
}

export interface DlnOrderTerms {
  readonly giveAmount: bigint;
  readonly takeAmount: bigint;
  readonly salt: bigint;
  readonly receiver: Address;
  readonly allowedTaker: Address | undefined;
  readonly metadata: Hex;
  readonly nativeFee: bigint;
  readonly orderId: Hex;
}

export interface DlnCreateOrder extends EvmSend {
  readonly kind: "DlnCreateOrder";
  readonly order: DlnOrderTerms;
}

export interface SlopBurn extends EvmSend {
  readonly kind: "SlopBurn";
  readonly amount: bigint;
}

export type FirstEvmIntent = KyberApprove | KyberSwap | EvmClaimFees | DlnApprove | DlnCreateOrder | SlopBurn;

export interface EvmReplacement {
  readonly kind: "EvmReplacement";
  readonly network: EvmNetwork;
  readonly recorded: FirstEvmIntent;
  readonly attempts: readonly [Hex, ...Hex[]];
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
  readonly valueMicro: bigint;
}

export type EvmIntent = FirstEvmIntent | EvmReplacement;

export interface SolanaClaim {
  readonly kind: "SolanaClaim";
  readonly network: "Solana";
  readonly vault: string;
  readonly mint: string;
  readonly amount: bigint;
  readonly valueMicro: bigint;
}

export interface JupiterSwap {
  readonly kind: "JupiterSwap";
  readonly network: "Solana";
  readonly inputMint: string;
  readonly outputMint: string;
  readonly amountIn: bigint;
  readonly minimumOutput: bigint;
  readonly slippageBps: number;
  readonly valueMicro: bigint;
}

export interface SolanaDlnOrder {
  readonly kind: "SolanaDlnOrder";
  readonly network: "Solana";
  readonly giveAmount: bigint;
  readonly takeAmount: bigint;
  readonly receiver: Address;
  readonly orderNonce: bigint;
  readonly orderId: Hex;
}

export type SolanaIntent = SolanaClaim | JupiterSwap | SolanaDlnOrder;

export type FeeIntent = EvmIntent | SolanaIntent;

export type IntentKind = FeeIntent["kind"];
