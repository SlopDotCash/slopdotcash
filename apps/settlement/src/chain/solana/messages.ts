// spec/settlement/monthlyCommitment.md, "Solana signs one freeze time and refuses a month whose source is already consumed"; spec/contracts/solanaEscrow.md, "Anyone records a signed, fully funded allocation once per period inside its window"; spec/contracts/solanaEscrow.md, "The owner releases the whole untouched reserve of a wrong-total month once, with the attester's signature"; spec/contracts/solanaEscrow.md, "The identity authority and the destination both sign a binding for the project's network"
import type { Address, Blockhash } from "@repo/platform/chain/solanaWire";
import type { Period } from "../../kernels/calendar.ts";
import { type Digest, type I64, type U64, concat, digestBytes, i64le, u32le, u64le, utf8 } from "./bytes.ts";
import { type Built, type WalletBindingTerms, bindWallet, commitMonthly, ed25519Verification, releaseReserve } from "./instructions.ts";
import { keyBytes } from "./pda.ts";
import { type Compiled, type Instruction, compileLegacy, signedBy } from "./transactions.ts";

export const MONTHLY_MESSAGE_PREFIX = "slop-monthly-allocation-v3";
export const RELEASE_MESSAGE_PREFIX = "slop-monthly-release-v1";

export interface MonthlyAttestation {
  readonly program: Address;
  readonly project: Address;
  readonly period: Period;
  readonly root: Digest;
  readonly total: U64;
  readonly frozenAt: I64;
  readonly network: Digest;
}

export interface ReleaseApproval {
  readonly program: Address;
  readonly project: Address;
  readonly period: Period;
  readonly root: Digest;
  readonly total: U64;
  readonly unsettled: U64;
  readonly released: U64;
  readonly network: Digest;
}

/** @throws {never} */
export function solanaMonthlyMessage(attestation: MonthlyAttestation): Uint8Array {
  return concat(
    utf8(MONTHLY_MESSAGE_PREFIX),
    keyBytes(attestation.program),
    keyBytes(attestation.project),
    u32le(attestation.period),
    digestBytes(attestation.root),
    u64le(attestation.total),
    i64le(attestation.frozenAt),
    digestBytes(attestation.network),
  );
}

/** @throws {never} */
export function releaseApprovalMessage(approval: ReleaseApproval): Uint8Array {
  return concat(
    utf8(RELEASE_MESSAGE_PREFIX),
    keyBytes(approval.program),
    keyBytes(approval.project),
    u32le(approval.period),
    digestBytes(approval.root),
    u64le(approval.total),
    u64le(approval.unsettled),
    u64le(approval.released),
    digestBytes(approval.network),
  );
}

export type AttestationIssue = "invalidAttestation" | "payerIsAuthority";

export type Attested = { readonly kind: "built"; readonly value: ReadonlyArray<Instruction> } | { readonly kind: "refused"; readonly issue: AttestationIssue };

/** @throws {never} */
export function admitMonth(input: { readonly payer: Address; readonly authority: Address; readonly signature: Uint8Array; readonly attestation: MonthlyAttestation }): Attested {
  const message = solanaMonthlyMessage(input.attestation);
  if (input.payer === input.authority) return { kind: "refused", issue: "payerIsAuthority" };
  if (!signedBy(message, input.signature, input.authority)) return { kind: "refused", issue: "invalidAttestation" };
  const { program, project, period, root, total, frozenAt } = input.attestation;
  return { kind: "built", value: [ed25519Verification(input.authority, input.signature, message), commitMonthly({ program, project, payer: input.payer, period, root, total, frozenAt })] };
}

/** @throws {never} */
export function releaseMonthlyReserve(input: { readonly owner: Address; readonly authority: Address; readonly signature: Uint8Array; readonly approval: ReleaseApproval }): Attested {
  const message = releaseApprovalMessage(input.approval);
  if (!signedBy(message, input.signature, input.authority)) return { kind: "refused", issue: "invalidAttestation" };
  const { program, project, period, unsettled, released } = input.approval;
  return { kind: "built", value: [ed25519Verification(input.authority, input.signature, message), releaseReserve({ program, project, owner: input.owner, period, unsettled, released })] };
}

/** @throws {never} */
export function bindingMessage(terms: WalletBindingTerms & { readonly blockhash: Blockhash }): Built<Compiled> {
  const instruction = bindWallet(terms);
  if (instruction.kind === "refused") return instruction;
  return { kind: "built", value: compileLegacy({ payer: terms.payer, blockhash: terms.blockhash, instructions: [instruction.value] }) };
}
