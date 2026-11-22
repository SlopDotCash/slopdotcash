// spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"; spec/backend/closureConsent.md, "The new form starts unchecked and an existing form reflects only its exact saved setting"; spec/backend/referralCodes.md, "A current reservation resolves through current open membership"
import { isIntegrationBranch } from "@repo/contributor/render/fields";
import { honorSystemKept } from "../../../../gen/frontend__presentation.ts";
import { type Chain, isChain } from "@repo/settlement/kernels/networks";
import { referrerOf } from "../../../flows/projects/draftStore.vibe";
import type { RepositoryLookup } from "@repo/backend/client";
import {
  boundedText,
  emptyProposal,
  type FundingChoice,
  immutableProposalTermsUrl,
  type MonthlyPoolValue,
  monthlyPoolValue,
  normalizeRepositoryInput,
  type Proposal,
  type ProposalField,
  proposalOf,
  type RewardAssetKind,
  safeProposalHttpsUrl,
  slugify,
  validRepositoryPath,
} from "../../../flows/projects/proposal.ts";
import { privateBountyCriteria, privateBountyTesting } from "../../../flows/security/program.vibe";
import { type LinkInput, normalizeWebsiteInput, normalizeXInput } from "../../../kernels/projectLinks.ts";
import { type SkillRuleField, skillRuleFields } from "../fields/contribution.ts";
import { rewardNetwork, tokenProblem } from "../fields/rewardAsset.ts";

export const setupSteps = ["Project", "Rewards", "Review"] as const;

export type StepIndex = 0 | 1 | 2;

export const defaultCriteria = "Merged pull requests that fix a reproduced bug or deliver a change the maintainers asked for, with tests or other evidence that the result works.";

export type FieldErrors = Partial<Record<ProposalField, string>>;

export interface Suggested {
  readonly name: string;
  readonly headline: string;
  readonly goal: string;
  readonly criteria: string;
}

export interface Wizard {
  readonly proposal: Proposal;
  readonly step: StepIndex;
  readonly referrer: string | null;
  readonly attempted: readonly [boolean, boolean, boolean];
  readonly generation: number;
  readonly suggested: Suggested;
  readonly extraRuleFields: ReadonlyArray<SkillRuleField>;
}

export type Lookup =
  | { readonly state: "idle" }
  | { readonly state: "loading" }
  | { readonly state: "done"; readonly facts: RepositoryLookup }
  | { readonly state: "error"; readonly message: string };

const noSuggestion: Suggested = { name: "", headline: "", goal: "", criteria: "" };
const notAttempted = [false, false, false] as const;
const githubLogin = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
const gitSha = /^[0-9a-f]{40}$/u;
const fileDigest = /^[0-9a-f]{64}$/u;
const numericId = /^[1-9]\d{0,39}$/u;
const nodeId = /^[A-Za-z0-9_=-]{1,100}$/u;
const spdx = /^[A-Za-z0-9-.+]{1,80}$/u;

const projectFields: ReadonlyArray<ProposalField> = [
  "repository", "repositoryNumericId", "repositoryNodeId", "integrationBranch", "stewardLogin", "stewardActorId", "stewardNodeId",
  "licenseSpdx", "licenseCommit", "licenseDigest", "name", "image", "headline", "goal", "website", "x", "criteria", "contributionGuide",
  "supportedTasks", "requiredTests", "reviewExpectations", "securityContact", "closurePolicy", "maintainerNotes", "copyrightModel",
  "legalHolder", "inboundTermsUrl", "inboundCommit", "inboundDigest", "inboundVersion", "inboundAcceptance", "assignmentAssignee",
  "assignmentUrl", "assignmentDigest", "assignmentVersion", "assignmentSignedAt",
];
const rewardFields: ReadonlyArray<ProposalField> = ["monthlyPool", "settlementChain", "rewardAssetAddress", "rewardAssetSymbol"];

const factFields = {
  repositoryNumericId: "",
  repositoryNodeId: "",
  integrationBranch: emptyProposal.integrationBranch,
  sourceCommit: "",
  stewardKind: emptyProposal.stewardKind,
  stewardLogin: "",
  stewardActorId: "",
  stewardNodeId: "",
  licenseSpdx: "",
  licenseCommit: "",
  licenseDigest: "",
} as const satisfies Partial<Proposal>;

/** @throws {never} */
export function stepOfField(field: ProposalField): StepIndex | undefined {
  if (projectFields.includes(field)) return 0;
  return rewardFields.includes(field) ? 1 : undefined;
}

/** @throws {never} */
export function isStep(value: unknown): value is StepIndex {
  return value === 0 || value === 1 || value === 2;
}

function parsed(text: string | null): Readonly<Record<string, unknown>> | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : null;
  } catch {
    return null;
  }
}

/** @throws {never} */
export function restoredWizard(saved: string | null, search: string): Wizard {
  const record = parsed(saved);
  const proposal = proposalOf(record?.proposal ?? null) ?? { ...emptyProposal };
  return {
    proposal,
    step: isStep(record?.step) ? record.step : 0,
    referrer: referrerOf(search, record?.referrer),
    attempted: notAttempted,
    generation: 0,
    suggested: noSuggestion,
    extraRuleFields: skillRuleFields.filter((field) => field !== "requiredTests" && proposal[field] !== ""),
  };
}

/** @throws {never} */
export function withReferrer(wizard: Wizard, search: string): Wizard {
  const referrer = referrerOf(search, wizard.referrer);
  return referrer === wizard.referrer ? wizard : { ...wizard, referrer };
}

/** @throws {never} */
export function clearedWizard(wizard: Wizard, referrer: string | null): Wizard {
  return { proposal: { ...emptyProposal }, step: 0, referrer, attempted: notAttempted, generation: wizard.generation + 1, suggested: noSuggestion, extraRuleFields: [] };
}

/** @throws {never} */
export function draftPayload({ proposal, step, referrer }: Wizard): string | null {
  const empty = step === 0 && referrer === null && (Object.keys(emptyProposal) as ProposalField[]).every((field) => proposal[field] === emptyProposal[field]);
  return empty ? null : JSON.stringify({ proposal, step, referrer });
}

/** @throws {never} */
export function lookupKey(wizard: Wizard): string | undefined {
  const repository = normalizeRepositoryInput(wizard.proposal.repository);
  return validRepositoryPath(repository) ? `${wizard.generation}:${repository.toLowerCase()}` : undefined;
}

/** @throws {never} */
export function branchesOf(proposal: Proposal, lookup: Lookup): RepositoryLookup | undefined {
  return lookup.state === "done" && lookup.facts.repository === proposal.repository ? lookup.facts : undefined;
}

/** @throws {never} */
export function withRepository(wizard: Wizard, repository: string): Wizard {
  const current = wizard.proposal.repository;
  if (current.toLowerCase() === repository.toLowerCase()) return wizard;
  return { ...wizard, generation: wizard.generation + 1, proposal: { ...wizard.proposal, ...factFields, repository } };
}

/** @throws {never} */
export function withField(wizard: Wizard, field: Exclude<ProposalField, "repository">, value: string, facts: RepositoryLookup | undefined): Wizard {
  const current = wizard.proposal;
  const branch = field === "integrationBranch" ? { sourceCommit: facts?.branchCommits?.[value] ?? "" } : {};
  const funding =
    field !== "fundingMode"
      ? {}
      : value === "bounty"
        ? { criteria: current.criteria === defaultCriteria ? privateBountyCriteria : current.criteria, requiredTests: current.requiredTests || privateBountyTesting }
        : {
            criteria: current.criteria === privateBountyCriteria ? defaultCriteria : current.criteria,
            requiredTests: current.requiredTests === privateBountyTesting ? "" : current.requiredTests,
          };
  const promise = field === "fundingMode" && value !== "monthly" ? { honorSystem: "false" } : {};
  return { ...wizard, proposal: { ...current, [field]: value, ...branch, ...funding, ...promise } };
}

/** @throws {never} */
export function withFacts(wizard: Wizard, key: string, facts: RepositoryLookup): Wizard {
  if (lookupKey(wizard) !== key) return wizard;
  const current = wizard.proposal;
  const description = facts.description ?? "";
  const suggested: Suggested = {
    name: facts.repository.split("/")[1] ?? "",
    headline: boundedText(description, 8, 120) ? description : "",
    goal: boundedText(description, 24, 600) ? description : "",
    criteria: defaultCriteria,
  };
  const fill = (field: keyof Suggested) => (current[field] === "" || current[field] === wizard.suggested[field] ? suggested[field] : current[field]);
  const sameRepository = current.repositoryNumericId === facts.numericId;
  const branch = sameRepository ? current.integrationBranch : facts.defaultBranch;
  const license = facts.license.state === "verified" ? facts.license : undefined;
  return {
    ...wizard,
    suggested,
    proposal: {
      ...current,
      name: fill("name"),
      headline: fill("headline"),
      goal: fill("goal"),
      criteria: fill("criteria"),
      repository: facts.repository,
      repositoryNumericId: facts.numericId,
      repositoryNodeId: facts.nodeId,
      integrationBranch: branch,
      sourceCommit: facts.branchCommits[branch] ?? "",
      stewardKind: facts.owner.kind,
      stewardLogin: facts.owner.login,
      stewardActorId: facts.owner.actorId,
      stewardNodeId: facts.owner.nodeId,
      licenseSpdx: license?.spdx ?? "",
      licenseCommit: license?.commitSha ?? "",
      licenseDigest: license?.fileSha256 ?? "",
    },
  };
}

/** @throws {never} */
export function rewardKindOf(proposal: Proposal): RewardAssetKind {
  return proposal.rewardKind === "token" ? "token" : proposal.rewardKind === "native" ? "native" : "stablecoin";
}

/** @throws {never} */
export function chainOf(proposal: Proposal): Chain | undefined {
  return isChain(proposal.settlementChain) ? proposal.settlementChain : undefined;
}

/** @throws {never} */
export function fundingOf(proposal: Proposal): FundingChoice {
  return {
    mode: proposal.fundingMode === "monthly" ? "monthly" : "none",
    network: chainOf(proposal) ?? "base",
    assetKind: rewardKindOf(proposal),
    tokenAddress: proposal.rewardAssetAddress,
    tokenSymbol: proposal.rewardAssetSymbol,
    monthlyAmount: proposal.monthlyPool,
  };
}

/** The owner's honor-system promise as published: only a chosen promise on a monthly pool. @throws {never} */
export function honorSystemOf(proposal: Proposal): boolean {
  return honorSystemKept(proposal.fundingMode === "monthly", proposal.honorSystem === "true");
}

/** @throws {never} */
export function poolOf(proposal: Proposal): MonthlyPoolValue {
  const kind = rewardKindOf(proposal);
  const chain = chainOf(proposal);
  const token = kind === "token" ? { symbol: proposal.rewardAssetSymbol } : kind === "native" && chain !== undefined ? rewardNetwork(chain)?.native : undefined;
  return monthlyPoolValue(proposal.monthlyPool, token);
}

function lengthError(value: string, minimum: number, maximum: number): string | undefined {
  return boundedText(value, minimum, maximum) ? undefined : `Enter ${minimum} to ${maximum} characters.`;
}

function linkError(input: LinkInput): string | undefined {
  return input.ok ? undefined : input.error;
}

function rewardErrors(p: Proposal): FieldErrors {
  if (p.fundingMode !== "monthly" && p.fundingMode !== "bounty") return {};
  const errors: FieldErrors = {};
  const chain = chainOf(p);
  if (chain === undefined) errors.settlementChain = "Choose a supported network.";
  if (p.rewardKind === "token" && chain !== undefined) {
    const problem = tokenProblem({ network: chain, assetKind: "token", tokenAddress: p.rewardAssetAddress, tokenSymbol: p.rewardAssetSymbol });
    if (problem?.field === "tokenAddress") errors.rewardAssetAddress = problem.message;
    if (problem?.field === "tokenSymbol") errors.rewardAssetSymbol = problem.message;
  }
  const amount = poolOf(p);
  if (!amount.valid) errors.monthlyPool = amount.error;
  else if (p.fundingMode === "bounty" && p.rewardKind !== "token" && BigInt(amount.minor) % 4n !== 0n) errors.monthlyPool = "Amount must split into whole token units.";
  return errors;
}

function legalErrors(p: Proposal): FieldErrors {
  const errors: FieldErrors = {};
  if (p.copyrightModel === "sponsor-owned") {
    const holder = lengthError(p.legalHolder, 2, 240);
    if (holder) errors.legalHolder = holder;
    if (p.stewardKind === "dao") errors.copyrightModel = "Not available for a DAO steward.";
  }
  if (p.inboundMode !== "unknown") {
    if (!immutableProposalTermsUrl(p.inboundTermsUrl, p.repository, p.inboundCommit)) errors.inboundTermsUrl = "Use this repo's GitHub blob URL at that commit.";
    if (!gitSha.test(p.inboundCommit)) errors.inboundCommit = "Enter a 40-character commit SHA.";
    if (!fileDigest.test(p.inboundDigest)) errors.inboundDigest = "Enter a 64-character SHA-256.";
    const version = lengthError(p.inboundVersion, 1, 80);
    if (version) errors.inboundVersion = version;
    const acceptance = lengthError(p.inboundAcceptance, 1, 240);
    if (acceptance) errors.inboundAcceptance = acceptance;
  }
  if (p.copyrightModel === "sponsor-owned" || p.inboundMode === "assignment") {
    const assignee = lengthError(p.assignmentAssignee, 2, 240);
    if (assignee) errors.assignmentAssignee = assignee;
    if (!safeProposalHttpsUrl(p.assignmentUrl)) errors.assignmentUrl = "Enter an https URL.";
    if (!fileDigest.test(p.assignmentDigest)) errors.assignmentDigest = "Enter a 64-character SHA-256.";
    const version = lengthError(p.assignmentVersion, 1, 80);
    if (version) errors.assignmentVersion = version;
    if (p.assignmentSignedAt.length === 0) errors.assignmentSignedAt = "Enter the signing date and time.";
  }
  return errors;
}

/** @throws {never} */
export function proposalErrors(p: Proposal): FieldErrors {
  const errors: FieldErrors = {};
  if (!validRepositoryPath(p.repository)) errors.repository = p.repository ? "Use owner/repository." : "Choose a repository.";
  if (!numericId.test(p.repositoryNumericId) || !nodeId.test(p.repositoryNodeId) || !githubLogin.test(p.stewardLogin) || !numericId.test(p.stewardActorId) || !nodeId.test(p.stewardNodeId))
    errors.repository ??= "Wait for the repository to load.";
  if (!isIntegrationBranch(p.integrationBranch)) errors.integrationBranch = "Enter a valid Git branch name.";
  if ((p.licenseSpdx !== "" || p.licenseCommit !== "" || p.licenseDigest !== "") && (!spdx.test(p.licenseSpdx) || !gitSha.test(p.licenseCommit) || !fileDigest.test(p.licenseDigest)))
    errors.repository ??= "Look up the repository again to refresh its license.";
  const lengths = [
    ["name", lengthError(p.name, 2, 80)],
    ["headline", lengthError(p.headline, 8, 120)],
    ["goal", lengthError(p.goal, 24, 600)],
    ["criteria", lengthError(p.criteria, 6, 2_000)],
    ["website", linkError(normalizeWebsiteInput(p.website))],
    ["x", linkError(normalizeXInput(p.x))],
    ...skillRuleFields.map((field) => [field, p[field].trim() === "" ? undefined : lengthError(p[field], 1, 2_000)] as const),
  ] as const;
  for (const [field, error] of lengths) if (error) errors[field] = error;
  Object.assign(errors, legalErrors(p), rewardErrors(p));
  if (p.fundingMode === "bounty") {
    if (!gitSha.test(p.sourceCommit)) errors.integrationBranch = "Reload the repository to verify this branch.";
    if (p.criteria.trim().length < 12) errors.criteria = "Describe the accepted security finding.";
    if (p.requiredTests.trim() && p.requiredTests.trim().length < 12) errors.requiredTests = "Describe the safe testing rules.";
  }
  return errors;
}

/** @throws {never} */
export function setupErrors(p: Proposal, lookup: Lookup): FieldErrors {
  const errors = proposalErrors(p);
  if (lookup.state === "error") errors.repository = lookup.message;
  const facts = branchesOf(p, lookup);
  if (p.repositoryNumericId && (facts === undefined || !facts.branches.includes(p.integrationBranch)))
    errors.integrationBranch = facts === undefined ? "Wait for the repository branches to load." : "Choose a repository branch.";
  return errors;
}

/** @throws {never} */
export function firstErrorOf(errors: FieldErrors, step: StepIndex): ProposalField | undefined {
  return (Object.keys(errors) as ProposalField[]).find((field) => stepOfField(field) === step);
}

/** @throws {never} */
export function invalidPriorField(wizard: Wizard, errors: FieldErrors, lookup: Lookup): ProposalField | undefined {
  const pendingBranches = (field: ProposalField) =>
    field === "integrationBranch" && wizard.proposal.repositoryNumericId !== "" && branchesOf(wizard.proposal, lookup) === undefined && lookup.state !== "error";
  return (Object.keys(errors) as ProposalField[]).find((field) => (stepOfField(field) ?? wizard.step) < wizard.step && !pendingBranches(field));
}

/** @throws {never} */
export function withPriorStep(wizard: Wizard, lookup: Lookup): Wizard {
  const field = invalidPriorField(wizard, setupErrors(wizard.proposal, lookup), lookup);
  const owner = field === undefined ? undefined : stepOfField(field);
  return owner === undefined ? wizard : withAttempted({ ...wizard, step: owner }, owner);
}

/** @throws {never} */
export function withLookup(wizard: Wizard, key: string, lookup: Lookup): Wizard {
  if (lookupKey(wizard) !== key) return wizard;
  return withPriorStep(lookup.state === "done" ? withFacts(wizard, key, lookup.facts) : wizard, lookup);
}

/** @throws {never} */
export function shownError(wizard: Wizard, errors: FieldErrors, field: ProposalField): string | undefined {
  const owner = stepOfField(field);
  return owner !== undefined && (wizard.attempted[owner] || wizard.attempted[2]) ? errors[field] : undefined;
}

/** @throws {never} */
export function attemptedThrough(wizard: Wizard, step: StepIndex): Wizard {
  const marks = wizard.attempted.map((value, owner) => value || owner < step);
  return { ...wizard, attempted: [marks[0] ?? false, marks[1] ?? false, marks[2] ?? false] };
}

/** @throws {never} */
export function withAttempted(wizard: Wizard, step: StepIndex): Wizard {
  const marks = wizard.attempted.map((value, owner) => value || owner === step);
  return { ...wizard, attempted: [marks[0] ?? false, marks[1] ?? false, marks[2] ?? false] };
}

/** @throws {never} */
export function slugOf(p: Proposal): string {
  return slugify(p.name) || slugify(p.repository.split("/").at(-1) ?? "") || "new-project";
}
