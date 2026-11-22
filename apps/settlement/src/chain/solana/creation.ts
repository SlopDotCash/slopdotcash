// spec/settlement/vaultSnapshots.md, "Retry recognizes the exact creation transaction before checking a revision"; spec/contracts/solanaEscrow.md, "The owner creates a token or native project with the Config's identity authority and fee recipient"
import { type Address, SYSTEM_PROGRAM } from "@repo/platform/chain/solanaWire";
import { type Digest, type U64, digestBytes, u64le } from "./bytes.ts";
import { anchorData, meta, setMonthlyCommitment } from "./instructions.ts";
import { type Purpose, type TokenProgram, PURPOSE_BYTE, configAddress, keyBytes, projectAddress, vaultAddress } from "./pda.ts";
import type { Instruction } from "./transactions.ts";

export const MAX_BINDING_DELAY = 30n * 86_400n;
export const MAX_ROTATION_DELAY = 90n * 86_400n;

export type SolanaCreationAsset = { readonly kind: "Native" } | { readonly kind: "Token"; readonly mint: Address; readonly tokenProgram: TokenProgram };

export interface SolanaCreation {
  readonly program: Address;
  readonly owner: Address;
  readonly asset: SolanaCreationAsset;
  readonly projectDigest: Digest;
  readonly networkDomain: Digest;
  readonly identityAuthority: Address;
  readonly feeRecipient: Address;
  readonly bindingDelay: U64;
  readonly rotationDelay: U64;
  readonly purpose: Purpose;
  readonly monthly: { readonly cap: U64; readonly enabled: boolean } | undefined;
}

export interface SolanaCreationPlan {
  readonly project: Address;
  readonly vault: Address;
  readonly config: Address;
  readonly instructions: ReadonlyArray<Instruction>;
}

export type SolanaCreationIssue = "delayOutOfRange" | "monthlyPolicyRequired" | "bountyHasNoMonthlyPolicy" | "zeroMonthlyCap" | "policyDiffers";

export const SOLANA_CREATION_REFUSALS: Readonly<Record<SolanaCreationIssue, string>> = {
  delayOutOfRange: "The reviewed delay is outside the program's range",
  monthlyPolicyRequired: "Choose the monthly payment setting explicitly",
  bountyHasNoMonthlyPolicy: "Private bounty awards have no automatic monthly policy",
  zeroMonthlyCap: "Monthly creation requires a valid cap",
  policyDiffers: "The creation policy differs from the reviewed program.",
};

export type PlannedCreation = { readonly kind: "planned"; readonly plan: SolanaCreationPlan } | { readonly kind: "refused"; readonly issue: SolanaCreationIssue };

export interface ReviewedProgramTerms {
  readonly program: Address;
  readonly networkDomain: Digest;
  readonly identityAuthority: Address;
  readonly feeRecipient: Address;
  readonly bindingDelay: U64;
  readonly rotationDelay: U64;
}

/** @throws {never} */
export function matchesReviewedProgram(creation: SolanaCreation, reviewed: ReviewedProgramTerms): boolean {
  return creation.program === reviewed.program && creation.networkDomain === reviewed.networkDomain && creation.identityAuthority === reviewed.identityAuthority
    && creation.feeRecipient === reviewed.feeRecipient && creation.bindingDelay === reviewed.bindingDelay && creation.rotationDelay === reviewed.rotationDelay;
}

/** @throws {never} */
export function initializeVault(creation: SolanaCreation): PlannedCreation {
  if (creation.bindingDelay > MAX_BINDING_DELAY || creation.rotationDelay > MAX_ROTATION_DELAY) return { kind: "refused", issue: "delayOutOfRange" };
  const bounty = creation.purpose === "Bounty";
  if (bounty && creation.monthly !== undefined) return { kind: "refused", issue: "bountyHasNoMonthlyPolicy" };
  if (!bounty && creation.monthly === undefined) return { kind: "refused", issue: "monthlyPolicyRequired" };
  const { program, owner, asset } = creation;
  const project = projectAddress(program, owner, creation.projectDigest, creation.purpose);
  const vault = vaultAddress(program, project);
  const config = configAddress(program);
  const accounts = asset.kind === "Native"
    ? [meta(owner, true, true), meta(project, true), meta(vault, true), meta(SYSTEM_PROGRAM as Address, false), meta(config, false)]
    : [meta(owner, true, true), meta(project, true), meta(asset.mint, false), meta(vault, true), meta(asset.tokenProgram, false), meta(SYSTEM_PROGRAM as Address, false), meta(config, false)];
  const initialize: Instruction = {
    program,
    accounts,
    data: anchorData(asset.kind === "Native" ? "initialize_native" : "initialize", digestBytes(creation.projectDigest), digestBytes(creation.networkDomain),
      keyBytes(creation.identityAuthority), keyBytes(creation.feeRecipient), u64le(creation.bindingDelay), u64le(creation.rotationDelay), Uint8Array.of(PURPOSE_BYTE[creation.purpose])),
  };
  if (creation.monthly === undefined) return { kind: "planned", plan: { project, vault, config, instructions: [initialize] } };
  const monthly = setMonthlyCommitment({ program, project, owner, cap: creation.monthly.cap, enabled: creation.monthly.enabled });
  if (monthly.kind === "refused") return { kind: "refused", issue: "zeroMonthlyCap" };
  return { kind: "planned", plan: { project, vault, config, instructions: [initialize, monthly.value] } };
}
