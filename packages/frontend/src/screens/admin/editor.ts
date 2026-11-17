// spec/backend/projects.md, "Administrators hold, delist, change the steward or place a project"; spec/backend/listing.md, "Funding never decides placement and placement never establishes funding"; spec/frontend/projectDrafts.md, "An administrator's manifest draft is cleared only after its exact submitted text was accepted or on discard"
import { type ContributionField, contributionFields, templatePaths } from "@repo/contributor/render/fields";
import type { Chain } from "@repo/settlement/kernels/networks";
import { Result, Schema } from "effect";
import type { RewardAssetKind } from "../../flows/projects/proposal.ts";
import { rewardAssetChoice } from "../../flows/security/bountyAsset.ts";
import { contributionLabels } from "../setup/fields/contribution.ts";
import { rewardNetwork } from "../setup/fields/rewardAsset.ts";
import { type AdminProject, chainOf, isRecord, type JsonRecord } from "./projects.ts";

export interface AssetDraft {
  readonly network: Chain;
  readonly kind: RewardAssetKind;
  readonly address: string;
  readonly symbol: string;
}

export type SkillDraft = Readonly<Record<ContributionField, string>>;

export interface ManifestDraft {
  readonly text: string;
  readonly skill: SkillDraft;
  readonly asset: AssetDraft;
  readonly assetSelected: boolean;
  readonly status: string;
  readonly reason: string;
}

export type Built = { readonly kind: "manifest"; readonly manifest: JsonRecord } | { readonly kind: "invalid"; readonly message: string };

export type DetailField = "name" | "headline" | "description";

export const detailFields: ReadonlyArray<readonly [DetailField, string, number]> = [
  ["name", "Project name", 80],
  ["headline", "Short description", 120],
  ["description", "Goal", 600],
];

export const editorMessages = {
  notObject: "The manifest is not a valid JSON object.",
  controlledKeys: "Use the Status, Contribution fields, and Reward asset controls. Remove those keys from advanced settings.",
  skillIncomplete: "Complete the approved scope, or clear every contribution field.",
} as const;

const controlledKeys = ["status", "contribution", "rewardAsset"] as const;

const changeLabels: Readonly<Record<string, string>> = {
  name: "Project name",
  headline: "Short description",
  description: "Goal",
  listingTier: "Discovery placement",
  status: "Project status",
  reward: "Reward terms",
  rewardAsset: "Reward asset",
  escrow: "Project vault",
  funding: "Funding terms",
  securityBounty: "Security bounty",
  contribution: "Contribution rules",
  slopbot: "Slopbot consent",
  repositories: "Repositories",
  skill: "Contributor skill",
  reviewSkill: "Reviewer skill",
};

const StoredDraft = Schema.Struct({
  text: Schema.String,
  skill: Schema.Record(Schema.String, Schema.String),
  asset: Schema.Struct({ network: Schema.String, kind: Schema.Literals(["stablecoin", "token", "native"]), address: Schema.String, symbol: Schema.String }),
  assetSelected: Schema.optional(Schema.Boolean),
  status: Schema.String,
  reason: Schema.String,
});

const decodeStored = Schema.decodeUnknownResult(StoredDraft);

/** @throws {never} */
function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** @throws {never} */
function skillOf(values: Readonly<Record<string, string>> | undefined): SkillDraft {
  return Object.fromEntries(contributionFields.map((field) => [field, values?.[field] ?? ""])) as Record<ContributionField, string>;
}

/** The network's own coin of a kind, or the token as entered. @throws {never} */
export function withAsset(current: AssetDraft, change: Partial<AssetDraft>): AssetDraft {
  const next = { ...current, ...change };
  if (next.kind === "token") return change.kind === "token" && current.kind !== "token" ? { ...next, address: "", symbol: "" } : next;
  const coin = rewardNetwork(next.network)?.[next.kind];
  return coin ? { ...next, address: coin.address, symbol: coin.symbol } : next;
}

/** @throws {never} */
export function initialAsset(project: AdminProject): AssetDraft {
  const stored = project.manifest.rewardAsset;
  const storedNetwork = stored ? chainOf(stored.network) : undefined;
  if (stored && storedNetwork) return { network: storedNetwork, kind: stored.kind, address: stored.address, symbol: stored.symbol };
  const network = chainOf(project.manifest.reward.chain ?? "") ?? "base";
  return withAsset({ network, kind: "stablecoin", address: "", symbol: "" }, {});
}

/** The editor's starting draft: the saved draft of this exact revision when it reads, else the revision itself. @throws {never} */
export function initialDraft(project: AdminProject, stored: string | undefined): ManifestDraft {
  const decoded = stored === undefined ? undefined : decodeStored(parsedJson(stored));
  const saved = decoded !== undefined && Result.isSuccess(decoded) ? decoded.success : undefined;
  const savedNetwork = saved ? chainOf(saved.asset.network) : undefined;
  const { status: _status, contribution: _contribution, rewardAsset: _asset, ...rest } = project.raw;
  return {
    text: saved?.text ?? JSON.stringify(rest, null, 2),
    skill: skillOf(saved?.skill ?? project.manifest.contribution),
    asset: saved && savedNetwork ? { ...saved.asset, network: savedNetwork } : initialAsset(project),
    assetSelected: saved?.assetSelected ?? project.manifest.rewardAsset !== undefined,
    status: saved?.status ?? project.status,
    reason: saved?.reason ?? "",
  };
}

/** The stored text of a draft, in the order the editor has always saved it. @throws {never} */
export function draftText(draft: ManifestDraft): string {
  return JSON.stringify({ text: draft.text, skill: draft.skill, asset: draft.asset, assetSelected: draft.assetSelected, status: draft.status, reason: draft.reason });
}

/** The advanced settings as an object, or nothing while they are not one. @throws {never} */
export function projectFieldsOf(text: string): JsonRecord | undefined {
  const parsed = parsedJson(text);
  return isRecord(parsed) ? parsed : undefined;
}

/** @throws {never} */
export function withProjectField(fields: JsonRecord, field: string, value: unknown): string {
  return JSON.stringify({ ...fields, [field]: value }, null, 2);
}

/** @throws {never} */
export function skillStarted(skill: SkillDraft): boolean {
  return contributionFields.some((field) => skill[field].trim() !== "");
}

/** Each contribution field's error once any of them is filled: the approved scope needs 6 to 2000 characters, the others at most 2000. @throws {never} */
export function skillErrors(skill: SkillDraft): Readonly<Record<ContributionField, string | null>> {
  const started = skillStarted(skill);
  return Object.fromEntries(
    contributionFields.map((field) => {
      const length = skill[field].trim().length;
      const minimum = field === "approvedScope" ? 6 : 0;
      const label = contributionLabels[field].label;
      return [field, started && (length < minimum || length > 2000) ? (minimum ? `${label} must be ${minimum} to 2000 characters.` : `${label} must be at most 2000 characters.`) : null];
    }),
  ) as Record<ContributionField, string | null>;
}

/** The next manifest: the advanced settings with the status, contribution fields and generated skill templates, and the chosen reward asset of a monthly pool. @throws {never} */
export function builtManifest(project: AdminProject, draft: ManifestDraft): Built {
  const fields = projectFieldsOf(draft.text);
  if (fields === undefined) return { kind: "invalid", message: editorMessages.notObject };
  if (controlledKeys.some((key) => Object.hasOwn(fields, key))) return { kind: "invalid", message: editorMessages.controlledKeys };
  if (Object.values(skillErrors(draft.skill)).some((error) => error !== null)) return { kind: "invalid", message: editorMessages.skillIncomplete };
  const choice = rewardAssetChoice({ network: draft.asset.network, assetKind: draft.asset.kind, tokenAddress: draft.asset.address, tokenSymbol: draft.asset.symbol });
  if (choice.kind === "invalid") return { kind: "invalid", message: choice.message };
  const { contribution: _contribution, rewardAsset: _asset, ...rest } = fields;
  const stored = project.manifest.rewardAsset;
  const asset = choice.asset;
  const unchanged = stored !== undefined && stored.network === asset.network && stored.kind === asset.kind && stored.address === asset.address && stored.symbol === asset.symbol;
  const skill = isRecord(rest.skill) ? rest.skill : {};
  const reviewSkill = isRecord(rest.reviewSkill) ? rest.reviewSkill : {};
  const reward = isRecord(rest.reward) ? rest.reward : undefined;
  return {
    kind: "manifest",
    manifest: {
      ...rest,
      status: draft.status,
      ...(skillStarted(draft.skill)
        ? {
            contribution: Object.fromEntries(contributionFields.map((field) => [field, draft.skill[field].replaceAll("\r\n", "\n").trim()])),
            skill: { ...skill, sourcePath: templatePaths.contributor },
            reviewSkill: { ...reviewSkill, sourcePath: templatePaths.reviewer },
          }
        : {}),
      ...(reward?.kind === "monthly-pool" && draft.assetSelected
        ? {
            reward: { ...reward, chain: asset.network, currency: asset.symbol },
            ...(isRecord(rest.escrow) ? { escrow: { ...rest.escrow, chain: asset.network } } : {}),
            rewardAsset: unchanged ? project.raw.rewardAsset : asset,
          }
        : {}),
    },
  };
}

/** The top-level fields whose value the next manifest changes. @throws {never} */
export function changedFields(current: JsonRecord, next: JsonRecord): ReadonlyArray<string> {
  return [...new Set([...Object.keys(current), ...Object.keys(next)])].filter((key) => JSON.stringify(current[key]) !== JSON.stringify(next[key]));
}

/** @throws {never} */
export function changeLabel(field: string): string {
  return changeLabels[field] ?? field.replace(/([a-z])([A-Z])/gu, "$1 $2");
}
