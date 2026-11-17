// spec/settlement/signer.md, "Each service key permits only its named operations and none can pay, withdraw or upgrade"
import type { Operation } from "../../gen/settlement__signer.ts";
import type { Bytes32, EvmAddress } from "../chain/evm/abi.ts";

export interface BindDestination {
  readonly kind: "BindDestination";
  readonly network: string;
  readonly vault: EvmAddress;
  readonly obligationId: Bytes32;
  readonly actor: string;
  readonly claimId: string;
  readonly claimDigest: string;
  readonly destination: EvmAddress;
}

export interface CancelObsoleteBinding {
  readonly kind: "CancelObsoleteBinding";
  readonly network: string;
  readonly vault: EvmAddress;
  readonly key: string;
}

export interface SignMonthlyRoot {
  readonly kind: "SignMonthlyRoot";
  readonly network: string;
  readonly vault: string;
  readonly period: string;
}

export interface ApproveReserveRelease {
  readonly kind: "ApproveReserveRelease";
  readonly network: string;
  readonly vault: string;
  readonly period: string;
}

export interface SolanaBindingHalf {
  readonly kind: "SolanaBindingHalf";
  readonly network: string;
  readonly vault: string;
  readonly actor: string;
  readonly claimId: string;
}

export interface TestRelayerPay {
  readonly kind: "TestRelayerPay";
  readonly network: string;
  readonly vault: string;
  readonly obligationId: string;
  readonly idempotencyKey: string;
}

export type Intent = BindDestination | CancelObsoleteBinding | SignMonthlyRoot | ApproveReserveRelease | SolanaBindingHalf | TestRelayerPay;

export type IntentKind = Intent["kind"];

export const intentOperation = {
  BindDestination: "Bind",
  CancelObsoleteBinding: "CancelOwnBinding",
  SignMonthlyRoot: "MonthlyRoot",
  ApproveReserveRelease: "ReserveReleaseApproval",
  SolanaBindingHalf: "Bind",
  TestRelayerPay: "Pay",
} as const satisfies Record<IntentKind, Operation>;
