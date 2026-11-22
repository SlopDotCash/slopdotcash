// spec/settlement/vaultSnapshots.md, "Retry recognizes the exact creation transaction before checking a revision"
import { type Bytes32, type EvmAddress, type Hex, U128_MAX, bytes32, decodeUint, evmAddress, isZero } from "./abi.ts";
import { type UnsignedCall, type VaultCreation, vaultCreationPlan } from "./factories.ts";

export type CreationIssue =
  | "receiptMismatch"
  | "transactionMismatch"
  | "creationFailed"
  | "policyDiffers"
  | "roleConflict"
  | "creationImplementationUnreviewed"
  | "identityAuthorityDiffers"
  | "unsupportedCreation";

export const CREATION_REFUSALS: Readonly<Record<CreationIssue, string>> = {
  receiptMismatch: "The creation receipt does not match its canonical block.",
  transactionMismatch: "The transaction does not match this owner's vault creation request.",
  creationFailed: "The vault creation transaction failed. Review a new request.",
  policyDiffers: "The vault's monthly policy differs from the reviewed creation request.",
  roleConflict: "The platform fee wallet must be separate from the vault owner and identity authority.",
  creationImplementationUnreviewed: "The factory's new-vault implementation is not reviewed.",
  identityAuthorityDiffers: "The factory identity authority differs from the creation review.",
  unsupportedCreation: "This reviewed factory does not support the requested vault creation.",
};

export interface CreationTerms {
  readonly owner: string;
  readonly projectDigest: string;
  readonly asset: string;
  readonly bounty: boolean;
  readonly monthlyCap: bigint;
  readonly automatic: boolean;
}

/** @throws {never} */
export function creationOf(terms: CreationTerms): VaultCreation | undefined {
  const owner = evmAddress(terms.owner);
  const asset = evmAddress(terms.asset);
  const projectId = bytes32(`0x${terms.projectDigest}`);
  if (owner === undefined || asset === undefined || projectId === undefined) return undefined;
  if (terms.bounty) return { owner, projectId, asset, purpose: "BountyPurpose" };
  if (terms.monthlyCap < 0n || terms.monthlyCap > U128_MAX || (terms.automatic && terms.monthlyCap === 0n)) return undefined;
  return { owner, projectId, asset, purpose: "OrdinaryPurpose", monthlyCap: terms.monthlyCap, monthlyEnabled: terms.automatic };
}

/** @throws {never} */
export function creationPlan(factory: EvmAddress, creation: VaultCreation): UnsignedCall | undefined {
  if (isZero(creation.projectId)) return undefined;
  if (creation.purpose === "OrdinaryPurpose" && ((creation.monthlyEnabled && creation.monthlyCap === 0n) || creation.monthlyCap < 0n || creation.monthlyCap > U128_MAX)) return undefined;
  return vaultCreationPlan(factory, creation);
}

/** @throws {never} */
export function roleConflict(owner: EvmAddress, identityAuthority: EvmAddress, feeRecipient: EvmAddress): boolean {
  return owner === feeRecipient || identityAuthority === feeRecipient;
}

const TRANSACTION = /^0x[0-9a-f]{64}$/u;

/** @throws {never} */
export function evmCreationId(text: string): Bytes32 | undefined {
  const lowered = text.toLowerCase();
  return TRANSACTION.test(lowered) ? (lowered as Bytes32) : undefined;
}

export interface MinedReceipt {
  readonly transactionHash: string;
  readonly blockHash: string;
  readonly blockNumber: bigint;
  readonly status: "success" | "reverted";
}

export interface MinedTransaction {
  readonly hash: string;
  readonly from: string;
  readonly to: string | undefined;
  readonly input: Hex;
  readonly value: bigint;
  readonly blockHash: string | undefined;
}

export interface CanonicalBlock {
  readonly hash: string;
  readonly number: bigint;
}

/** @throws {never} */
export function minedCreationIssue(input: { readonly transactionId: Bytes32; readonly receipt: MinedReceipt; readonly transaction: MinedTransaction; readonly block: CanonicalBlock; readonly plan: UnsignedCall }): CreationIssue | undefined {
  const { transactionId, receipt, transaction, block, plan } = input;
  if (receipt.transactionHash.toLowerCase() !== transactionId || transaction.hash.toLowerCase() !== transactionId
    || block.hash.toLowerCase() !== receipt.blockHash.toLowerCase() || block.number !== receipt.blockNumber)
    return "receiptMismatch";
  if (evmAddress(transaction.from) !== plan.from || transaction.to === undefined || evmAddress(transaction.to) !== plan.to
    || transaction.input.toLowerCase() !== plan.data.toLowerCase() || transaction.value !== 0n || transaction.blockHash !== receipt.blockHash)
    return "transactionMismatch";
  if (receipt.status !== "success") return "creationFailed";
  return undefined;
}

/** @throws {never} */
export function monthlyPolicyIssue(creation: VaultCreation, capWord: string, enabledWord: string): CreationIssue | undefined {
  if (creation.purpose === "BountyPurpose") return undefined;
  const cap = decodeUint(capWord, U128_MAX);
  const enabled = decodeUint(enabledWord, 1n);
  return cap === creation.monthlyCap && enabled === (creation.monthlyEnabled ? 1n : 0n) ? undefined : "policyDiffers";
}
