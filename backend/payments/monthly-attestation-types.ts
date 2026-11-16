/** Monthly attestation plan and authorization records shared by the payments API and the attester. */
import type { EvmMonthlyReservation } from "../../contracts/evm/monthly-reserve";
import type { EscrowDeployment } from "../../src/lib/escrow-policy.mjs";

export interface MonthlyAttestationRequest {
  projectId: string;
  period: string;
  network: EscrowDeployment["network"];
  snapshotSha256: string;
}

export interface MonthlyAttestationPlan {
  request: MonthlyAttestationRequest;
  deployment: EscrowDeployment;
  allocationRoot: string;
  /** EIP-712 digest on EVM; domain-separated message on Solana. Hex without 0x. */
  messageHex: string;
  family: "evm" | "solana";
  totalGrossBase: string;
  /** EVM V2: one remaining-source execution attempt for the frozen allocation. */
  evmReservation?: EvmMonthlyReservation;
  /** Solana only: Unix seconds of the finalized slot at which the attester saw
   * no `origin` or `monthly-source` account for any included source. */
  frozenAt?: string;
  entries: { githubUserId: string; grossMicro: string; sourceDigest: string }[];
}

export interface MonthlyAuthorization {
  plan: MonthlyAttestationPlan;
  /** Hex-encoded signature, without 0x. Public authorization; no private key. */
  signatureHex: string;
  /** Original independently signed V1 evidence. A pending legacy transaction
   * can still win admission after V2 publication; retain it for reconciliation. */
  legacyAuthorization?: {
    plan: MonthlyAttestationPlan;
    signatureHex: string;
  };
}
