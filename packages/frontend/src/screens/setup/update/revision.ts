// spec/backend/projects.md, "Owner revisions publish at once against the expected revision"; spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"; spec/backend/projects.md, "An honor-system promise is the owner's opt-in on a positive monthly pool and changes no amount or payment"; spec/backend/projects.md, "Automatic-closure consent changes only by an owner revision or an administrator exception"; spec/frontend/readyLabelForm.md, "The control starts off with the defaults when nothing is saved, saves only bounded settings while on, and keeps the owner's numbers when turned off"; spec/backend/readyLabelSettings.md, "Ready-label settings are bounded, off when absent or disabled, and only add protected paths"; spec/backend/projects.md, "Appending a repository pauses the project and its work counts from next month"; spec/backend/closureConsent.md, "A saved edit records an explicit No only after an explicit Yes"; spec/frontend/projectDrafts.md, "Each saved setup draft has a strictly greater revision than the record it replaces"; spec/backend/intakeCap.md, "A recent count at or above the cap of an active project pauses it"; spec/backend/projects.md, "The maintainer share is an owner setting whose history only the server writes"; spec/backend/projects.md, "A current repository administrator moves the integration branch with a committed declaration"; spec/backend/submissionFeeSettings.md, "Submission fee settings are exact, bounded and off unless enabled with a valid amount"
import { classified, type RevisionChanges } from "@repo/backend/revisionChanges";
import { formatBaseUnits } from "@repo/settlement/kernels/amounts";
import { isChain } from "@repo/settlement/kernels/networks";
import { Result, Schema } from "effect";
import { reportDepositOn } from "@repo/security/client";
import { checkedOnLoad, consents, type SavedConsent, savedEdit } from "../../../../gen/backend__closureConsent.ts";
import { maxCap, minCap } from "../../../../gen/backend__intakeCap.ts";
import { wantedLabelName } from "../../../../gen/backend__mergeActivity.ts";
import { branchChangeAllowed, branchConflictText, changeEffect, entryNumber, entryOrPublished, honorSystemKept, intakeCapEntryValid, type SettingEffect, type SettingEntry, type SettingField, shareEntryValid } from "../../../../gen/frontend__presentation.ts";
import { maxShareBasisPoints } from "../../../../gen/settlement__maintainerShare.ts";
import { defaultMinor, maxMinor, minMinor, type RepositoryLookup, stableDecimals, submissionFeeSettingOf } from "@repo/backend/client";
import type { IntegrationBranchChoice, StoredRepository } from "../../../flows/projects/github.vibe";
import { boundedText, type FundingChoice, type MonthlyPoolValue, monthlyCapDisplay, monthlyPoolValue, type RewardAssetKind, rewardFields, validRepositoryPath } from "../../../flows/projects/proposal.ts";
import { type AssetKind, assetSymbol, formatRewardCapDisplay } from "../../../kernels/assetText.ts";
import { contributionLabels, type SkillRuleField, skillRuleFields } from "../fields/contribution.ts";
import { type LinkInput, normalizeWebsiteInput, normalizeXInput, withOwnerLinks, xInputValue } from "../../../kernels/projectLinks.ts";
import { rewardNetwork, tokenProblem } from "../fields/rewardAsset.ts";
import { type ManagedAsset, ManagedManifest, PendingRepository } from "./manifest.schema.ts";
import { initialReadyDraft, nextReadyLabel, type ReadyField, readyErrors, readyFields, readySummary, savedReadySettings } from "./readyLabel.ts";

export type Json = Readonly<Record<string, unknown>>;

export type UpdateField = "image" | "automaticClosure" | ReadyField | "submissionFee" | "submissionFeeAmount" | "standingDeposits" | "wantedIssues" | "reportDeposit" | "intakeCap" | "catchingUp" | "headline" | "goal" | "website" | "x" | "criteria" | SkillRuleField | "fundingMode" | "network" | "assetKind" | "tokenAddress" | "tokenSymbol" | "monthlyAmount" | "honorSystem" | "maintainerShare" | "repositories";

export type UpdateDraft = Readonly<Record<UpdateField, string>>;

export const updateFields: ReadonlyArray<UpdateField> = ["image", "automaticClosure", ...readyFields, "submissionFee", "submissionFeeAmount", "standingDeposits", "wantedIssues", "reportDeposit", "intakeCap", "catchingUp", "headline", "goal", "website", "x", "criteria", ...skillRuleFields, "fundingMode", "network", "assetKind", "tokenAddress", "tokenSymbol", "monthlyAmount", "honorSystem", "maintainerShare", "repositories"];

export interface Edit {
  readonly fields: Partial<UpdateDraft> | null;
  readonly baseRevision: number | null;
}

export interface Managed {
  readonly revision: number;
  readonly raw: Json;
  readonly manifest: ManagedManifest;
}

export type ChangeField = "vault" | "slopbot" | "readyLabel" | "intakeCap" | "catchUp" | "submissionFee" | "standingDeposits" | "wantedIssues" | "reportDeposit" | "image" | "integrationBranch" | "repositories" | "headline" | "description" | "website" | "x" | "approvedScope" | SkillRuleField | "monthly" | "honorSystem" | "maintainerShare";

export interface BranchRequest {
  readonly integrationBranch: IntegrationBranchChoice;
  readonly contribution?: unknown;
}

export interface ChangeRow {
  readonly field: ChangeField;
  readonly label: string;
  readonly current: string;
  readonly proposed: string;
}

export type FormGroup = "listing" | "rules" | "moreRules" | "repositories" | "rewards";

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
  readonly primary: StoredRepository | undefined;
  readonly branchRequest: BranchRequest | undefined;
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
const feeAmountPattern = /^(\d{1,4})(?:\.(\d{1,2}))?$/u;
const capDigits = /^\d{1,6}$/u;
const shareDigits = /^\d{1,2}$/u;
const stableUnit = 10n ** BigInt(stableDecimals);

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
  const promise = field === "fundingMode" && value !== "monthly" ? { honorSystem: "false" } : {};
  return { fields: { ...(edit.fields ?? {}), [field]: value, ...promise }, baseRevision: edit.fields === null ? revision : edit.baseRevision };
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
  if (facts.fork) return `${facts.repository} is a fork. Add the original repository instead.`;
  if (facts.archived) return `${facts.repository} is archived on GitHub.`;
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

function priorConsent(slopbot: unknown): SavedConsent {
  const saved = recordOf(slopbot).automaticClosure;
  return saved === undefined ? "Absent" : saved === true ? "Enabled" : "Disabled";
}

function assetKindOf(kind: string | undefined): RewardAssetKind {
  return kind === "token" ? "token" : kind === "native" ? "native" : "stablecoin";
}

function feeRecord(slopbot: unknown): Json | undefined {
  const fee = recordOf(slopbot).submissionFee;
  return isJson(fee) ? fee : undefined;
}

function feeText(minor: string): string {
  return baseUnits(minor, stableDecimals, false) ?? "";
}

type FeeAmount = { readonly kind: "amount"; readonly minor: string } | { readonly kind: "invalid"; readonly error: string };

/** The owner's typed fee as base units: at most two decimal places inside the allowed range; empty is the platform default. @throws {never} */
export function feeAmountOf(text: string): FeeAmount {
  const typed = text.trim().replace(/^\$/u, "").trim();
  if (typed === "") return { kind: "amount", minor: String(defaultMinor) };
  const match = feeAmountPattern.exec(typed);
  const minor = match === null ? undefined : BigInt(match[1] ?? "0") * stableUnit + BigInt((match[2] ?? "").padEnd(stableDecimals, "0"));
  return minor !== undefined && minor >= BigInt(minMinor) && minor <= BigInt(maxMinor)
    ? { kind: "amount", minor: minor.toString() }
    : { kind: "invalid", error: `Enter an amount from ${feeText(String(minMinor))} to ${feeText(String(maxMinor))}, with at most two decimal places.` };
}

function entryOf(typed: string, digits: RegExp): SettingEntry {
  if (typed === "") return { tag: "EntryEmpty" };
  return digits.test(typed) ? { tag: "EntryWhole", whole: Number(typed) } : { tag: "EntryInvalid" };
}

interface Entries {
  readonly cap: number;
  readonly capError: string | undefined;
  readonly share: number;
  readonly shareError: string | undefined;
  readonly fee: Json | undefined;
  readonly feeError: string | undefined;
}

const catchUpMaxDays = 14;
const isoInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function isIsoInstant(value: unknown): value is string {
  return typeof value === "string" && isoInstant.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

/** @throws {never} */
export function catchUpEnd(manifest: Pick<ManagedManifest, "slopbot">, now: Date): string | null {
  const until = manifest.slopbot?.catchUpUntil;
  return isIsoInstant(until) && Date.parse(until) > now.getTime() ? until : null;
}

/** @throws {never} */
export function catchUpOfferedEnd(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + catchUpMaxDays)).toISOString();
}

/** @throws {never} */
export function catchUpStartAllowed(manifest: Pick<ManagedManifest, "slopbot">, now: Date): boolean {
  const month = now.toISOString().slice(0, 7);
  return !(manifest.slopbot?.catchUpHistory ?? []).some((entry) => entry.startedAt.slice(0, 7) === month);
}

function standingDepositsAccepted(slopbot: unknown): boolean {
  return feeRecord(slopbot)?.standingDeposits !== false;
}

function nextFee(current: Json | undefined, on: boolean, amount: FeeAmount, standingAccepted: boolean): Json | undefined {
  let feeChoice: Json | undefined;
  if (!on) {
    feeChoice = current?.enabled === true ? { ...current, enabled: false } : current;
  } else if (amount.kind === "invalid") {
    feeChoice = current;
  } else {
    const published = current?.enabled === true ? (typeof current.amountMinor === "string" ? current.amountMinor : String(defaultMinor)) : undefined;
    feeChoice = published === amount.minor ? current : { enabled: true, amountMinor: amount.minor };
  }
  if (feeChoice === undefined && standingAccepted) return undefined;
  const { standingDeposits: _refused, ...fee } = feeChoice ?? { enabled: false };
  return standingAccepted ? fee : { ...fee, standingDeposits: false };
}

function entriesOf(manifest: ManagedManifest, value: UpdateDraft): Entries {
  const cap = entryOf(value.intakeCap.trim(), capDigits);
  const capValid = intakeCapEntryValid(cap);
  const share = entryOf(value.maintainerShare.trim().replace(/%$/u, "").trim(), shareDigits);
  const shareValid = shareEntryValid(share);
  const amount = feeAmountOf(value.submissionFeeAmount);
  const feeOn = value.submissionFee === "true";
  const standingAccepted = value.standingDeposits !== "false";
  return {
    cap: entryOrPublished(capValid, entryNumber(cap), manifest.slopbot?.intakeCap ?? 0),
    capError: capValid ? undefined : `Enter a whole number from ${minCap} to ${maxCap}, or leave it empty.`,
    share: entryOrPublished(shareValid, entryNumber(share) * 100, manifest.reward.maintainerShare ?? 0),
    shareError: shareValid ? undefined : `Enter a whole number from 0 to ${maxShareBasisPoints / 100}, or leave it empty.`,
    fee: nextFee(feeRecord(manifest.slopbot), feeOn, amount, standingAccepted),
    feeError: feeOn && amount.kind === "invalid" ? amount.error : undefined,
  };
}

function urlPath(url: string): string {
  return URL.canParse(url) ? new URL(url).pathname.replace(/^\/|\/$/gu, "") : "";
}

/** The primary repository as stored: its path, GitHub ids and integration branch. @throws {never} */
export function primaryRepository(manifest: ManagedManifest): StoredRepository | undefined {
  const entry = manifest.repositories[0];
  const authority = manifest.authority;
  const path = urlPath(entry?.githubUrl ?? "");
  if (entry?.integrationBranch === undefined || authority === undefined || !validRepositoryPath(path)) return undefined;
  return { path, numericId: authority.repositoryId, nodeId: authority.repositoryNodeId, integrationBranch: entry.integrationBranch };
}

/** The form as the current revision fills it; closure consent is checked only by an exact saved yes. @throws {never} */
export function initialDraft(manifest: ManagedManifest, now: Date = new Date()): UpdateDraft {
  const capMinor = manifest.reward.kind === "monthly-pool" ? (manifest.reward.monthlyCapMinor ?? "0") : "0";
  const asset = manifest.rewardAsset;
  const rules = Object.fromEntries(skillRuleFields.map((field) => [field, manifest.contribution?.[field] ?? ""])) as Record<SkillRuleField, string>;
  const fee = feeRecord(manifest.slopbot);
  return {
    ...rules,
    image: manifest.image ?? "",
    automaticClosure: String(checkedOnLoad(priorConsent(manifest.slopbot))),
    ...initialReadyDraft(savedReadySettings(manifest)),
    submissionFee: String(fee?.enabled === true),
    submissionFeeAmount: feeText(typeof fee?.amountMinor === "string" ? fee.amountMinor : String(defaultMinor)),
    standingDeposits: String(fee?.standingDeposits !== false),
    wantedIssues: String(manifest.slopbot?.wantedIssues === true),
    reportDeposit: String(reportDepositOn(manifest)),
    intakeCap: manifest.slopbot?.intakeCap === undefined ? "" : String(manifest.slopbot.intakeCap),
    catchingUp: String(catchUpEnd(manifest, now) !== null),
    headline: manifest.headline,
    goal: manifest.description,
    website: manifest.links.website ?? "",
    x: xInputValue(manifest.links.x),
    criteria: manifest.contribution?.approvedScope ?? "",
    fundingMode: capMinor === "0" ? "none" : "monthly",
    network: asset?.network ?? manifest.reward.chain ?? "base",
    assetKind: asset?.kind ?? "stablecoin",
    tokenAddress: asset?.kind === "token" ? asset.address : "",
    tokenSymbol: asset?.kind === "token" ? asset.symbol : "",
    monthlyAmount: capMinor === "0" ? "" : (baseUnits(capMinor, asset?.decimals ?? 6, false) ?? ""),
    honorSystem: String(manifest.reward.honorSystem === true),
    maintainerShare: manifest.reward.maintainerShare === undefined ? "" : String(manifest.reward.maintainerShare / 100),
    repositories: "",
  };
}

function lengthError(value: string, minimum: number, maximum: number): string | undefined {
  return boundedText(value, minimum, maximum) ? undefined : `Enter ${minimum} to ${maximum} characters.`;
}

function linkError(input: LinkInput): string | undefined {
  return input.ok ? undefined : input.error;
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

function errorsOf(value: UpdateDraft, added: ReadonlyArray<PendingRepository>, funding: Funding, bountyOnly: boolean, monthly: boolean, entries: Entries): Readonly<Record<string, string>> {
  const { choice, amount, fixed } = funding;
  const token = !bountyOnly && choice.mode === "monthly" && !fixed && choice.assetKind === "token" ? tokenProblem({ network: choice.network, assetKind: "token", tokenAddress: choice.tokenAddress, tokenSymbol: choice.tokenSymbol }) : undefined;
  const found: ReadonlyArray<readonly [string, string | undefined]> = [
    ...Object.entries(readyErrors(value)),
    ["intakeCap", entries.capError],
    ["submissionFeeAmount", entries.feeError],
    ["headline", lengthError(value.headline, 8, 120)],
    ["goal", lengthError(value.goal, 24, 600)],
    ["website", linkError(normalizeWebsiteInput(value.website))],
    ["x", linkError(normalizeXInput(value.x))],
    ["criteria", lengthError(value.criteria, 6, 2_000)],
    ...skillRuleFields.map((field) => [field, value[field].trim() === "" ? undefined : lengthError(value[field], 1, 2_000)] as const),
    ["monthlyAmount", !bountyOnly && choice.mode === "monthly" && !amount.valid ? amount.error : undefined],
    ...(token ? [[token.field, token.message] as const] : []),
    ["maintainerShare", !bountyOnly && monthly && choice.mode === "monthly" ? entries.shareError : undefined],
    ...added.map((entry, index) => [`addedRepository${index}`, lengthError(entry.entry.description, 12, 500)] as const),
  ];
  return Object.fromEntries(found.filter((entry): entry is readonly [string, string] => entry[1] !== undefined));
}

/** @throws {never} */
export function groupOf(field: string): FormGroup {
  if (field === "headline" || field === "goal" || field === "website" || field === "x") return "listing";
  if (field.startsWith("addedRepository") || field === "integrationBranch") return "repositories";
  if (field === "monthlyAmount" || field === "tokenAddress" || field === "tokenSymbol" || field === "maintainerShare") return "rewards";
  return skillRuleFields.some((rule) => rule === field) ? "moreRules" : "rules";
}

interface Proposed {
  readonly managed: Managed;
  readonly value: UpdateDraft;
  readonly added: ReadonlyArray<PendingRepository>;
  readonly funding: Funding;
  readonly bountyOnly: boolean;
  readonly countsFrom: string;
  readonly now: string;
  readonly entries: Entries;
  readonly branch: IntegrationBranchChoice | undefined;
  readonly primary: StoredRepository | undefined;
}

function fundingFields({ managed: { raw, manifest }, value, funding: { choice, amount, fixed, touched }, bountyOnly, now, entries }: Proposed): Json {
  if (bountyOnly || manifest.reward.kind !== "monthly-pool") return {};
  const monthlyCapMinor = choice.mode === "monthly" && amount.valid ? amount.minor : "0";
  const cap = { monthlyCapMinor, monthlyCapDisplay: capDisplay(monthlyCapMinor, manifest.rewardAsset) };
  const { honorSystem: _honorSystem, maintainerShare: _maintainerShare, ...reward } = recordOf(raw.reward);
  const promise = {
    ...(honorSystemKept(choice.mode === "monthly", value.honorSystem === "true") ? { honorSystem: true } : {}),
    ...(choice.mode === "monthly" && entries.share > 0 ? { maintainerShare: entries.share } : {}),
  };
  if (fixed || choice.mode === "none" || !touched) return { reward: { ...reward, ...cap, ...promise } };
  const fields = rewardFields(choice, now);
  return { ...fields, reward: { ...reward, ...fields.reward, rewardStartAt: reward.rewardStartAt, ...promise } };
}

function slopbotOf(raw: Json, manifest: ManagedManifest, value: UpdateDraft, entries: Entries, now: Date): Json {
  const saved = savedEdit(priorConsent(raw.slopbot), value.automaticClosure === "true");
  const readyLabel = nextReadyLabel(value, savedReadySettings(manifest));
  const runningCatchUp = catchUpEnd(manifest, now);
  const nextCatchUpUntil =
    value.catchingUp === "true"
      ? (runningCatchUp ?? (catchUpStartAllowed(manifest, now) ? catchUpOfferedEnd(now) : manifest.slopbot?.catchUpUntil))
      : runningCatchUp === null
        ? manifest.slopbot?.catchUpUntil
        : undefined;
  const rawSlopbot = recordOf(raw.slopbot);
  const slopbot = {
    ...(saved === "Absent" ? {} : { automaticClosure: consents(saved) }),
    ...(readyLabel ? { readyLabel } : {}),
    ...(entries.cap > 0 ? { intakeCap: entries.cap } : {}),
    ...(nextCatchUpUntil !== undefined ? { catchUpUntil: nextCatchUpUntil } : {}),
    ...(rawSlopbot.catchUpHistory !== undefined ? { catchUpHistory: rawSlopbot.catchUpHistory } : {}),
    ...(entries.fee ? { submissionFee: entries.fee } : {}),
    ...(value.wantedIssues === "true" ? { wantedIssues: true } : {}),
  };
  return { slopbot: Object.keys(slopbot).length === 0 ? undefined : slopbot };
}

function securityOf(raw: Json, value: UpdateDraft): Json {
  const on = value.reportDeposit === "true";
  return on === reportDepositOn(raw) ? {} : { security: { ...recordOf(raw.security), reportDeposit: on } };
}

function ownerLink(input: LinkInput, published: string | undefined): string | null {
  return input.ok ? input.value : (published ?? null);
}

function nextManifest(proposed: Proposed): Json {
  const { managed: { raw, manifest }, value, added, countsFrom, entries, now } = proposed;
  return {
    ...raw,
    ...fundingFields(proposed),
    ...(added.length > 0 ? { repositories: [...listOf(raw.repositories), ...added.map(({ entry }) => ({ ...entry, description: entry.description.trim(), countsFrom }))] } : {}),
    ...slopbotOf(raw, manifest, value, entries, new Date(now)),
    ...securityOf(raw, value),
    image: value.image || undefined,
    headline: value.headline.trim(),
    description: value.goal.trim(),
    links: withOwnerLinks(manifest.links, ownerLink(normalizeWebsiteInput(value.website), manifest.links.website), ownerLink(normalizeXInput(value.x), manifest.links.x)),
    contribution: { ...recordOf(raw.contribution), approvedScope: value.criteria.trim(), ...Object.fromEntries(skillRuleFields.map((field) => [field, value[field].trim()])) },
  };
}

const settingFields: Readonly<Partial<Record<ChangeField, SettingField>>> = {
  vault: "VaultField",
  monthly: "MonthlyField",
  maintainerShare: "MaintainerShareField",
  slopbot: "SlopbotField",
  readyLabel: "SlopbotField",
  intakeCap: "SlopbotField",
  catchUp: "SlopbotField",
  submissionFee: "SlopbotField",
  standingDeposits: "SlopbotField",
  wantedIssues: "SlopbotField",
  reportDeposit: "ReportDepositField",
  image: "ImageField",
  headline: "HeadlineField",
  description: "DescriptionField",
  website: "HeadlineField",
  x: "HeadlineField",
  integrationBranch: "IntegrationBranchField",
  contributionGuide: "ContributionGuideField",
};

/** What publishing one changed field does, by the generated rule. @throws {never} */
export function effectOf(field: ChangeField, executableCleared: boolean): SettingEffect {
  return changeEffect(settingFields[field] ?? "OtherField", executableCleared);
}

function shareLabel(points: unknown): string {
  return typeof points === "number" && Number.isInteger(points) && points >= 1 && points <= maxShareBasisPoints ? `${points / 100}%` : "None";
}

function capSummary(slopbot: unknown): string {
  const cap = recordOf(slopbot).intakeCap;
  return typeof cap === "number" ? `At ${cap} open outside pull request${cap === 1 ? "" : "s"}` : "Off";
}

function catchUpSummary(slopbot: unknown, nowMs: number): string {
  const until = recordOf(slopbot).catchUpUntil;
  if (!isIsoInstant(until) || Date.parse(until) <= nowMs) return "Off";
  return `Until ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(until))}`;
}

function feeSummary(slopbot: unknown): string {
  const fee = submissionFeeSettingOf(recordOf(slopbot).submissionFee);
  return fee === null ? "Off" : `On: ${feeText(fee.amountMinor)} USDC or USDG`;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function rowsOf({ managed: { raw, manifest }, funding: { choice, amount }, bountyOnly, branch, primary, now }: Proposed, next: Json): ReadonlyArray<ChangeRow> {
  const nowMs = Date.parse(now);
  const contribution = recordOf(raw.contribution);
  const proposedContribution = recordOf(next.contribution);
  const proposedLinks = recordOf(next.links);
  const enabled = (vault: unknown) => (vault ? "Enabled" : "Not enabled");
  const promised = (reward: unknown) => (recordOf(reward).honorSystem === true ? "On" : "Off");
  const allowed = (slopbot: unknown) => (recordOf(slopbot).automaticClosure === true ? "Allowed" : "Not allowed");
  const wanted = (slopbot: unknown) => (recordOf(slopbot).wantedIssues === true ? `On: ${wantedLabelName}` : "Off");
  const standing = (slopbot: unknown) => (standingDepositsAccepted(slopbot) ? "Accepted" : "Refused");
  const deposit = (project: unknown) => (reportDepositOn(project) ? "On" : "Off");
  const integrationBranch = primary?.integrationBranch ?? "";
  const names = (list: unknown) => listOf(list).map((entry) => text(recordOf(entry).id)).join(", ");
  const currency = text(recordOf(next.reward).currency);
  const decimals = manifest.rewardAsset?.decimals ?? 6;
  const monthlyRows: ReadonlyArray<ChangeRow> =
    !bountyOnly && manifest.reward.kind === "monthly-pool" && recordOf(next.reward).kind === "monthly-pool"
      ? [
          {
            field: "monthly",
            label: "Monthly funding",
            current: fundingText(manifest.reward.monthlyCapMinor ?? "0", decimals, manifest.reward.currency ?? "", assetKindOf(manifest.rewardAsset?.kind)),
            proposed:
              choice.mode === "monthly" && amount.valid
                ? choice.assetKind === "stablecoin"
                  ? fundingText(amount.minor, 6, currency, "stablecoin")
                  : formatRewardCapDisplay(amount.display, { kind: choice.assetKind, symbol: currency })
                : "None",
          },
          { field: "honorSystem", label: "Honor-system promise", current: promised(raw.reward), proposed: promised(next.reward) },
          { field: "maintainerShare", label: "Maintainer share", current: shareLabel(recordOf(raw.reward).maintainerShare), proposed: shareLabel(recordOf(next.reward).maintainerShare) },
        ]
      : [];
  const rows: ReadonlyArray<ChangeRow> = [
    { field: "vault", label: "Vault setup", current: enabled(raw.escrow), proposed: enabled(next.escrow) },
    { field: "slopbot", label: "Auto-close", current: allowed(raw.slopbot), proposed: allowed(next.slopbot) },
    { field: "readyLabel", label: "Slopbot ready label", current: readySummary(raw), proposed: readySummary(next) },
    { field: "intakeCap", label: "Pause new contributors", current: capSummary(raw.slopbot), proposed: capSummary(next.slopbot) },
    { field: "catchUp", label: "Catching up on reviews", current: catchUpSummary(raw.slopbot, nowMs), proposed: catchUpSummary(next.slopbot, nowMs) },
    { field: "submissionFee", label: "Submission fee", current: feeSummary(raw.slopbot), proposed: feeSummary(next.slopbot) },
    { field: "standingDeposits", label: "Standing deposits", current: standing(raw.slopbot), proposed: standing(next.slopbot) },
    { field: "wantedIssues", label: "Wanted issues", current: wanted(raw.slopbot), proposed: wanted(next.slopbot) },
    { field: "reportDeposit", label: "Report deposit", current: deposit(raw), proposed: deposit(next) },
    { field: "image", label: "Project image", current: text(raw.image), proposed: text(next.image) },
    { field: "integrationBranch", label: "Integration branch", current: integrationBranch, proposed: branch?.name ?? integrationBranch },
    { field: "repositories", label: "Repositories", current: names(raw.repositories), proposed: names(next.repositories) },
    { field: "headline", label: "Short description", current: text(raw.headline), proposed: text(next.headline) },
    { field: "description", label: "Goal", current: text(raw.description), proposed: text(next.description) },
    { field: "website", label: "Website", current: manifest.links.website ?? "None", proposed: text(proposedLinks.website) || "None" },
    { field: "x", label: "X account", current: manifest.links.x ?? "None", proposed: text(proposedLinks.x) || "None" },
    { field: "approvedScope", label: "Acceptance criteria", current: text(contribution.approvedScope), proposed: text(proposedContribution.approvedScope) },
    ...skillRuleFields.map((field) => ({ field, label: contributionLabels[field].label, current: text(contribution[field]), proposed: text(proposedContribution[field]) })),
    ...monthlyRows,
  ];
  return rows.filter((row) => row.current !== row.proposed).map((row) => (row.field === "image" ? row : { ...row, current: row.current || "Not set", proposed: row.proposed || "Not set" }));
}

function touchedAsset(manifest: ManagedManifest, fields: Partial<UpdateDraft> | null, initial: UpdateDraft): boolean {
  if (fields === null) return false;
  return (!manifest.escrow && fields.fundingMode === "monthly") || assetFields.some((field) => fields[field] !== undefined && fields[field] !== initial[field]);
}

/** Everything the update form shows and publishes, from the current revision, the saved edit and the clock. @throws {never} */
export function reviewOf(managed: Managed, edit: Edit, now: Date, branch?: IntegrationBranchChoice): UpdateReview {
  const { manifest } = managed;
  const initial = initialDraft(manifest, now);
  const value: UpdateDraft = { ...initial, ...(edit.fields ?? {}) };
  const added = pendingRepositories(value.repositories);
  const touched = touchedAsset(manifest, edit.fields, initial);
  const funding = fundingOf(manifest, value, touched);
  const bountyOnly = isBountyOnly(manifest);
  const monthly = manifest.reward.kind === "monthly-pool";
  const countsFrom = nextUtcMonthStart(now);
  const entries = entriesOf(manifest, value);
  const primary = primaryRepository(manifest);
  const proposed: Proposed = { managed, value, added, funding, bountyOnly, countsFrom, now: now.toISOString(), entries, branch, primary };
  const next = nextManifest(proposed);
  const changes = classified(managed.raw, next);
  const others: SettingField[] = [
    ...changes.presentation.map((): SettingField => "OtherField"),
    ...changes.financial.map((): SettingField => "MonthlyField"),
    ...changes.executable.map((field): SettingField => (field === "contribution" ? "ContributionGuideField" : "OtherField")),
  ];
  const branchError = branch !== undefined && !branchChangeAllowed(true, others) ? branchConflictText : undefined;
  return {
    value,
    added,
    choice: funding.choice,
    errors: { ...errorsOf(value, added, funding, bountyOnly, monthly, entries), ...(branchError === undefined ? {} : { integrationBranch: branchError }) },
    next,
    changes,
    changed: branch !== undefined || changes.presentation.length + changes.executable.length + changes.financial.length > 0,
    rows: rowsOf(proposed, next),
    bountyOnly,
    monthly,
    assetFixed: funding.fixed,
    offerVault: monthly && !bountyOnly && funding.choice.mode === "monthly" && !manifest.escrow && !touched,
    stale: staleEdit(edit, managed.revision),
    countsFrom,
    nextCycle: countsFrom.slice(0, 7),
    monthlyAmount: !bountyOnly && funding.choice.mode === "monthly" && changes.financial.length > 0 ? value.monthlyAmount.trim() : null,
    primary,
    branchRequest: branch === undefined ? undefined : { integrationBranch: branch, ...(changes.executable.includes("contribution") ? { contribution: next.contribution } : {}) },
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
