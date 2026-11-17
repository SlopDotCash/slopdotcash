// spec/backend/projects.md, "Owner revisions publish at once against the expected revision"; spec/backend/projects.md, "Appending a repository pauses the project and its work counts from next month"; spec/backend/closureConsent.md, "A saved edit records an explicit No only after an explicit Yes"; spec/frontend/projectDrafts.md, "Each saved setup draft has a strictly greater revision than the record it replaces"
import { classifyRevisionChanges, type RevisionChanges } from "@repo/backend/owner/classify";
import { formatBaseUnits } from "@repo/settlement/kernels/amounts";
import { isChain } from "@repo/settlement/kernels/networks";
import { Result, Schema } from "effect";
import type { RepositoryLookup } from "../../../flows/projects/github.vibe";
import { boundedText, type FundingChoice, type MonthlyPoolValue, monthlyCapDisplay, monthlyPoolValue, type RewardAssetKind, rewardFields, validRepositoryPath } from "../../../flows/projects/proposal.ts";
import { type AssetKind, assetSymbol, formatRewardCapDisplay } from "../../../kernels/assetText.ts";
import { contributionLabels, type SkillRuleField, skillRuleFields } from "../fields/contribution.ts";
import { rewardNetwork, tokenProblem } from "../fields/rewardAsset.ts";
import { type ManagedAsset, ManagedManifest, PendingRepository } from "./manifest.schema.ts";

export type Json = Readonly<Record<string, unknown>>;

export type UpdateField = "image" | "automaticClosure" | "headline" | "goal" | "criteria" | SkillRuleField | "fundingMode" | "network" | "assetKind" | "tokenAddress" | "tokenSymbol" | "monthlyAmount" | "repositories";

export type UpdateDraft = Readonly<Record<UpdateField, string>>;

export const updateFields: ReadonlyArray<UpdateField> = ["image", "automaticClosure", "headline", "goal", "criteria", ...skillRuleFields, "fundingMode", "network", "assetKind", "tokenAddress", "tokenSymbol", "monthlyAmount", "repositories"];

export interface Edit {
  readonly fields: Partial<UpdateDraft> | null;
  readonly baseRevision: number | null;
}

export interface Managed {
  readonly revision: number;
  readonly raw: Json;
  readonly manifest: ManagedManifest;
}

export interface ChangeRow {
  readonly label: string;
  readonly current: string;
  readonly proposed: string;
}

export type FormGroup = "listing" | "rules" | "repositories" | "rewards";

export interface UpdateReview {
  readonly value: UpdateDraft;
  readonly added: ReadonlyArray<PendingRepository>;
  readonly choice: FundingChoice;
  readonly errors: Readonly<Record<string, string>>;
  readonly next: Json;
  readonly changes: RevisionChanges;
  readonly changed: boolean;
  readonly rows: ReadonlyArray<ChangeRow>;
  readonly bountyOnly: boolean;
  readonly monthly: boolean;
  readonly assetFixed: boolean;
  readonly offerVault: boolean;
  readonly stale: boolean;
  readonly countsFrom: string;
  readonly nextCycle: string;
  readonly monthlyAmount: string | null;
}

export const untouched: Edit = { fields: null, baseRevision: null };

const maxLongField = 16_384;
const maxField = 4_000;
const maxPendingRepositories = 19;
const addedKeys = "description,displayName,githubId,githubUrl,id,integrationBranch,nodeId";
const githubIdText = /^[1-9][0-9]*$/u;
const nodeIdText = /^[A-Za-z0-9_=-]{1,100}$/u;
const baseUnitsText = /^[0-9]+$/u;
const assetFields = ["network", "assetKind", "tokenAddress", "tokenSymbol"] as const;
const decodeManifest = Schema.decodeUnknownResult(ManagedManifest);
const decodePending = Schema.decodeUnknownResult(Schema.Array(PendingRepository));

function isJson(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function recordOf(value: unknown): Json {
  return isJson(value) ? value : {};
}

function listOf(value: unknown): ReadonlyArray<unknown> {
  return Array.isArray(value) ? value : [];
}

/** @throws {never} */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isJson(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** @throws {never} */
export function baseUnits(minor: string, decimals: number, grouping = true): string | undefined {
  return baseUnitsText.test(minor) && Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? formatBaseUnits({ value: BigInt(minor), decimals, grouping }) : undefined;
}

/** @throws {never} */
export function managedOf(revision: number, raw: unknown): Managed | undefined {
  if (!isJson(raw)) return undefined;
  const decoded = decodeManifest(raw);
  return Result.isSuccess(decoded) ? { revision, raw, manifest: decoded.success } : undefined;
}

/** @throws {never} */
export function restoredEdit(text: string | null): Edit {
  const saved = text === null ? undefined : parsed(text);
  if (!isJson(saved)) return untouched;
  const fields: Partial<Record<UpdateField, string>> = {};
  for (const field of updateFields) {
    const entry = saved[field];
    if (typeof entry === "string" && entry.length <= (field === "image" || field === "repositories" ? maxLongField : maxField)) fields[field] = entry;
  }
  return { fields, baseRevision: typeof saved.baseRevision === "number" ? saved.baseRevision : -1 };
}

/** @throws {never} */
export function editPayload(edit: Edit): string | null {
  return edit.fields === null ? null : JSON.stringify({ ...edit.fields, baseRevision: edit.baseRevision });
}

/** @throws {never} */
export function withField(edit: Edit, field: UpdateField, value: string, revision: number): Edit {
  return { fields: { ...(edit.fields ?? {}), [field]: value }, baseRevision: edit.fields === null ? revision : edit.baseRevision };
}

/** @throws {never} */
export function staleEdit(edit: Edit, revision: number): boolean {
  return edit.fields !== null && edit.baseRevision !== null && edit.baseRevision !== revision;
}

function validAdded(entry: PendingRepository["entry"]): boolean {
  return (
    validRepositoryPath(entry.id) &&
    entry.displayName === entry.id &&
    entry.githubUrl === `https://github.com/${entry.id}` &&
    entry.integrationBranch.length > 0 &&
    entry.integrationBranch.length <= 255 &&
    githubIdText.test(entry.githubId) &&
    nodeIdText.test(entry.nodeId)
  );
}

function exactEntry(item: unknown): boolean {
  return isJson(item) && isJson(item.entry) && Object.keys(item.entry).sort().join(",") === addedKeys;
}

/** The repositories added in this edit, from the saved draft: anything that is not exactly an added entry drops the whole list. @throws {never} */
export function pendingRepositories(text: string): ReadonlyArray<PendingRepository> {
  if (text === "") return [];
  const value = parsed(text);
  if (!Array.isArray(value) || value.length > maxPendingRepositories || !value.every(exactEntry)) return [];
  const decoded = decodePending(value);
  return Result.isSuccess(decoded) && decoded.success.every(({ entry }) => validAdded(entry)) ? decoded.success : [];
}

/** @throws {never} */
export function pendingText(list: ReadonlyArray<PendingRepository>): string {
  return list.length > 0 ? JSON.stringify(list) : "";
}

/** @throws {never} */
export function listedNames(manifest: ManagedManifest, added: ReadonlyArray<PendingRepository>): ReadonlyArray<string> {
  return [...manifest.repositories.flatMap((entry) => [entry.id, ...(entry.aliases ?? [])]), ...added.map(({ entry }) => entry.id)].map((name) => name.toLowerCase());
}

/** Why a looked-up repository cannot be added, or undefined. @throws {never} */
export function additionRefusal(facts: RepositoryLookup, listed: ReadonlyArray<string>): string | undefined {
  if (facts.fork !== false) return `${facts.repository} is a fork. Add the original repository instead.`;
  if (facts.archived !== false) return `${facts.repository} is archived on GitHub.`;
  return listed.includes(facts.repository.toLowerCase()) ? `${facts.repository} is already listed.` : undefined;
}

/** @throws {never} */
export function addedRepository(facts: RepositoryLookup): PendingRepository {
  const description = facts.description ?? "";
  const usable = boundedText(description, 12, 500);
  return {
    entry: { id: facts.repository, displayName: facts.repository, githubUrl: `https://github.com/${facts.repository}`, description: usable ? description.trim() : "", integrationBranch: facts.defaultBranch, githubId: facts.numericId, nodeId: facts.nodeId },
    ownDescription: !usable,
  };
}

/** @throws {never} */
export function nextUtcMonthStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

/** @throws {never} */
export function isBountyOnly(manifest: ManagedManifest): boolean {
  return manifest.securityBounty?.rewardMode === "bounty-only";
}

function positive(minor: string | undefined): boolean {
  return minor !== undefined && baseUnitsText.test(minor) && BigInt(minor) > 0n;
}

/** A funded vault keeps its network and asset. @throws {never} */
export function isAssetFixed(manifest: ManagedManifest): boolean {
  const reward = manifest.reward;
  return reward.kind === "monthly-pool" && (reward.fundingState === "committed" || reward.paymentMode === "enabled" || positive(reward.committedMinor) || (manifest.escrow?.deployments.length ?? 0) > 0);
}

function assetKindOf(kind: string | undefined): RewardAssetKind {
  return kind === "token" ? "token" : kind === "native" ? "native" : "stablecoin";
}

/** The form as the current revision fills it; closure consent is checked only by an exact saved yes. @throws {never} */
export function initialDraft(manifest: ManagedManifest): UpdateDraft {
  const capMinor = manifest.reward.kind === "monthly-pool" ? (manifest.reward.monthlyCapMinor ?? "0") : "0";
  const asset = manifest.rewardAsset;
  const rules = Object.fromEntries(skillRuleFields.map((field) => [field, manifest.contribution?.[field] ?? ""])) as Record<SkillRuleField, string>;
  return {
    ...rules,
    image: manifest.image ?? "",
    automaticClosure: String(manifest.slopbot?.automaticClosure === true),
    headline: manifest.headline,
    goal: manifest.description,
    criteria: manifest.contribution?.approvedScope ?? "",
    fundingMode: capMinor === "0" ? "none" : "monthly",
    network: asset?.network ?? manifest.reward.chain ?? "base",
    assetKind: asset?.kind ?? "stablecoin",
    tokenAddress: asset?.kind === "token" ? asset.address : "",
    tokenSymbol: asset?.kind === "token" ? asset.symbol : "",
    monthlyAmount: capMinor === "0" ? "" : (baseUnits(capMinor, asset?.decimals ?? 6, false) ?? ""),
    repositories: "",
  };
}

function lengthError(value: string, minimum: number, maximum: number): string | undefined {
  return boundedText(value, minimum, maximum) ? undefined : `Enter ${minimum} to ${maximum} characters.`;
}

function capDisplay(minor: string, asset: ManagedAsset | undefined): string {
  if (!asset || asset.kind === "stablecoin") return monthlyCapDisplay(BigInt(minor)) ?? "$0";
  return `${baseUnits(minor, asset.decimals) ?? minor} ${asset.symbol}`;
}

function fundingText(minor: string, decimals: number, symbol: string, kind: AssetKind): string {
  return minor === "0" ? "No monthly funding" : `${baseUnits(minor, decimals) ?? minor} ${assetSymbol({ kind, symbol }) ?? symbol}`;
}

interface Funding {
  readonly choice: FundingChoice;
  readonly amount: MonthlyPoolValue;
  readonly fixed: boolean;
  readonly touched: boolean;
}

function fundingOf(manifest: ManagedManifest, value: UpdateDraft, touched: boolean): Funding {
  const fixed = isAssetFixed(manifest);
  const choice: FundingChoice = {
    mode: value.fundingMode === "monthly" ? "monthly" : "none",
    network: isChain(value.network) ? value.network : "base",
    assetKind: assetKindOf(value.assetKind),
    tokenAddress: value.tokenAddress,
    tokenSymbol: value.tokenSymbol,
    monthlyAmount: value.monthlyAmount,
  };
  const decimals = manifest.rewardAsset?.decimals ?? 6;
  const token = choice.assetKind === "token" ? { symbol: value.tokenSymbol, ...(fixed || !touched ? { decimals } : {}) } : choice.assetKind === "native" ? rewardNetwork(choice.network)?.native : undefined;
  return { choice, amount: monthlyPoolValue(value.monthlyAmount, token), fixed, touched };
}

function errorsOf(value: UpdateDraft, added: ReadonlyArray<PendingRepository>, funding: Funding, bountyOnly: boolean): Readonly<Record<string, string>> {
  const { choice, amount, fixed } = funding;
  const token = !bountyOnly && choice.mode === "monthly" && !fixed && choice.assetKind === "token" ? tokenProblem({ network: choice.network, assetKind: "token", tokenAddress: choice.tokenAddress, tokenSymbol: choice.tokenSymbol }) : undefined;
  const found: ReadonlyArray<readonly [string, string | undefined]> = [
    ["headline", lengthError(value.headline, 8, 120)],
    ["goal", lengthError(value.goal, 24, 600)],
    ["criteria", lengthError(value.criteria, 6, 2_000)],
    ...skillRuleFields.map((field) => [field, value[field].trim() === "" ? undefined : lengthError(value[field], 1, 2_000)] as const),
    ["monthlyAmount", !bountyOnly && choice.mode === "monthly" && !amount.valid ? amount.error : undefined],
    ...(token ? [[token.field, token.message] as const] : []),
    ...added.map((entry, index) => [`addedRepository${index}`, lengthError(entry.entry.description, 12, 500)] as const),
  ];
  return Object.fromEntries(found.filter((entry): entry is readonly [string, string] => entry[1] !== undefined));
}

/** @throws {never} */
export function groupOf(field: string): FormGroup {
  if (field === "headline" || field === "goal") return "listing";
  if (field.startsWith("addedRepository")) return "repositories";
  if (field === "monthlyAmount" || field === "tokenAddress" || field === "tokenSymbol") return "rewards";
  return "rules";
}

interface Proposed {
  readonly managed: Managed;
  readonly value: UpdateDraft;
  readonly added: ReadonlyArray<PendingRepository>;
  readonly funding: Funding;
  readonly bountyOnly: boolean;
  readonly countsFrom: string;
  readonly now: string;
}

function fundingFields({ managed: { raw, manifest }, funding: { choice, amount, fixed, touched }, bountyOnly, now }: Proposed): Json {
  if (bountyOnly || manifest.reward.kind !== "monthly-pool") return {};
  const monthlyCapMinor = choice.mode === "monthly" && amount.valid ? amount.minor : "0";
  const cap = { monthlyCapMinor, monthlyCapDisplay: capDisplay(monthlyCapMinor, manifest.rewardAsset) };
  const reward = recordOf(raw.reward);
  if (fixed || choice.mode === "none" || !touched) return { reward: { ...reward, ...cap } };
  const fields = rewardFields(choice, now);
  return { ...fields, reward: { ...reward, ...fields.reward, rewardStartAt: reward.rewardStartAt } };
}

function nextManifest(proposed: Proposed): Json {
  const { managed: { raw }, value, added, countsFrom } = proposed;
  const closure = value.automaticClosure === "true";
  return {
    ...raw,
    ...fundingFields(proposed),
    ...(added.length > 0 ? { repositories: [...listOf(raw.repositories), ...added.map(({ entry }) => ({ ...entry, description: entry.description.trim(), countsFrom }))] } : {}),
    ...(raw.slopbot !== undefined || closure ? { slopbot: { automaticClosure: closure } } : {}),
    image: value.image || undefined,
    headline: value.headline.trim(),
    description: value.goal.trim(),
    contribution: { ...recordOf(raw.contribution), approvedScope: value.criteria.trim(), ...Object.fromEntries(skillRuleFields.map((field) => [field, value[field].trim()])) },
  };
}

function changedFields(previous: Json, next: Json): string[] {
  return [...new Set([...Object.keys(previous), ...Object.keys(next)])].sort().filter((field) => canonical(previous[field] ?? null) !== canonical(next[field] ?? null));
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function rowsOf({ managed: { raw, manifest }, funding: { choice, amount }, bountyOnly }: Proposed, next: Json): ReadonlyArray<ChangeRow> {
  const contribution = recordOf(raw.contribution);
  const proposedContribution = recordOf(next.contribution);
  const enabled = (vault: unknown) => (vault ? "Enabled" : "Not enabled");
  const allowed = (slopbot: unknown) => (recordOf(slopbot).automaticClosure === true ? "Allowed" : "Not allowed");
  const names = (list: unknown) => listOf(list).map((entry) => text(recordOf(entry).id)).join(", ");
  const currency = text(recordOf(next.reward).currency);
  const decimals = manifest.rewardAsset?.decimals ?? 6;
  const monthlyRows: ReadonlyArray<ChangeRow> =
    !bountyOnly && manifest.reward.kind === "monthly-pool" && recordOf(next.reward).kind === "monthly-pool"
      ? [
          {
            label: "Monthly funding",
            current: fundingText(manifest.reward.monthlyCapMinor ?? "0", decimals, manifest.reward.currency ?? "", assetKindOf(manifest.rewardAsset?.kind)),
            proposed:
              choice.mode === "monthly" && amount.valid
                ? choice.assetKind === "stablecoin"
                  ? fundingText(amount.minor, 6, currency, "stablecoin")
                  : formatRewardCapDisplay(amount.display, { kind: choice.assetKind, symbol: currency })
                : "No monthly funding",
          },
        ]
      : [];
  const rows: ReadonlyArray<ChangeRow> = [
    { label: "Vault setup", current: enabled(raw.escrow), proposed: enabled(next.escrow) },
    { label: "Slopbot automatic closure", current: allowed(raw.slopbot), proposed: allowed(next.slopbot) },
    ...(raw.image !== next.image ? [{ label: "Project image", current: raw.image ? "Current custom image" : "GitHub owner avatar", proposed: next.image ? "New custom image" : "GitHub owner avatar" }] : []),
    { label: "Repositories", current: names(raw.repositories), proposed: names(next.repositories) },
    { label: "Short description", current: text(raw.headline), proposed: text(next.headline) },
    { label: "Goal", current: text(raw.description), proposed: text(next.description) },
    { label: "Acceptance criteria", current: text(contribution.approvedScope), proposed: text(proposedContribution.approvedScope) },
    ...skillRuleFields.map((field) => ({ label: contributionLabels[field].label, current: text(contribution[field]), proposed: text(proposedContribution[field]) })),
    ...monthlyRows,
  ];
  return rows.filter((row) => row.current !== row.proposed).map((row) => ({ label: row.label, current: row.current || "Not set", proposed: row.proposed || "Not set" }));
}

function touchedAsset(manifest: ManagedManifest, fields: Partial<UpdateDraft> | null, initial: UpdateDraft): boolean {
  if (fields === null) return false;
  return (!manifest.escrow && fields.fundingMode === "monthly") || assetFields.some((field) => fields[field] !== undefined && fields[field] !== initial[field]);
}

/** Everything the update form shows and publishes, from the current revision, the saved edit and the clock. @throws {never} */
export function reviewOf(managed: Managed, edit: Edit, now: Date): UpdateReview {
  const { manifest } = managed;
  const initial = initialDraft(manifest);
  const value: UpdateDraft = { ...initial, ...(edit.fields ?? {}) };
  const added = pendingRepositories(value.repositories);
  const touched = touchedAsset(manifest, edit.fields, initial);
  const funding = fundingOf(manifest, value, touched);
  const bountyOnly = isBountyOnly(manifest);
  const monthly = manifest.reward.kind === "monthly-pool";
  const countsFrom = nextUtcMonthStart(now);
  const proposed: Proposed = { managed, value, added, funding, bountyOnly, countsFrom, now: now.toISOString() };
  const next = nextManifest(proposed);
  const changes = classifyRevisionChanges(changedFields(managed.raw, next), added.length > 0);
  return {
    value,
    added,
    choice: funding.choice,
    errors: errorsOf(value, added, funding, bountyOnly),
    next,
    changes,
    changed: changes.presentation.length + changes.executable.length + changes.financial.length > 0,
    rows: rowsOf(proposed, next),
    bountyOnly,
    monthly,
    assetFixed: funding.fixed,
    offerVault: monthly && !bountyOnly && funding.choice.mode === "monthly" && !manifest.escrow && !touched,
    stale: staleEdit(edit, managed.revision),
    countsFrom,
    nextCycle: countsFrom.slice(0, 7),
    monthlyAmount: !bountyOnly && funding.choice.mode === "monthly" && changes.financial.length > 0 ? value.monthlyAmount.trim() : null,
  };
}

/** The edit left after a publish: cleared, unless it changed while the request ran, then kept on the new revision without what was published. @throws {never} */
export function afterPublish(latest: Edit, submitted: Edit, publishedIds: ReadonlyArray<string>, revision: number): Edit {
  if (editPayload(latest) === editPayload(submitted)) return untouched;
  const published = new Set(publishedIds.map((id) => id.toLowerCase()));
  const remaining = pendingRepositories(latest.fields?.repositories ?? "").filter(({ entry }) => !published.has(entry.id.toLowerCase()));
  return { fields: { ...(latest.fields ?? {}), repositories: pendingText(remaining) }, baseRevision: revision };
}

/** @throws {never} */
export function repositoryIds(manifest: unknown): ReadonlyArray<string> {
  return listOf(recordOf(manifest).repositories).map((entry) => text(recordOf(entry).id));
}
