import type { EscrowDeployment } from "../../src/lib/escrow-policy.mjs";
import type { EvmImplementationReview } from "./adapter";

/** Public network infrastructure, not a project or payment inventory. */
export type ReviewedEvmFactory = Pick<
  EscrowDeployment,
  | "network"
  | "sourceCommit"
  | "codeSha256"
  | "bindingDelaySeconds"
  | "identityAuthority"
  | "feeRecipient"
> & {
  factory: string;
  factoryCodeSha256: string;
  registrar: string;
  evmUpgrade: EvmImplementationReview;
};

/**
 * Add a network only from reviewed, finalized deployment/upgrade evidence.
 * An unsigned upgrade kit or a local fork is not a live implementation pin.
 * Empty is intentional until that evidence exists. Project deployments remain
 * exclusively in D1 and are appended after exact finalized owner creation.
 */
export const REVIEWED_EVM_FACTORIES: readonly ReviewedEvmFactory[] = [];
