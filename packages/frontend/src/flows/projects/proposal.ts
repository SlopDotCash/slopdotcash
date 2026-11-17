// spec/backend/projects.md, "Creation and stored-application publication record a paused revision 1"; spec/backend/closureConsent.md, "The new form starts unchecked and an existing form reflects only its exact saved setting"
import { formatBaseUnits } from "@repo/settlement/kernels/amounts";

export const maxProjectIdLength = 43;
export const maxProjectImageLength = 16_384;
export const maxProposalFieldLength = 4_000;

const maxMonthlyCapMinor = 1_000_000_000_000_000n;
const maxBaseUnits = (1n << 128n) - 1n;
const stablecoinDecimals = 6;
const unknownTokenDecimals = 36;
const assetAmount = /^(0|[1-9]\d{0,12})(?:\.(\d{1,36}))?$/u;
const zeroAmount = /^0(?:\.0+)?$/u;
const repositoryPath = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const repositoryLink = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s?#]+)\/([^/\s?#]+?)(?:\.git)?(?:\/[^\s]*)?(?:[?#][^\s]*)?$/iu;
const repositorySsh = /^(?:ssh:\/\/)?git@github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/iu;

export const emptyProposal = Object.freeze({
  name: "",
  repository: "",
  repositoryNumericId: "",
  repositoryNodeId: "",
  integrationBranch: "main",
  sourceCommit: "",
  stewardKind: "organization",
  stewardLogin: "",
  stewardActorId: "",
  stewardNodeId: "",
  headline: "",
  image: "",
  goal: "",
  criteria: "",
  contributionGuide: "",
  supportedTasks: "",
  requiredTests: "",
  reviewExpectations: "",
  securityContact: "",
  closurePolicy: "",
  automaticClosure: "false",
  maintainerNotes: "",
  fundingMode: "none",
  monthlyPool: "",
  settlementChain: "base",
  rewardKind: "stablecoin",
  rewardAssetAddress: "",
  rewardAssetSymbol: "",
  copyrightModel: "unknown",
  legalHolder: "",
});

export type Proposal = { -readonly [Field in keyof typeof emptyProposal]: string };

export type ProposalField = keyof Proposal;

export interface PoolToken {
  readonly symbol: string;
  readonly decimals?: number;
}

export interface MonthlyPoolValue {
  readonly display: string;
  readonly minor: string;
  readonly valid: boolean;
  readonly error?: string;
}

/** @throws {never} */
export function validRepositoryPath(value: string): boolean {
  return value.length <= 201 && repositoryPath.test(value);
}

/** @throws {never} */
export function normalizeRepositoryInput(value: string): string {
  const trimmed = value.trim();
  const match = repositoryLink.exec(trimmed) ?? repositorySsh.exec(trimmed);
  return match ? normalizeRepositoryInput(`${match[1]}/${match[2]}`) : trimmed;
}

/** @throws {never} */
export function boundedText(value: string, minimum: number, maximum: number): boolean {
  const length = value.trim().length;
  return length >= minimum && length <= maximum;
}

/** @throws {never} */
export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, maxProjectIdLength)
    .replace(/-$/u, "");
  return slug === "new" ? "new-project" : slug;
}

function parsedUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function safeProposalHttpsUrl(value: string): boolean {
  if (value.length === 0 || value.length > 500) return false;
  const parsed = parsedUrl(value);
  return parsed !== undefined && parsed.protocol === "https:" && parsed.hostname.length > 0 && !parsed.username && !parsed.password && !parsed.hash;
}

/** @throws {never} */
export function immutableProposalTermsUrl(value: string, repository: string, commit: string): boolean {
  const parsed = safeProposalHttpsUrl(value) ? parsedUrl(value) : undefined;
  if (parsed === undefined) return false;
  const prefix = `/${repository}/blob/${commit}/`;
  return parsed.origin === "https://github.com" && !parsed.search && parsed.pathname.startsWith(prefix) && parsed.pathname.length > prefix.length;
}

type ParsedAmount = { readonly minor: bigint } | { readonly error: string };

function parseAssetAmount(value: string, decimals: number): ParsedAmount {
  const match = assetAmount.exec(value);
  if (!match) return { error: "amount must be a plain decimal number" };
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return { error: `amount has more decimal places than the asset's ${decimals}` };
  return { minor: BigInt(match[1] ?? "0") * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0") };
}

function grouped(whole: bigint): string {
  return whole.toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}

/** @throws {never} */
export function monthlyCapDisplay(minor: bigint): string | undefined {
  if (minor < 0n || minor > maxMonthlyCapMinor || minor % 10_000n !== 0n) return undefined;
  const cents = Number((minor % 1_000_000n) / 10_000n);
  return `$${grouped(minor / 1_000_000n)}${cents === 0 ? "" : `.${String(cents).padStart(2, "0")}`}`;
}

function invalid(value: string, token: PoolToken | undefined, error: string): MonthlyPoolValue {
  const message = value.trim() === "" || zeroAmount.test(value)
    ? "Enter a positive amount."
    : token ? error : "Use up to 2 decimals, at most 1 billion.";
  return { display: token ? `0 ${token.symbol}` : "$0", minor: "0", valid: false, error: message };
}

/** @throws {never} */
export function monthlyPoolValue(value: string, token?: PoolToken): MonthlyPoolValue {
  const parsed = parseAssetAmount(value, token?.decimals ?? (token ? unknownTokenDecimals : stablecoinDecimals));
  if ("error" in parsed) return invalid(value, token, parsed.error);
  if (parsed.minor === 0n) return invalid(value, token, "Enter a positive amount.");
  if (token === undefined) {
    const display = monthlyCapDisplay(parsed.minor);
    return display === undefined ? invalid(value, token, "") : { display, minor: parsed.minor.toString(), valid: true };
  }
  if (token.decimals === undefined) return { display: `${value} ${token.symbol}`, minor: "0", valid: true };
  if (parsed.minor > maxBaseUnits) return invalid(value, token, "monthly amount is too large");
  return { display: `${formatBaseUnits({ value: parsed.minor, decimals: token.decimals })} ${token.symbol}`, minor: parsed.minor.toString(), valid: true };
}

const projectImage = /^data:image\/(?:webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/u;

function decodedImage(value: string): string | undefined {
  try {
    return atob(value.slice(value.indexOf(",") + 1));
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function projectImageProblem(value: string): string | undefined {
  if (value.length > maxProjectImageLength || !projectImage.test(value)) return "Project image must be a small WebP or JPEG image.";
  const bytes = decodedImage(value);
  if (bytes === undefined) return "Project image encoding is invalid.";
  const matches = value.startsWith("data:image/webp;")
    ? bytes.slice(0, 4) === "RIFF" && bytes.slice(8, 12) === "WEBP"
    : bytes.startsWith("\xff\xd8\xff") && bytes.endsWith("\xff\xd9");
  return matches ? undefined : "Project image bytes must match its WebP or JPEG type.";
}

/** @throws {never} */
export function proposalOf(stored: unknown): Proposal | null {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return null;
  const record = stored as Readonly<Record<string, unknown>>;
  const draft: Proposal = { ...emptyProposal };
  for (const field of Object.keys(emptyProposal) as ProposalField[]) {
    const entry = record[field];
    if (typeof entry === "string" && entry.length <= (field === "image" ? maxProjectImageLength : maxProposalFieldLength)) draft[field] = entry;
  }
  return draft;
}
