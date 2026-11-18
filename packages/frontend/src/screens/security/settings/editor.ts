// spec/security/program.md, "A program revision needs current owner authority and exact split rules"; spec/security/terms.md, "Exclusions are frozen with the terms and stay advice"; spec/security/terms.md, "Paid terms carry their split, funding policy, eligibility class and asset"
import { type SharePreview, bountySharePreview, carriedSecurityTerms, initialSecuritySplit } from "@repo/security/client";
import type { Chain } from "@repo/settlement/kernels/networks";
import { formatBaseUnits } from "@repo/settlement/kernels/amounts";
import { Result, Schema } from "effect";
import { assetBaseUnits } from "../../../flows/security/bountyAsset.ts";
import { bountyAmountFields } from "../../../flows/security/program.vibe";
import type { RewardAssetSelection } from "../../setup/fields/rewardAsset.ts";

const chains: ReadonlyArray<Chain> = ["base", "ethereum", "robinhood", "solana"];
const assetKinds: ReadonlyArray<RewardAssetSelection["assetKind"]> = ["stablecoin", "native", "token"];

const Asset = Schema.Struct({ kind: Schema.optional(Schema.String), symbol: Schema.optional(Schema.String), network: Schema.optional(Schema.String), address: Schema.optional(Schema.String) });

const ExistingTerms = Schema.Struct({
  status: Schema.Literals(["draft", "pending-approval", "open", "paused", "closed"]),
  rewardMode: Schema.optional(Schema.String),
  eligibility: Schema.optional(Schema.String),
  fundingPolicy: Schema.optional(Schema.String),
  split: Schema.optional(Schema.Struct({ researcherBasisPoints: Schema.Number, slopBasisPoints: Schema.Number })),
  amount: Schema.Struct({ currency: Schema.String, decimals: Schema.Number, grossMinor: Schema.String, network: Schema.optional(Schema.NullOr(Schema.String)), asset: Schema.optional(Asset) }),
  capacity: Schema.Struct({ awards: Schema.NullOr(Schema.Number), closesAt: Schema.NullOr(Schema.String), exhaustionRule: Schema.String }),
  scope: Schema.Struct({
    sourceRevisions: Schema.Array(Schema.Struct({ repository: Schema.String, commit: Schema.String })),
    deployments: Schema.Array(Schema.Unknown),
    includedAssets: Schema.Array(Schema.String),
    excludedDependencies: Schema.Array(Schema.String),
    excludedFindings: Schema.optional(Schema.Array(Schema.String)),
    testingPermission: Schema.String,
    severityRubric: Schema.String,
    lossDefinition: Schema.String,
  }),
  responseTargets: Schema.optional(Schema.Struct({ acknowledgeHours: Schema.Number, triageBusinessDays: Schema.Number, updateIntervalDays: Schema.Number })),
  approvers: Schema.Struct({ technical: Schema.Array(Schema.Struct({ githubLogin: Schema.String })) }),
  dispute: Schema.Struct({ process: Schema.String, authority: Schema.optional(Schema.String) }),
  disclosure: Schema.String,
  safeHarbor: Schema.String,
  settlement: Schema.optional(Schema.Struct({ deployments: Schema.Array(Schema.Unknown) })),
});

const ManifestFields = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  repositories: Schema.NonEmptyArray(Schema.Struct({ id: Schema.String })),
  rewardAsset: Schema.optional(Asset),
  securityBounty: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

type ExistingTerms = typeof ExistingTerms.Type;
type Raw = Readonly<Record<string, unknown>>;

export interface EditorProject {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly repository: string;
  readonly rewardAsset: (typeof Asset.Type) | undefined;
  /** The whole manifest, republished with only its security bounty replaced. */
  readonly manifest: Raw;
  readonly existing: { readonly terms: ExistingTerms; readonly raw: Raw } | undefined;
}

export type TextField = "includedAssets" | "excludedDependencies" | "excludedFindings" | "testingPermission" | "severityRubric" | "lossDefinition" | "exhaustionRule" | "dispute" | "disclosure" | "safeHarbor";

export interface ResponseTargets {
  readonly acknowledgeHours: number;
  readonly triageBusinessDays: number;
  readonly updateIntervalDays: number;
}

export interface EditorForm {
  readonly status: ExistingTerms["status"];
  readonly amount: string;
  readonly asset: RewardAssetSelection;
  readonly assetChanged: boolean;
  readonly commit: string;
  readonly awards: string;
  readonly response: ResponseTargets;
  readonly text: Readonly<Record<TextField, string>>;
}

export const textFields: ReadonlyArray<readonly [TextField, string]> = [
  ["includedAssets", "Covered assets"],
  ["excludedDependencies", "Excluded dependencies"],
  ["excludedFindings", "Also does not qualify"],
  ["testingPermission", "Test rules"],
  ["severityRubric", "Severity guide"],
  ["lossDefinition", "Loss of funds"],
  ["exhaustionRule", "When funds run out"],
  ["dispute", "Disputes"],
  ["disclosure", "Disclosure"],
  ["safeHarbor", "Researcher protection"],
];

export const textGroups: ReadonlyArray<readonly [string, ReadonlyArray<TextField>]> = [
  ["Scope and testing", ["includedAssets", "excludedDependencies", "excludedFindings", "testingPermission"]],
  ["Award criteria", ["severityRubric", "lossDefinition", "exhaustionRule"]],
  ["Researcher terms", ["dispute", "disclosure", "safeHarbor"]],
];

export const responseFields: ReadonlyArray<readonly [keyof ResponseTargets, string, number]> = [
  ["acknowledgeHours", "Acknowledge within (hours)", 336],
  ["triageBusinessDays", "Triage within (business days)", 60],
  ["updateIntervalDays", "Send an update every (days)", 60],
];

const decodeManifest = Schema.decodeUnknownResult(ManifestFields);
const decodeTerms = Schema.decodeUnknownResult(ExistingTerms);

/** The current revision's manifest as the editor reads it, or undefined when it is not one. @throws {never} */
export function editorProjectOf(manifest: unknown): EditorProject | undefined {
  const fields = decodeManifest(manifest);
  if (!Result.isSuccess(fields) || typeof manifest !== "object" || manifest === null) return undefined;
  const { id, slug, name, repositories, rewardAsset, securityBounty } = fields.success;
  const base = { id, slug, name, repository: repositories[0].id, rewardAsset, manifest: manifest as Raw };
  if (securityBounty === undefined) return { ...base, existing: undefined };
  const terms = decodeTerms(securityBounty);
  return Result.isSuccess(terms) ? { ...base, existing: { terms: terms.success, raw: securityBounty } } : undefined;
}

const optionalLists: ReadonlySet<TextField> = new Set(["excludedDependencies", "excludedFindings"]);

/** @throws {never} */
export function textLimits(field: TextField): { readonly required: boolean; readonly minLength: number | undefined; readonly maxLength: number } {
  const optional = optionalLists.has(field);
  return {
    required: !optional,
    minLength: optional ? undefined : field === "includedAssets" ? 2 : 12,
    maxLength: field === "safeHarbor" ? 4000 : optional || field === "includedAssets" ? 10000 : field === "exhaustionRule" ? 1000 : 2000,
  };
}

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function plainGross(terms: ExistingTerms): string {
  const { grossMinor, decimals } = terms.amount;
  return /^[0-9]+$/u.test(grossMinor) && Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? formatBaseUnits({ value: BigInt(grossMinor), decimals, grouping: false }) : "";
}

/** @throws {never} */
export function boundVault(project: EditorProject): boolean {
  return (project.existing?.terms.settlement?.deployments.length ?? 0) > 0;
}

/** @throws {never} */
export function afterApproval(project: EditorProject): boolean {
  return project.existing === undefined || project.existing.terms.fundingPolicy === "after-approval";
}

/** @throws {never} */
export function editorSplit(project: EditorProject) {
  return initialSecuritySplit(project.existing?.terms);
}

/** @throws {never} */
export function initialForm(project: EditorProject): EditorForm {
  const existing = project.existing?.terms;
  const asset = existing?.amount.asset ?? (existing === undefined ? project.rewardAsset : undefined);
  const network = asset?.network ?? existing?.amount.network ?? "base";
  const kind = asset?.kind ?? "stablecoin";
  const assetKind = assetKinds.find((entry) => entry === kind) ?? "stablecoin";
  return {
    status: existing?.status ?? "paused",
    amount: existing ? plainGross(existing) : "",
    asset: {
      network: chains.find((chain) => chain === network) ?? "base",
      assetKind,
      tokenAddress: assetKind === "token" ? (asset?.address ?? "") : "",
      tokenSymbol: assetKind === "token" ? (asset?.symbol ?? "") : "",
    },
    assetChanged: false,
    commit: existing?.scope.sourceRevisions[0]?.commit ?? "",
    awards: existing?.capacity.awards === null ? "" : String(existing?.capacity.awards ?? 1),
    response: existing?.responseTargets ?? { acknowledgeHours: 24, triageBusinessDays: 3, updateIntervalDays: 7 },
    text: {
      includedAssets: existing?.scope.includedAssets.join("\n") ?? "",
      excludedDependencies: existing?.scope.excludedDependencies.join("\n") ?? "",
      excludedFindings: existing?.scope.excludedFindings?.join("\n") ?? "",
      testingPermission: existing?.scope.testingPermission ?? "",
      severityRubric: existing?.scope.severityRubric ?? "",
      lossDefinition: existing?.scope.lossDefinition ?? "",
      exhaustionRule: existing?.capacity.exhaustionRule ?? "",
      dispute: existing?.dispute.process ?? "",
      disclosure: existing?.disclosure ?? "",
      safeHarbor: existing?.safeHarbor ?? "",
    },
  };
}

/** The asset the award is named in. @throws {never} */
export function amountCurrency(project: EditorProject, form: EditorForm): string {
  if (project.existing && !form.assetChanged) return project.existing.terms.amount.currency;
  const field = bountyAmountFields({ ...form.asset, mode: "monthly", monthlyAmount: "4" });
  return field.kind === "amount" ? field.amount.currency : form.asset.tokenSymbol || "token";
}

type Proposed = { readonly amount: Raw; readonly currency: string; readonly decimals: number; readonly asset: { readonly kind?: string; readonly symbol: string } | undefined; readonly grossMinor: string };

function proposedAmount(project: EditorProject, form: EditorForm): Proposed | undefined {
  const existing = project.existing;
  if (existing && !form.assetChanged) {
    const { amount } = existing.terms;
    const gross = assetBaseUnits(form.amount, amount.decimals);
    if (gross.kind === "invalid") return undefined;
    const raw = existing.raw.amount;
    const asset = amount.asset?.symbol === undefined ? undefined : { ...(amount.asset.kind === undefined ? {} : { kind: amount.asset.kind }), symbol: amount.asset.symbol };
    return { amount: { ...(typeof raw === "object" && raw !== null ? (raw as Raw) : {}), grossMinor: gross.minor }, currency: amount.currency, decimals: amount.decimals, asset, grossMinor: gross.minor };
  }
  const field = bountyAmountFields({ ...form.asset, mode: "monthly", monthlyAmount: form.amount });
  if (field.kind === "invalid") return undefined;
  const { amount } = field;
  return { amount: { ...amount }, currency: amount.currency, decimals: amount.decimals, asset: { kind: amount.asset.kind, symbol: amount.asset.symbol }, grossMinor: amount.grossMinor };
}

/** The gross award and its researcher and Slop shares, or undefined while the amount or asset does not resolve. @throws {never} */
export function amountPreview(project: EditorProject, form: EditorForm): SharePreview | undefined {
  const proposed = proposedAmount(project, form);
  if (proposed === undefined) return undefined;
  return bountySharePreview({ currency: proposed.currency, decimals: proposed.decimals, ...(proposed.asset ? { asset: proposed.asset } : {}) }, proposed.grossMinor, form.amount, editorSplit(project));
}

/** The terms this form publishes, carrying every published field it does not edit. @throws {never} */
export function proposedProgram(project: EditorProject, form: EditorForm, actor: { readonly githubId: string; readonly githubLogin: string }): Raw {
  const existing = project.existing;
  const raw = existing?.raw ?? {};
  const terms = existing?.terms;
  const owner = { githubId: actor.githubId, githubLogin: actor.githubLogin };
  const later = afterApproval(project);
  const rawScope = typeof raw.scope === "object" && raw.scope !== null ? (raw.scope as Raw) : {};
  const { text } = form;
  const excludedFindings = lines(text.excludedFindings);
  return {
    ...carriedSecurityTerms(existing?.raw),
    ...(form.assetChanged && !boundVault(project) ? { settlement: undefined } : {}),
    ...(later ? { fundingPolicy: "after-approval" } : {}),
    version: "1",
    status: form.status,
    rewardMode: terms?.rewardMode ?? "separate",
    eligibility: terms?.eligibility ?? "in-scope-security",
    amount: proposedAmount(project, form)?.amount ?? {},
    split: { ...editorSplit(project) },
    sponsor: raw.sponsor ?? { name: project.name, githubId: actor.githubId },
    funding: form.assetChanged ? { state: "pledged" } : (raw.funding ?? { state: "pledged" }),
    capacity: { awards: later && form.awards === "" ? null : Number(form.awards), closesAt: terms?.capacity.closesAt ?? null, exhaustionRule: text.exhaustionRule.trim() },
    scope: {
      sourceRevisions: [{ repository: terms?.scope.sourceRevisions[0]?.repository ?? project.repository, commit: form.commit.trim() }, ...(terms?.scope.sourceRevisions.slice(1) ?? [])],
      deployments: rawScope.deployments ?? [],
      includedAssets: lines(text.includedAssets),
      excludedDependencies: lines(text.excludedDependencies),
      ...(excludedFindings.length > 0 ? { excludedFindings } : {}),
      testingPermission: text.testingPermission.trim(),
      severityRubric: text.severityRubric.trim(),
      lossDefinition: text.lossDefinition.trim(),
    },
    intake: raw.intake ?? { kind: "github-private-vulnerability-reporting", repository: project.repository },
    responseTargets: form.response,
    approvers: raw.approvers ?? { technical: [owner], financial: [owner], dispute: [owner] },
    dispute: { authority: terms?.dispute.authority ?? "advisory", process: text.dispute.trim() },
    disclosure: text.disclosure.trim(),
    safeHarbor: text.safeHarbor.trim(),
  };
}

/** Whether these terms create or change an asset award, whose precision only the server may resolve from the typed amount. @throws {never} */
export function assetAwardChanged(project: EditorProject, form: EditorForm): boolean {
  const proposed = proposedAmount(project, form);
  if (proposed?.asset === undefined) return false;
  const published = project.existing?.terms.amount;
  return form.assetChanged || published?.asset === undefined || published.grossMinor !== proposed.grossMinor;
}

export const responseGroup = "Response targets and contacts";

/** The first text or response field the browser cannot check while its group is closed, with that group. @throws {never} */
export function fieldProblem(form: EditorForm): { readonly group: string; readonly message: string } | undefined {
  for (const [group, keys] of textGroups) {
    for (const [key, label] of textFields.filter(([field]) => keys.includes(field))) {
      const { required, minLength, maxLength } = textLimits(key);
      const value = form.text[key].trim();
      if (required && value === "") return { group, message: `Enter ${label.toLowerCase()}.` };
      if (minLength !== undefined && value !== "" && value.length < minLength) return { group, message: `${label} needs at least ${minLength} characters.` };
      if (form.text[key].length > maxLength) return { group, message: `${label} allows at most ${maxLength} characters.` };
    }
  }
  for (const [key, label, max] of responseFields) {
    const value = form.response[key];
    if (!Number.isInteger(value) || value < 1 || value > max) return { group: responseGroup, message: `${label} must be a whole number from 1 to ${max}.` };
  }
  return undefined;
}

/** Why these terms cannot be reviewed yet, or undefined. @throws {never} */
export function programProblem(project: EditorProject, form: EditorForm): string | undefined {
  const proposed = proposedAmount(project, form);
  if (proposed === undefined || amountPreview(project, form) === undefined) return "Check the award amount and asset.";
  const typed = assetBaseUnits(form.amount, proposed.decimals);
  if (typed.kind === "invalid") return typed.message;
  if (typed.minor === "0") return "Enter an award greater than zero.";
  return assetAwardChanged(project, form) ? "A new or changed asset award cannot be published yet: the server cannot resolve the asset's precision from the typed amount. Keep the published award and asset to publish other changes." : undefined;
}

/** The project contacts named under the terms. @throws {never} */
export function contacts(project: EditorProject, actor: { readonly githubLogin: string }): string {
  return (project.existing?.terms.approvers.technical ?? [actor]).map((person) => `@${person.githubLogin}`).join(", ");
}
