// spec/backend/projects.md, "Creation and stored-application publication record a paused revision 1"; spec/backend/projects.md, "Owner revisions publish at once against the expected revision"; spec/backend/projects.md, "Appending a repository pauses the project and its work counts from next month"; spec/backend/projects.md, "An honor-system promise is the owner's opt-in on a positive monthly pool and changes no amount or payment"; spec/backend/projects.md, "The maintainer share is an owner setting whose history only the server writes"; spec/backend/intakeCap.md, "A recent count at or above the cap of an active project pauses it"; spec/backend/backlogRule.md, "The owner sets slopbot.catchUpUntil in project settings as an immutable owner revision, not a material term; a date at most fourteen days ahead"
import { catchUpCanMove, catchUpCanStart, catchUpRefused } from "../../../gen/backend__backlogRule.ts";
import { maxCap, minCap } from "../../../gen/backend__intakeCap.ts";
import { honorSystemValid, maxShareBasisPoints } from "../../../gen/backend__projects.ts";
import { githubUserIdFromNodeId } from "../nodeId.ts";
import { legacyHolder } from "../store/legacy.ts";
import { readyLabelProblem } from "./readyLabel.ts";

type Json = Readonly<Record<string, unknown>>;

class Invalid extends Error {}

function fail(message: string): never {
  throw new Invalid(message);
}

function problemOf(check: () => void): string | undefined {
  try {
    check();
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "Project manifest is invalid";
  }
}

/** @throws {never} */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, field: string): Json {
  if (!isRecord(value)) fail(`${field} must be an object`);
  return value;
}

function exactKeys(value: Json, keys: ReadonlyArray<string>, field: string): void {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) fail(`${field} has unexpected or missing fields`);
}

function list(value: unknown): ReadonlyArray<unknown> {
  return Array.isArray(value) ? value : [];
}

const exactUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const canonicalUint = /^(?:0|[1-9]\d*)$/u;
const projectIdPattern = /^[a-z0-9](?:[a-z0-9-]{0,41}[a-z0-9])?$/u;
const repositoryPathPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const revisionPattern = /^[a-z0-9][a-z0-9._-]*$/u;
const nodeIdPattern = /^[A-Za-z0-9_=-]+$/u;
const loginPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
const cyclePattern = /^\d{4}-(?:0[1-9]|1[0-2])$/u;
const maxProjectIdLength = 43;
const hourMs = 3_600_000;
const maxMonthlyCapMinor = 1_000_000_000_000_000n;
const maxBaseUnits = (1n << 128n) - 1n;
const maxSolanaBaseUnits = (1n << 64n) - 1n;
const escrowPayoutFeeBasisPoints = 200;
const contributorTemplate = "skills/project-contributor-template";
const reviewerTemplate = "skills/project-reviewer-template";
const stewardDisclosure = "Funds go directly to the project wallet. Slop does not hold or recover funds.";

const contributionFields = ["approvedScope", "contributionGuide", "supportedTasks", "requiredTests", "reviewExpectations", "securityContact", "closurePolicy", "maintainerNotes"] as const;

function isExactUtc(value: unknown): value is string {
  return typeof value === "string" && exactUtc.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function timestamp(value: unknown, field: string): string {
  if (!isExactUtc(value)) fail(`${field} is invalid`);
  return value;
}

interface Bounds {
  readonly min?: number;
  readonly max?: number;
  readonly pattern?: RegExp;
}

function text(value: unknown, field: string, { min = 1, max = 500, pattern }: Bounds = {}): string {
  if (typeof value !== "string" || value.length < min || value.length > max || (pattern !== undefined && !pattern.test(value))) fail(`${field} is invalid`);
  return value;
}

function url(value: unknown, field: string, expectedOrigin?: string): string {
  const result = text(value, field, { max: 500 });
  const parsed = URL.parse(result);
  if (parsed === null) fail(`${field} is not a URL`);
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.hash !== "" || (expectedOrigin !== undefined && parsed.origin !== expectedOrigin)) fail(`${field} is not an allowed HTTPS URL`);
  return result;
}

function pathOf(value: string): string {
  return URL.parse(value)?.pathname ?? "";
}

const minor = (value: unknown, field: string) => text(value, field, { pattern: canonicalUint });
const digest = (value: unknown, field: string) => text(value, field, { pattern: /^[0-9a-f]{64}$/u });
const commit = (value: unknown, field: string) => text(value, field, { pattern: /^[0-9a-f]{40}$/u });
const numericId = (value: unknown, field: string) => text(value, field, { max: 40, pattern: /^[1-9]\d*$/u });

function nullable(value: unknown, field: string, validate: (entry: unknown, name: string) => unknown): void {
  if (value !== null) validate(value, field);
}

/** @throws {never} */
export function validIntegrationBranch(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 255 &&
    value.isWellFormed() &&
    value !== "@" &&
    value !== "HEAD" &&
    !value.startsWith("-") &&
    !value.endsWith(".") &&
    !value.includes("..") &&
    !value.includes("@{") &&
    !/[~^:?*[\\]/u.test(value) &&
    [...value].every((character) => {
      const code = character.charCodeAt(0);
      return code > 32 && code !== 127;
    }) &&
    value.split("/").every((part) => part !== "" && !part.startsWith(".") && !part.endsWith(".lock"))
  );
}

function isCanonicalBaseUnits(value: unknown): value is string {
  return typeof value === "string" && value.length <= 39 && canonicalUint.test(value) && BigInt(value) <= maxBaseUnits;
}

function groupedWhole(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}

function formatBaseUnits(value: string, decimals: unknown): string {
  if (!canonicalUint.test(value)) fail("amount must be canonical integer base units");
  if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) fail("asset decimals must be an integer from 0 to 36");
  const scale = 10n ** BigInt(decimals);
  const amount = BigInt(value);
  const fraction = (amount % scale).toString().padStart(decimals, "0").replace(/0+$/u, "");
  const shown = groupedWhole(amount / scale);
  return fraction === "" ? shown : `${shown}.${fraction}`;
}

function formatMonthlyCapDisplay(value: unknown): string {
  if (typeof value !== "string" || !canonicalUint.test(value)) fail("monthly cap must be canonical integer minor units");
  const amount = BigInt(value);
  if (amount > maxMonthlyCapMinor || amount % 10_000n !== 0n) fail("monthly cap must be cent-precise and at most $1B");
  const cents = Number((amount % 1_000_000n) / 10_000n);
  return `$${groupedWhole(amount / 1_000_000n)}${cents === 0 ? "" : `.${String(cents).padStart(2, "0")}`}`;
}

function monthlyAmountDisplay(value: unknown, rewardAsset: Json | undefined): string {
  if (rewardAsset === undefined || rewardAsset.kind === "stablecoin") return formatMonthlyCapDisplay(value);
  if (!isCanonicalBaseUnits(value)) fail("monthly amount is too large");
  return `${formatBaseUnits(value, rewardAsset.decimals)} ${String(rewardAsset.symbol)}`;
}

const escrowChains = ["base", "solana", "robinhood", "ethereum"] as const;

function isEscrowChain(value: unknown): boolean {
  return escrowChains.some((chain) => chain === value);
}

function maxBaseUnitsForChain(chain: unknown): bigint {
  return chain === "solana" ? maxSolanaBaseUnits : maxBaseUnits;
}

const evmNativeAsset = "0x0000000000000000000000000000000000000000";
const solanaNativeAsset = "11111111111111111111111111111111";

interface RewardNetwork {
  readonly family: "evm" | "solana";
  readonly chainId: string | null;
  readonly cluster: string | null;
  readonly native: { readonly address: string; readonly symbol: string; readonly decimals: number };
  readonly stablecoin: { readonly address: string; readonly symbol: string; readonly decimals: number };
}

const evmNative = { address: evmNativeAsset, symbol: "ETH", decimals: 18 };

const rewardNetworks: Readonly<Record<string, RewardNetwork>> = {
  base: { family: "evm", chainId: "8453", cluster: null, native: evmNative, stablecoin: { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6 } },
  ethereum: { family: "evm", chainId: "1", cluster: null, native: evmNative, stablecoin: { address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", decimals: 6 } },
  robinhood: { family: "evm", chainId: "4663", cluster: null, native: evmNative, stablecoin: { address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", symbol: "USDG", decimals: 6 } },
  solana: { family: "solana", chainId: null, cluster: "mainnet-beta", native: { address: solanaNativeAsset, symbol: "SOL", decimals: 9 }, stablecoin: { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6 } },
};

function isNativeAssetAddress(chain: unknown, address: unknown): boolean {
  return chain === "solana" ? address === solanaNativeAsset : (chain === "base" || chain === "ethereum" || chain === "robinhood") && address === evmNativeAsset;
}

const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Length(value: unknown, minimum: number, maximum: number): number | undefined {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum || !/^[1-9A-HJ-NP-Za-km-z]+$/u.test(value)) return undefined;
  let number = 0n;
  for (const character of value) number = number * 58n + BigInt(base58Alphabet.indexOf(character));
  let bytes = 0;
  for (; number > 0n; number >>= 8n) bytes += 1;
  let zeros = 0;
  while (value[zeros] === "1") zeros += 1;
  return zeros + bytes;
}

function isEvmAccount(value: unknown): boolean {
  return typeof value === "string" && /^0x[0-9a-f]{40}$/u.test(value) && value !== evmNativeAsset;
}

function bech32Polymod(values: ReadonlyArray<number>): number {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    generators.forEach((generator, index) => {
      if ((top >>> index) & 1) checksum ^= generator;
    });
  }
  return checksum >>> 0;
}

function validBitcoinAddress(value: unknown): boolean {
  if (typeof value !== "string" || value !== value.toLowerCase() || !value.startsWith("bc1")) return false;
  if (value.lastIndexOf("1") !== 2 || value.length < 14 || value.length > 90) return false;
  const data = [...value.slice(3)].map((character) => "qpzry9x8gf2tvdw0s3jn54khce6mua7l".indexOf(character));
  if (data.some((entry) => entry < 0) || data.length < 7) return false;
  const encoding = bech32Polymod([3, 3, 0, 2, 3, ...data]);
  const payload = data.slice(0, -6);
  const witnessVersion = payload[0];
  if (witnessVersion === undefined || witnessVersion > 16) return false;
  let accumulator = 0;
  let bits = 0;
  const program: number[] = [];
  for (const entry of payload.slice(1)) {
    accumulator = (accumulator << 5) | entry;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      program.push((accumulator >> bits) & 0xff);
    }
  }
  if (bits >= 5 || ((accumulator << (8 - bits)) & 0xff) !== 0) return false;
  if (program.length < 2 || program.length > 40) return false;
  if (witnessVersion === 0) return (program.length === 20 || program.length === 32) && encoding === 1;
  if (witnessVersion === 1 && program.length !== 32) return false;
  return encoding === 0x2bc830a3;
}

const fundingAssets: Readonly<Record<string, string>> = { base: "USDC", bitcoin: "BTC", ethereum: "USDC", robinhood: "USDG", solana: "USDC" };

function fundingAssetForNetwork(network: unknown): string | undefined {
  return typeof network === "string" ? fundingAssets[network] : undefined;
}

function isFundingAddress(network: unknown, value: unknown): boolean {
  if (network === "solana") return base58Length(value, 32, 44) === 32;
  if (network === "bitcoin") return validBitcoinAddress(value);
  if (network === "base" || network === "ethereum" || network === "robinhood") return isEvmAccount(value);
  return false;
}

function assertFundingAddresses(value: unknown, field: string): void {
  if (!Array.isArray(value) || value.length > 32) fail(`${field} must be an array of at most 32 routes`);
  const seen = new Set<string>();
  const histories = new Map<string, Array<{ readonly effectiveAt: string; readonly replacedAt: string | null }>>();
  value.forEach((candidate, index) => {
    const routeField = `${field}[${index}]`;
    const route = record(candidate, routeField);
    exactKeys(route, ["address", "asset", "effectiveAt", "network", "replacedAt"], routeField);
    if (route.network === "robinhood") fail("Robinhood Chain projects settle through the project escrow; a direct funding address is not supported");
    const asset = fundingAssetForNetwork(route.network);
    if (asset === undefined || route.asset !== asset) fail(`${routeField} network or asset is unsupported`);
    if (!isFundingAddress(route.network, route.address)) fail(`${routeField}.address is invalid`);
    const effectiveAt = timestamp(route.effectiveAt, `${routeField}.effectiveAt`);
    const replacedAt = route.replacedAt === null ? null : timestamp(route.replacedAt, `${routeField}.replacedAt`);
    if (replacedAt !== null && Date.parse(replacedAt) <= Date.parse(effectiveAt)) fail(`${routeField}.replacedAt must follow effectiveAt`);
    const addressKey = `${String(route.network)}:${asset}:${String(route.address)}`;
    if (seen.has(addressKey)) fail(`${field} contain a duplicate receiving address`);
    seen.add(addressKey);
    const historyKey = `${String(route.network)}:${asset}`;
    histories.set(historyKey, [...(histories.get(historyKey) ?? []), { effectiveAt, replacedAt }]);
  });
  for (const history of histories.values()) {
    const ordered = [...history].sort((left, right) => left.effectiveAt.localeCompare(right.effectiveAt));
    for (let index = 1; index < ordered.length; index += 1) {
      const prior = ordered[index - 1];
      const current = ordered[index];
      if (prior !== undefined && current !== undefined && (prior.replacedAt === null || prior.replacedAt > current.effectiveAt)) fail(`${field} contain overlapping active routes`);
    }
  }
}

const symbolPattern = /^[A-Za-z0-9$._-]{1,16}$/u;

function canonicalRewardAssetAddress(network: string, value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const definition = rewardNetworks[network];
  if (definition === undefined) return undefined;
  const trimmed = value.trim();
  const address = definition.family === "evm" ? trimmed.toLowerCase() : trimmed;
  return isFundingAddress(network, address) ? address : undefined;
}

function assertRewardAsset(value: unknown, field = "project.rewardAsset"): Json {
  if (!isRecord(value)) fail(`${field} must be an object`);
  if (Object.keys(value).sort().join("\0") !== ["address", "chainId", "cluster", "decimals", "kind", "network", "symbol", "verifiedAt"].join("\0")) fail(`${field} has unexpected or missing fields`);
  const network = String(value.network);
  const definition = Object.hasOwn(rewardNetworks, network) ? rewardNetworks[network] : undefined;
  if (definition === undefined) fail(`${field}.network is unsupported`);
  if (value.chainId !== definition.chainId || value.cluster !== definition.cluster) fail(`${field} chain identity does not match its network`);
  const native = isNativeAssetAddress(network, value.address);
  if (value.kind === "native" ? !native : canonicalRewardAssetAddress(network, value.address) !== value.address || native) fail(`${field}.address is not a canonical address`);
  if (typeof value.decimals !== "number" || !Number.isSafeInteger(value.decimals) || value.decimals < 0 || value.decimals > 36) fail(`${field}.decimals is invalid`);
  if (typeof value.symbol !== "string" || !symbolPattern.test(value.symbol)) fail(`${field}.symbol is invalid`);
  if (typeof value.verifiedAt !== "string" || !Number.isFinite(Date.parse(value.verifiedAt)) || new Date(value.verifiedAt).toISOString() !== value.verifiedAt) fail(`${field}.verifiedAt is invalid`);
  const { stablecoin } = definition;
  if (value.kind === "native") {
    if (value.address !== definition.native.address || value.symbol !== definition.native.symbol || value.decimals !== definition.native.decimals) fail(`${field} is not the network native coin`);
  } else if (value.kind === "stablecoin") {
    if (value.address !== stablecoin.address || value.symbol !== stablecoin.symbol || value.decimals !== stablecoin.decimals) fail(`${field} is not the network stablecoin`);
  } else if (value.kind === "token") {
    if (value.address === stablecoin.address) fail(`${field} names the network stablecoin as a token`);
  } else {
    fail(`${field}.kind is invalid`);
  }
  return value;
}

const exclusionKeys = ["actorId", "fromCycle", "login", "nodeId", "relationship", "untilCycle"];
const exclusionRelationships = ["owner", "funded-employee", "related-party"];

interface Exclusion {
  readonly actorId: string;
  readonly nodeId: string;
  readonly relationship: string;
  readonly fromCycle: string;
  readonly untilCycle: string | null;
}

function validatePayoutExclusions(value: unknown, field: string): void {
  if (!Array.isArray(value) || value.length === 0) fail(`${field} must be a nonempty array`);
  const identities = new Map<string, Exclusion[]>();
  value.forEach((candidate, index) => {
    const path = `${field}[${index}]`;
    if (!isRecord(candidate) || Object.keys(candidate).sort().join() !== exclusionKeys.join()) fail(`${path} must contain exactly ${exclusionKeys.join(", ")}`);
    const { actorId, nodeId, login, relationship, fromCycle, untilCycle } = candidate;
    if (typeof actorId !== "string" || !/^[1-9][0-9]{0,19}$/u.test(actorId) || typeof nodeId !== "string" || githubUserIdFromNodeId(nodeId).toString() !== actorId || typeof login !== "string" || !loginPattern.test(login)) fail(`${path} must name one immutable GitHub identity`);
    if (typeof relationship !== "string" || !exclusionRelationships.includes(relationship)) fail(`${path}.relationship must be ${exclusionRelationships.join(", ")}`);
    if (typeof fromCycle !== "string" || !cyclePattern.test(fromCycle) || !(untilCycle === null || (typeof untilCycle === "string" && cyclePattern.test(untilCycle) && untilCycle > fromCycle))) fail(`${path} must cover at least one UTC month, from fromCycle until untilCycle`);
    const entry = { actorId, nodeId, relationship, fromCycle, untilCycle } satisfies Exclusion;
    const known = identities.get(actorId) ?? [];
    for (const other of known) if ((other.untilCycle === null || entry.fromCycle < other.untilCycle) && (entry.untilCycle === null || other.fromCycle < entry.untilCycle)) fail(`${path} overlaps another exclusion of the actor`);
    identities.set(actorId, [...known, entry]);
  });
}

const maxProjectImageLength = 16_384;

function assertProjectImage(value: unknown): void {
  if (typeof value !== "string" || value.length > maxProjectImageLength || !/^data:image\/(?:webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/u.test(value)) fail("Project image must be a small WebP or JPEG image.");
  let bytes: string;
  try {
    bytes = atob(value.slice(value.indexOf(",") + 1));
  } catch {
    fail("Project image encoding is invalid.");
  }
  const valid = value.startsWith("data:image/webp;") ? bytes.slice(0, 4) === "RIFF" && bytes.slice(8, 12) === "WEBP" : bytes.startsWith("\xff\xd8\xff") && bytes.endsWith("\xff\xd9");
  if (!valid) fail("Project image bytes must match its WebP or JPEG type.");
}

function repositoryIdentities(repository: Json): ReadonlyArray<string> {
  return [String(repository.id), ...list(repository.aliases).map(String)];
}

function immutableGithubUrl(value: unknown, field: string, repositoryIds: ReadonlyArray<string>, commitSha: string, path: string): void {
  const pathname = pathOf(url(value, field, "https://github.com"));
  if (!repositoryIds.some((repositoryId) => pathname === `/${repositoryId}/blob/${commitSha}/${path}`)) fail(`${field} must be an immutable repository URL`);
}

function immutableGithubCommitUrl(value: unknown, field: string, repositoryIds: ReadonlyArray<string>, commitSha: string): void {
  const pathname = pathOf(url(value, field, "https://github.com"));
  if (!repositoryIds.some((repositoryId) => pathname.startsWith(`/${repositoryId}/blob/${commitSha}/`) && pathname.length > `/${repositoryId}/blob/${commitSha}/`.length)) fail(`${field} must bind its repository, commit, and non-empty path`);
}

function validateSteward(value: unknown): Json {
  const field = "project.steward";
  const steward = record(value, field);
  exactKeys(steward, ["displayName", "github", "kind", "website"], field);
  text(steward.displayName, `${field}.displayName`, { max: 120, min: 2 });
  if (!["individual", "organization", "dao", "collective"].includes(String(steward.kind))) fail(`${field}.kind is invalid`);
  const github = record(steward.github, `${field}.github`);
  exactKeys(github, ["actorId", "login", "nodeId", "profileUrl", "type"], `${field}.github`);
  numericId(github.actorId, `${field}.github.actorId`);
  text(github.nodeId, `${field}.github.nodeId`, { max: 100, pattern: nodeIdPattern });
  const login = text(github.login, `${field}.github.login`, { max: 39, pattern: loginPattern });
  if (github.type !== "User" && github.type !== "Organization") fail(`${field}.github.type is invalid`);
  const profileUrl = url(github.profileUrl, `${field}.github.profileUrl`, "https://github.com");
  if (pathOf(profileUrl).toLowerCase() !== `/${login}`.toLowerCase()) fail(`${field}.github.profileUrl does not match its login`);
  nullable(steward.website, `${field}.website`, (entry, name) => url(entry, name));
  return steward;
}

function validateAuthority(value: unknown, repository: Json): Json {
  const field = "project.authority";
  const authority = record(value, field);
  exactKeys(authority, ["proof", "reason", "repositoryId", "repositoryNodeId", "role", "state"], field);
  numericId(authority.repositoryId, `${field}.repositoryId`);
  text(authority.repositoryNodeId, `${field}.repositoryNodeId`, { max: 100, pattern: nodeIdPattern });
  if (authority.role !== "project-steward") fail(`${field}.role is invalid`);
  if (authority.state === "unverified") {
    if (authority.proof !== null || authority.reason !== "missing-repository-proof") fail(`${field} unverified state is inconsistent`);
    return authority;
  }
  if (authority.state !== "verified" || authority.reason !== null) fail(`${field}.state is invalid`);
  const proof = record(authority.proof, `${field}.proof`);
  exactKeys(proof, ["commitSha", "fileSha256", "policyRevision", "url", "verifiedAt"], `${field}.proof`);
  const commitSha = commit(proof.commitSha, `${field}.proof.commitSha`);
  digest(proof.fileSha256, `${field}.proof.fileSha256`);
  text(proof.policyRevision, `${field}.proof.policyRevision`, { max: 80, pattern: revisionPattern });
  timestamp(proof.verifiedAt, `${field}.proof.verifiedAt`);
  immutableGithubUrl(proof.url, `${field}.proof.url`, repositoryIdentities(repository), commitSha, ".github/slop-project.json");
  return authority;
}

interface TermsOptions {
  readonly allowLegacyUnsupportedOwnershipClaim: boolean;
}

function validateTerms(value: unknown, repository: Json, reward: Json, steward: Json, { allowLegacyUnsupportedOwnershipClaim }: TermsOptions): Json {
  const field = "project.terms";
  const repositoryIds = repositoryIdentities(repository);
  const terms = record(value, field);
  exactKeys(terms, ["assignment", "copyright", "effectiveAt", "externalPrize", "inbound", "paymentTransfersIp", "receiptPolicy", "repositoryLicense", "retroactive", "revision"], field);
  text(terms.revision, `${field}.revision`, { max: 80, pattern: revisionPattern });
  timestamp(terms.effectiveAt, `${field}.effectiveAt`);
  const receiptPolicy = record(terms.receiptPolicy, `${field}.receiptPolicy`);
  exactKeys(receiptPolicy, ["activatedAt", "bindings", "state"], `${field}.receiptPolicy`);
  if (!Array.isArray(receiptPolicy.bindings)) fail(`${field}.receiptPolicy.bindings must be an array`);
  const bindingValues: ReadonlyArray<unknown> = receiptPolicy.bindings;
  if (receiptPolicy.state === "pending-authority-activation") {
    if (receiptPolicy.activatedAt !== null || bindingValues.length !== 0) fail(`${field}.receiptPolicy pending state cannot have activation bindings`);
  } else if (receiptPolicy.state === "active") {
    timestamp(receiptPolicy.activatedAt, `${field}.receiptPolicy.activatedAt`);
    if (bindingValues.length === 0) fail(`${field}.receiptPolicy active state requires bindings`);
  } else {
    fail(`${field}.receiptPolicy.state is invalid`);
  }
  if (terms.paymentTransfersIp !== false || terms.retroactive !== false) fail(`${field} cannot transfer IP by payment or apply retroactively`);
  const copyright = record(terms.copyright, `${field}.copyright`);
  exactKeys(copyright, ["claimedLegalHolder", "governanceResolution", "legalCapacity", "model", "notice"], `${field}.copyright`);
  if (!["sponsor-owned", "contributor-retained", "mixed", "unknown"].includes(String(copyright.model))) fail(`${field}.copyright.model is invalid`);
  nullable(copyright.claimedLegalHolder, `${field}.copyright.claimedLegalHolder`, (entry, name) => text(entry, name, { max: 240 }));
  nullable(copyright.notice, `${field}.copyright.notice`, (entry, name) => text(entry, name, { max: 500 }));
  if (copyright.model === "contributor-retained" && copyright.claimedLegalHolder !== null) fail(`${field} contributor-retained terms forbid a sole-holder claim`);
  if (copyright.model === "sponsor-owned" && copyright.claimedLegalHolder === null) fail(`${field} sponsor-owned terms require an exact legal holder`);
  if (!allowLegacyUnsupportedOwnershipClaim && (copyright.model === "mixed" || copyright.model === "unknown") && copyright.claimedLegalHolder !== null) fail(`${field} records no ownership claim outside signed sponsor-owned terms`);
  if (copyright.legalCapacity !== null) {
    const capacity = record(copyright.legalCapacity, `${field}.copyright.legalCapacity`);
    exactKeys(capacity, ["entityId", "jurisdiction", "legalName"], `${field}.copyright.legalCapacity`);
    for (const name of ["entityId", "jurisdiction", "legalName"]) text(capacity[name], `${field}.copyright.legalCapacity.${name}`, { max: 240 });
  }
  if (copyright.governanceResolution !== null) {
    const resolution = record(copyright.governanceResolution, `${field}.copyright.governanceResolution`);
    exactKeys(resolution, ["fileSha256", "url", "version"], `${field}.copyright.governanceResolution`);
    digest(resolution.fileSha256, `${field}.copyright.governanceResolution.fileSha256`);
    url(resolution.url, `${field}.copyright.governanceResolution.url`);
    text(resolution.version, `${field}.copyright.governanceResolution.version`, { max: 80 });
  }
  const license = record(terms.repositoryLicense, `${field}.repositoryLicense`);
  exactKeys(license, ["commitSha", "fileSha256", "spdx", "state", "url"], `${field}.repositoryLicense`);
  if (license.state === "unknown") {
    if ([license.commitSha, license.fileSha256, license.spdx, license.url].some((entry) => entry !== null)) fail(`${field}.repositoryLicense unknown state must not invent terms`);
  } else if (license.state === "verified") {
    text(license.spdx, `${field}.repositoryLicense.spdx`, { max: 80, pattern: /^[A-Za-z0-9-.+]+(?: (?:AND|OR|WITH) [A-Za-z0-9-.+]+)*$/u });
    const licenseCommit = commit(license.commitSha, `${field}.repositoryLicense.commitSha`);
    digest(license.fileSha256, `${field}.repositoryLicense.fileSha256`);
    immutableGithubUrl(license.url, `${field}.repositoryLicense.url`, repositoryIds, licenseCommit, "LICENSE");
  } else {
    fail(`${field}.repositoryLicense.state is invalid`);
  }
  const inbound = record(terms.inbound, `${field}.inbound`);
  exactKeys(inbound, ["acceptance", "commitSha", "fileSha256", "mode", "termsUrl", "version"], `${field}.inbound`);
  if (!["license", "cla", "assignment", "dco", "mixed", "unknown"].includes(String(inbound.mode))) fail(`${field}.inbound.mode is invalid`);
  if (inbound.mode === "unknown") {
    if ([inbound.acceptance, inbound.commitSha, inbound.fileSha256, inbound.termsUrl, inbound.version].some((entry) => entry !== null)) fail(`${field}.inbound unknown state must not invent terms`);
  } else {
    text(inbound.acceptance, `${field}.inbound.acceptance`, { max: 240 });
    const inboundCommit = commit(inbound.commitSha, `${field}.inbound.commitSha`);
    digest(inbound.fileSha256, `${field}.inbound.fileSha256`);
    text(inbound.version, `${field}.inbound.version`, { max: 80 });
    immutableGithubCommitUrl(inbound.termsUrl, `${field}.inbound.termsUrl`, repositoryIds, inboundCommit);
  }
  if (terms.assignment !== null) {
    const assignment = record(terms.assignment, `${field}.assignment`);
    exactKeys(assignment, ["assignee", "fileSha256", "instrumentUrl", "signedAt", "version"], `${field}.assignment`);
    text(assignment.assignee, `${field}.assignment.assignee`, { max: 240 });
    digest(assignment.fileSha256, `${field}.assignment.fileSha256`);
    url(assignment.instrumentUrl, `${field}.assignment.instrumentUrl`);
    timestamp(assignment.signedAt, `${field}.assignment.signedAt`);
    text(assignment.version, `${field}.assignment.version`, { max: 80 });
  }
  if (inbound.mode === "assignment" && terms.assignment === null) fail(`${field} assignment inbound mode requires a signed instrument`);
  if (copyright.model === "sponsor-owned" && terms.assignment === null) fail(`${field} sponsor-owned terms require a signed assignment instrument`);
  if (copyright.model === "sponsor-owned" && steward.kind === "dao" && (copyright.legalCapacity === null || copyright.governanceResolution === null)) fail(`${field} DAO title requires legal capacity and a governance resolution`);
  if (reward.kind === "external-prize-share") {
    const prize = record(terms.externalPrize, `${field}.externalPrize`);
    exactKeys(prize, ["allocationAuthority", "defaultContributorAllocation", "eligibility", "ipTerms", "organizer", "rulesCapturedAt", "rulesSha256", "rulesUrl", "version"], `${field}.externalPrize`);
    text(prize.organizer, `${field}.externalPrize.organizer`, { max: 160 });
    url(prize.rulesUrl, `${field}.externalPrize.rulesUrl`);
    for (const name of ["allocationAuthority", "defaultContributorAllocation", "eligibility", "ipTerms", "version"]) text(prize[name], `${field}.externalPrize.${name}`, { max: 240 });
    if (prize.rulesSha256 === null || prize.rulesCapturedAt === null) {
      if (prize.rulesSha256 !== null || prize.rulesCapturedAt !== null || prize.version !== "unknown") fail(`${field}.externalPrize unverified rules are inconsistent`);
    } else {
      digest(prize.rulesSha256, `${field}.externalPrize.rulesSha256`);
      timestamp(prize.rulesCapturedAt, `${field}.externalPrize.rulesCapturedAt`);
    }
  } else if (terms.externalPrize !== null) {
    fail(`${field}.externalPrize is only valid for external prizes`);
  }
  const prize = isRecord(terms.externalPrize) ? terms.externalPrize : undefined;
  if (receiptPolicy.state === "active") {
    if (license.state !== "verified" || license.fileSha256 === null) fail(`${field}.receiptPolicy active state requires a verified repository license`);
    if (inbound.mode === "unknown" || inbound.fileSha256 === null) fail(`${field}.receiptPolicy active state requires immutable inbound terms`);
    if (prize !== undefined && (prize.rulesSha256 === null || prize.rulesCapturedAt === null || prize.version === "unknown")) fail(`${field}.receiptPolicy active state requires immutable external prize rules`);
    const revisions = new Set<string>();
    let previousActivation = -Infinity;
    const bindings = bindingValues.map((candidate, index) => {
      const bindingField = `${field}.receiptPolicy.bindings[${index}]`;
      const binding = record(candidate, bindingField);
      exactKeys(binding, ["activatedAt", "inboundTermsSha256", "licenseSha256", "policyRevision", "prizeRulesSha256"], bindingField);
      const policyRevision = text(binding.policyRevision, `${bindingField}.policyRevision`, { max: 80, pattern: revisionPattern });
      if (revisions.has(policyRevision)) fail(`${field}.receiptPolicy has duplicate revisions`);
      revisions.add(policyRevision);
      const activatedAt = timestamp(binding.activatedAt, `${bindingField}.activatedAt`);
      if (Date.parse(activatedAt) <= previousActivation) fail(`${field}.receiptPolicy bindings must be activation ordered`);
      previousActivation = Date.parse(activatedAt);
      digest(binding.licenseSha256, `${bindingField}.licenseSha256`);
      nullable(binding.inboundTermsSha256, `${bindingField}.inboundTermsSha256`, digest);
      nullable(binding.prizeRulesSha256, `${bindingField}.prizeRulesSha256`, digest);
      return binding;
    });
    const first = bindings[0];
    const current = bindings.at(-1);
    if (first?.activatedAt !== receiptPolicy.activatedAt) fail(`${field}.receiptPolicy cutover must equal its first binding activation`);
    if (current === undefined || current.policyRevision !== terms.revision || current.activatedAt !== terms.effectiveAt || current.licenseSha256 !== license.fileSha256 || current.inboundTermsSha256 !== inbound.fileSha256 || current.prizeRulesSha256 !== (prize?.rulesSha256 ?? null)) fail(`${field}.receiptPolicy latest binding must match current terms and effective date`);
  }
  return terms;
}

function validateRepository(value: unknown, index: number): Json {
  const field = `project.repositories[${index}]`;
  const repository = record(value, field);
  const requiredKeys = ["description", "displayName", "githubUrl", "id", "integrationBranch"];
  const identityKeys = ["countsFrom", "githubId", "nodeId"];
  const presentIdentityKeys = identityKeys.filter((key) => Object.hasOwn(repository, key));
  if (index === 0 && presentIdentityKeys.length > 0) fail(`${field} is the primary repository; its identity comes from project.authority`);
  if (presentIdentityKeys.length !== 0 && presentIdentityKeys.length !== 3) fail(`${field} must carry githubId, nodeId and countsFrom together`);
  const baseKeys = Object.keys(repository).filter((key) => !identityKeys.includes(key)).sort().join("\0");
  if (baseKeys !== [...requiredKeys].sort().join("\0") && baseKeys !== [...requiredKeys, "aliases"].sort().join("\0")) fail(`${field} has unexpected or missing fields`);
  if (presentIdentityKeys.length === 3) {
    text(repository.githubId, `${field}.githubId`, { max: 20, pattern: /^[1-9][0-9]*$/u });
    text(repository.nodeId, `${field}.nodeId`, { max: 100 });
    const countsFrom = text(repository.countsFrom, `${field}.countsFrom`, { max: 24, pattern: /^[0-9]{4}-[0-9]{2}-01T00:00:00\.000Z$/u });
    const parsed = new Date(countsFrom);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== countsFrom) fail(`${field}.countsFrom must be an exact UTC month start`);
  }
  const id = text(repository.id, `${field}.id`, { max: 201, pattern: repositoryPathPattern });
  const aliases = repository.aliases ?? [];
  if (!Array.isArray(aliases) || aliases.length > 10) fail(`${field}.aliases must contain at most 10 entries`);
  const repositoryIds = [id, ...aliases.map((alias: unknown, aliasIndex: number) => text(alias, `${field}.aliases[${aliasIndex}]`, { max: 201, pattern: repositoryPathPattern }))];
  if (new Set(repositoryIds.map((repositoryId) => repositoryId.toLowerCase())).size !== repositoryIds.length) fail(`${field} contains duplicate repository identities`);
  const githubUrl = url(repository.githubUrl, `${field}.githubUrl`, "https://github.com");
  if (!repositoryIds.some((repositoryId) => pathOf(githubUrl).replace(/\/$/u, "").toLowerCase() === `/${repositoryId}`.toLowerCase())) fail(`${field}.githubUrl does not match a registered repository identity`);
  text(repository.displayName, `${field}.displayName`, { max: 201 });
  text(repository.description, `${field}.description`, { max: 500, min: 12 });
  text(repository.integrationBranch, `${field}.integrationBranch`, { max: 255 });
  if (!validIntegrationBranch(repository.integrationBranch)) fail(`${field}.integrationBranch is invalid`);
  return repository;
}

function validateSkill(value: unknown, field: string, expectedId: string, publicPath: string | undefined, allowLegacyMissingPublishAtRoot: boolean): Json {
  const skill = record(value, field);
  const hasPublishAtRoot = Object.hasOwn(skill, "publishAtRoot");
  exactKeys(skill, publicPath === undefined ? ["id", "sourcePath"] : ["id", "publicPath", ...(hasPublishAtRoot ? ["publishAtRoot"] : []), "sourcePath"], field);
  if (publicPath !== undefined && !hasPublishAtRoot && !allowLegacyMissingPublishAtRoot) fail(`${field}.publishAtRoot is required`);
  const template = publicPath === undefined ? reviewerTemplate : contributorTemplate;
  if (skill.id !== expectedId || (skill.sourcePath !== `skills/${expectedId}` && skill.sourcePath !== template) || (publicPath !== undefined && (skill.publicPath !== publicPath || (hasPublishAtRoot && typeof skill.publishAtRoot !== "boolean")))) fail(`${field} does not match its project identity`);
  return skill;
}

function validateContribution(value: unknown): void {
  const contribution = record(value, "project.contribution");
  exactKeys(contribution, contributionFields, "project.contribution");
  for (const field of contributionFields) {
    const entry = contribution[field];
    if (typeof entry !== "string" || !entry.isWellFormed() || entry.length < (field === "approvedScope" ? 6 : 0) || entry.length > 2000) fail(`project.contribution.${field} is invalid`);
  }
}

function validateReviewBudget(value: unknown, field: string, poolPaymentMode: unknown): void {
  const budget = record(value, field);
  exactKeys(budget, ["committedMinor", "effectiveAt", "fundingState", "monthlyCapDisplay", "monthlyCapMinor", "paymentMode", "unusedFunds"], field);
  const monthlyCapMinor = minor(budget.monthlyCapMinor, `${field}.monthlyCapMinor`);
  const effectiveAt = timestamp(budget.effectiveAt, `${field}.effectiveAt`);
  const committedMinor = minor(budget.committedMinor, `${field}.committedMinor`);
  if (budget.paymentMode !== "disabled" && budget.paymentMode !== "enabled") fail(`${field}.paymentMode is invalid`);
  text(budget.monthlyCapDisplay, `${field}.monthlyCapDisplay`, { max: 80 });
  const fundingConsistent = budget.paymentMode === "disabled"
    ? (budget.fundingState === "pledged" && committedMinor === "0") || (budget.fundingState === "committed" && BigInt(committedMinor) > 0n)
    : budget.fundingState === "committed" && BigInt(committedMinor) > 0n;
  if (BigInt(monthlyCapMinor) <= 0n || !effectiveAt.endsWith("-01T00:00:00.000Z") || budget.unusedFunds !== "rollover-without-cap-increase" || !fundingConsistent || (budget.paymentMode === "enabled" && poolPaymentMode !== "enabled") || budget.monthlyCapDisplay !== formatMonthlyCapDisplay(monthlyCapMinor)) fail(`${field} review budget policy is inconsistent`);
}

function shareBasisPoints(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maxShareBasisPoints;
}

function validateMaintainerShare(reward: Json, field: string): void {
  const hasShare = Object.hasOwn(reward, "maintainerShare");
  const hasHistory = Object.hasOwn(reward, "maintainerShareHistory");
  if ((hasShare || hasHistory) && reward.kind !== "monthly-pool") fail(`${field}.maintainerShare applies to a monthly pool only`);
  if (hasShare && !shareBasisPoints(reward.maintainerShare, 1)) fail(`${field}.maintainerShare must be whole basis points from 1 to ${maxShareBasisPoints}, or omitted`);
  if (!hasHistory) return;
  const history = reward.maintainerShareHistory;
  if (!Array.isArray(history) || history.length === 0) fail(`${field}.maintainerShareHistory must be a nonempty array`);
  let previous = "";
  for (const entry of history) {
    if (!isRecord(entry) || Object.keys(entry).sort().join() !== "basisPoints,throughCycle" || typeof entry.throughCycle !== "string" || !cyclePattern.test(entry.throughCycle) || entry.throughCycle <= previous || !shareBasisPoints(entry.basisPoints, 0)) fail(`${field}.maintainerShareHistory must list basisPoints and throughCycle in chronological UTC months`);
    previous = entry.throughCycle;
  }
}

interface RewardOptions {
  readonly allowLegacyExternalPrizeFee: boolean;
  readonly escrow: Json | undefined;
  readonly rewardAsset: Json | undefined;
}

function validateReward(value: unknown, field: string, { allowLegacyExternalPrizeFee, escrow, rewardAsset }: RewardOptions): Json {
  const reward = record(value, field);
  const optional = ["externalOpportunity", "externalEvaluations", "cycleCaps", "honorSystem", "maintainerShare", "maintainerShareHistory", "payoutExclusions", "reviewBudget"].filter((key) => Object.hasOwn(reward, key));
  exactKeys(reward, ["chain", "committedMinor", "currency", "cycle", "feeBasisPoints", "fundingState", "kind", "monthlyCapDisplay", "monthlyCapMinor", "paymentMode", "rewardStartAt", "unusedFunds", ...optional], field);
  if (Object.hasOwn(reward, "payoutExclusions")) validatePayoutExclusions(reward.payoutExclusions, `${field}.payoutExclusions`);
  if (Object.hasOwn(reward, "externalEvaluations")) {
    const policy = record(reward.externalEvaluations, `${field}.externalEvaluations`);
    exactKeys(policy, ["enabled"], `${field}.externalEvaluations`);
    if (typeof policy.enabled !== "boolean") fail(`${field}.externalEvaluations.enabled must be a boolean`);
  }
  const monthlyCapMinor = minor(reward.monthlyCapMinor, `${field}.monthlyCapMinor`);
  const committedMinor = minor(reward.committedMinor, `${field}.committedMinor`);
  if (Object.hasOwn(reward, "honorSystem") && !honorSystemValid({ monthlyPool: reward.kind === "monthly-pool", monthlyAmount: BigInt(monthlyCapMinor) > 0n ? 1 : 0, honor: reward.honorSystem === true ? "HonorTrue" : "HonorFalse", share: shareBasisPoints(reward.maintainerShare, 1) ? reward.maintainerShare : 0 })) fail(`${field}.honorSystem must be true on a positive monthly pool, or omitted`);
  validateMaintainerShare(reward, field);
  if (reward.paymentMode !== "disabled" && reward.paymentMode !== "enabled") fail(`${field}.paymentMode is invalid`);
  text(reward.monthlyCapDisplay, `${field}.monthlyCapDisplay`, { max: 80 });
  timestamp(reward.rewardStartAt, `${field}.rewardStartAt`);
  const expectedFeeBasisPoints = reward.kind === "external-prize-share" ? 1000 : escrow === undefined ? 100 : escrowPayoutFeeBasisPoints;
  const legacyExternalPrizeFee = allowLegacyExternalPrizeFee && reward.kind === "external-prize-share" && reward.feeBasisPoints === 100;
  if (reward.cycle !== "calendar-month-utc" || (reward.feeBasisPoints !== expectedFeeBasisPoints && !legacyExternalPrizeFee)) fail(`${field} cycle or fee policy is invalid`);
  if (reward.kind === "monthly-pool") {
    const fundingConsistent = reward.paymentMode === "disabled"
      ? (reward.fundingState === "pledged" && committedMinor === "0") || (reward.fundingState === "committed" && BigInt(committedMinor) > 0n)
      : reward.fundingState === "committed" && BigInt(committedMinor) > 0n;
    const legacyRail = escrow === undefined && (reward.chain === "solana" || reward.chain === "base") && (rewardAsset === undefined || rewardAsset.kind === "stablecoin");
    const railRefused = escrow !== undefined ? reward.chain !== escrow.chain : !legacyRail && (rewardAsset === undefined || !Object.hasOwn(rewardNetworks, String(reward.chain)) || reward.paymentMode !== "disabled");
    if (
      Object.hasOwn(reward, "externalOpportunity") ||
      (rewardAsset !== undefined && rewardAsset.network !== reward.chain) ||
      reward.currency !== (rewardAsset?.symbol ?? fundingAssetForNetwork(reward.chain) ?? null) ||
      railRefused ||
      reward.unusedFunds !== "rollover-without-cap-increase" ||
      !fundingConsistent ||
      reward.monthlyCapDisplay !== monthlyAmountDisplay(monthlyCapMinor, rewardAsset) ||
      (isEscrowChain(reward.chain) && BigInt(monthlyCapMinor) > maxBaseUnitsForChain(reward.chain))
    )
      fail(`${field} monthly pool policy is inconsistent`);
    if (Object.hasOwn(reward, "cycleCaps")) {
      if (!Array.isArray(reward.cycleCaps) || reward.cycleCaps.length === 0) fail(`${field}.cycleCaps must be a nonempty array`);
      let previousCycle = "";
      for (const entry of reward.cycleCaps) {
        const cap = record(entry, `${field}.cycleCaps entry`);
        exactKeys(cap, ["cycleId", "monthlyCapMinor"], `${field}.cycleCaps entry`);
        if (typeof cap.cycleId !== "string" || !cyclePattern.test(cap.cycleId) || cap.cycleId <= previousCycle) fail(`${field}.cycleCaps must have unique chronological UTC months`);
        monthlyAmountDisplay(cap.monthlyCapMinor, rewardAsset);
        if (isEscrowChain(reward.chain) && BigInt(String(cap.monthlyCapMinor)) > maxBaseUnitsForChain(reward.chain)) fail(`${field}.cycleCaps entry exceeds the chain amount range`);
        previousCycle = cap.cycleId;
      }
    }
    if (Object.hasOwn(reward, "reviewBudget")) validateReviewBudget(reward.reviewBudget, `${field}.reviewBudget`, reward.paymentMode);
  } else if (reward.kind === "external-prize-share") {
    if (
      Object.hasOwn(reward, "reviewBudget") ||
      Object.hasOwn(reward, "cycleCaps") ||
      !Object.hasOwn(reward, "externalOpportunity") ||
      reward.currency !== null ||
      reward.chain !== null ||
      reward.monthlyCapMinor !== "0" ||
      reward.monthlyCapDisplay !== "$0 platform pool" ||
      committedMinor !== "0" ||
      reward.paymentMode !== "disabled" ||
      reward.unusedFunds !== "not-applicable" ||
      reward.fundingState !== "external-opportunity"
    )
      fail(`${field} external opportunity policy is inconsistent`);
    const external = record(reward.externalOpportunity, `${field}.externalOpportunity`);
    exactKeys(external, ["advertisedAmountDisplay", "name", "url"], `${field}.externalOpportunity`);
    text(external.name, `${field}.externalOpportunity.name`, { max: 160 });
    text(external.advertisedAmountDisplay, `${field}.externalOpportunity.advertisedAmountDisplay`, { max: 80 });
    url(external.url, `${field}.externalOpportunity.url`);
  } else {
    fail(`${field}.kind is unsupported`);
  }
  return reward;
}

function validateFunding(value: unknown, projectId: string): Json {
  const funding = record(value, "project.funding");
  exactKeys(funding, ["addresses", "disclosure", "mode", "recordsPath"], "project.funding");
  if (funding.mode !== "direct-noncustodial" || funding.recordsPath !== `funding/${projectId}` || funding.disclosure !== stewardDisclosure) fail("project.funding non-custodial policy is invalid");
  assertFundingAddresses(funding.addresses, "project.funding.addresses");
  return funding;
}

export interface Trusted {
  readonly escrow?: unknown;
  readonly securityBounty?: unknown;
}

interface DefinitionOptions {
  readonly trusted: Trusted;
  readonly historical: boolean;
}

const projectKeys = ["authority", "description", "eyebrow", "funding", "headline", "id", "links", "listingTier", "modelPolicy", "name", "repositories", "reviewSkill", "reward", "schemaVersion", "skill", "slug", "status", "steward", "terms"];
const optionalProjectKeys = ["image", "escrow", "participation", "rewardAsset", "contribution", "security", "securityBounty", "slopbot"];

const slopbotSettings = ["catchUpUntil", "intakeCap", "readyLabel", "submissionFee", "wantedIssues"] as const;
const submissionFeeMinor = /^[1-9][0-9]{0,15}$/u;
const submissionFeeMinMinor = 1_000_000n;
const submissionFeeMaxMinor = 10_000_000n;

function validateSubmissionFee(value: unknown, field: string): void {
  const fee = record(value, field);
  const keys = Object.keys(fee).sort().join(",");
  if (keys !== "enabled" && keys !== "amountMinor,enabled") fail(`${field} has unexpected or missing fields`);
  if (typeof fee.enabled !== "boolean") fail(`${field}.enabled must be a boolean`);
  if (fee.amountMinor !== undefined && (typeof fee.amountMinor !== "string" || !submissionFeeMinor.test(fee.amountMinor) || BigInt(fee.amountMinor) < submissionFeeMinMinor || BigInt(fee.amountMinor) > submissionFeeMaxMinor)) fail(`${field}.amountMinor must be a base-unit amount from ${submissionFeeMinMinor} to ${submissionFeeMaxMinor}`);
}

function validateSlopbot(value: unknown): void {
  const field = "project.slopbot";
  const slopbot = record(value, field);
  const settings = slopbotSettings.filter((key) => slopbot[key] !== undefined);
  const history = slopbot.catchUpHistory === undefined? []: ["catchUpHistory"];
  const consent = slopbot.automaticClosure === undefined ? [] : ["automaticClosure"];
    if (consent.length + history.length + settings.length === 0) fail(`${field} has unexpected or missing fields`);
    exactKeys(slopbot, [...consent,...history,...settings], field);
  if (slopbot.automaticClosure !== undefined && typeof slopbot.automaticClosure !== "boolean") fail(`${field}.automaticClosure must be a boolean`);
  const readyLabel = slopbot.readyLabel === undefined ? undefined : readyLabelProblem(slopbot.readyLabel, `${field}.readyLabel`);
  if (readyLabel !== undefined) fail(readyLabel);
  const { intakeCap } = slopbot;
  if (intakeCap !== undefined && (typeof intakeCap !== "number" || !Number.isSafeInteger(intakeCap) || intakeCap < minCap || intakeCap > maxCap)) fail(`${field}.intakeCap must be a whole number from ${minCap} to ${maxCap}`);
  if (slopbot.submissionFee !== undefined) validateSubmissionFee(slopbot.submissionFee, `${field}.submissionFee`);
  if (slopbot.wantedIssues !== undefined && typeof slopbot.wantedIssues !== "boolean") fail(`${field}.wantedIssues must be a boolean`);
  if (slopbot.catchUpUntil!== undefined &&!isExactUtc(slopbot.catchUpUntil)) fail(`${field}.catchUpUntil is invalid`);
  if (slopbot.catchUpHistory!== undefined) {
    const catchUpHistory = slopbot.catchUpHistory;
    if (!Array.isArray(catchUpHistory) || catchUpHistory.length === 0) fail(`${field}.catchUpHistory must be a nonempty array`);
    let previous = "";
    for (const entry of catchUpHistory) {
      if (!isRecord(entry) || Object.keys(entry).sort().join()!== "startedAt" ||!isExactUtc(entry.startedAt) || entry.startedAt <= previous) fail(`${field}.catchUpHistory must list UTC start dates in chronological order`);
      previous = entry.startedAt;
}
}
}

function validateSecurity(value: unknown): void {
  const field = "project.security";
  const security = record(value, field);
  exactKeys(security, security.reportDeposit === undefined ? [] : ["reportDeposit"], field);
  if (security.reportDeposit !== undefined && typeof security.reportDeposit !== "boolean") fail(`${field}.reportDeposit must be a boolean`);
}

function assertTrusted(project: Json, trusted: Trusted): void {
  if (project.escrow !== undefined && canonical(project.escrow) !== canonical(trusted.escrow)) fail("project.escrow changes only through vault setup, which records verified deployments");
  if (project.securityBounty !== undefined && canonical(project.securityBounty) !== canonical(trusted.securityBounty)) fail("project.securityBounty changes only through the security program, which validates its terms");
}

function validateProjectDefinition(value: unknown, { trusted, historical }: DefinitionOptions): Json {
  const project = record(value, "project");
  const legacyListing = historical && !("listingTier" in project);
  exactKeys(project, [...projectKeys.filter((key) => !legacyListing || key !== "listingTier"), ...optionalProjectKeys.filter((key) => Object.hasOwn(project, key))], "project");
  assertTrusted(project, trusted);
  const escrow = project.escrow === undefined ? undefined : record(project.escrow, "project.escrow");
  const reward = isRecord(project.reward) ? project.reward : undefined;
  if (escrow !== undefined) {
    if (reward?.kind !== "monthly-pool") fail("External prize shares must be funded and converted before escrow activation");
    if (reward.paymentMode !== "disabled") fail("Escrow migration cannot leave the legacy payment path enabled");
  }
  if (project.schemaVersion !== "1") fail("project schemaVersion is unsupported");
  const id = text(project.id, "project.id", { max: maxProjectIdLength, pattern: projectIdPattern });
  if (project.slug !== id) fail("project.slug must equal project.id");
  text(project.name, "project.name", { max: 80, min: 2 });
  text(project.eyebrow, "project.eyebrow", { max: 80, min: 3 });
  if (project.image !== undefined) assertProjectImage(project.image);
  text(project.headline, "project.headline", { max: 120, min: 8 });
  text(project.description, "project.description", { max: 600, min: 24 });
  if (project.contribution !== undefined) validateContribution(project.contribution);
  if (project.slopbot !== undefined) validateSlopbot(project.slopbot);
  if (project.security !== undefined) validateSecurity(project.security);
  if (!legacyListing && project.listingTier !== "featured" && project.listingTier !== "community" && project.listingTier !== "retired") fail("project.listingTier is invalid");
  if (project.status !== "active" && project.status !== "paused") fail("project.status is invalid");
  if (project.listingTier === "retired" && project.status !== "paused") fail("retired projects must stay paused");
  if (project.participation !== undefined) {
    const participation = record(project.participation, "project.participation");
    if (participation.state === "archived") {
      exactKeys(participation, ["state", "successorProjectId"], "project.participation");
      text(participation.successorProjectId, "project.participation.successorProjectId", { max: maxProjectIdLength, pattern: projectIdPattern });
      if (participation.successorProjectId === id) fail("archived project cannot be its own successor");
    } else if (participation.state === "permission-required") {
      exactKeys(participation, ["state"], "project.participation");
    } else {
      fail("project.participation.state is invalid");
    }
    if (project.status !== "paused") fail("restricted participation requires a paused project");
  }
  if (!Array.isArray(project.repositories) || project.repositories.length === 0 || project.repositories.length > 20) fail("project.repositories must contain 1 to 20 repositories");
  const repositories = project.repositories.map((entry: unknown, index: number) => validateRepository(entry, index));
  if (new Set(repositories.map((repository) => String(repository.id).toLowerCase())).size !== repositories.length) fail("project.repositories contains duplicates");
  const skill = validateSkill(project.skill, "project.skill", `contribute-to-${id}`, `/projects/${id}/skill.md`, historical);
  const reviewSkill = validateSkill(project.reviewSkill, "project.reviewSkill", `review-${id}-contributions`, undefined, historical);
  const rewardAsset = project.rewardAsset === undefined ? undefined : assertRewardAsset(project.rewardAsset);
  if (rewardAsset !== undefined && reward?.kind !== "monthly-pool") fail("project.rewardAsset requires a monthly pool");
  const generated = skill.sourcePath === contributorTemplate;
  if (generated !== (reviewSkill.sourcePath === reviewerTemplate) || (generated && project.contribution === undefined)) fail("generated project skills need both templates and project.contribution");
  const validReward = validateReward(project.reward, "project.reward", { allowLegacyExternalPrizeFee: historical, escrow, rewardAsset });
  validateFunding(project.funding, id);
  const bounty = isRecord(project.securityBounty) ? project.securityBounty : undefined;
  const privateVaults = list(isRecord(bounty?.settlement) ? bounty.settlement.deployments : undefined).filter(isRecord);
  for (const privateVault of escrow === undefined ? [] : privateVaults)
    if (list(escrow?.deployments).filter(isRecord).some((ordinary) => ordinary.network === privateVault.network && (privateVault.programId ? ordinary.vault === privateVault.vault : String(ordinary.vault).toLowerCase() === String(privateVault.vault).toLowerCase())))
      fail("Private bounties must use a separate vault so public totals reveal no private payments");
  if (validReward.fundingState === "committed" || (isRecord(validReward.reviewBudget) && validReward.reviewBudget.fundingState === "committed")) fail("project.reward committed funding is unsupported; fund the project escrow");
  const steward = validateSteward(project.steward);
  const primary = repositories[0] ?? fail("project.repositories must contain 1 to 20 repositories");
  const authority = validateAuthority(project.authority, primary);
  const seenGithubIds = new Set([String(authority.repositoryId)]);
  const seenNodeIds = new Set([String(authority.repositoryNodeId)]);
  repositories.forEach((repository, index) => {
    if (index === 0 || repository.githubId === undefined) return;
    if (seenGithubIds.has(String(repository.githubId))) fail(`project.repositories[${index}].githubId duplicates another repository`);
    if (seenNodeIds.has(String(repository.nodeId))) fail(`project.repositories[${index}].nodeId duplicates another repository`);
    seenGithubIds.add(String(repository.githubId));
    seenNodeIds.add(String(repository.nodeId));
  });
  const terms = validateTerms(project.terms, primary, validReward, steward, { allowLegacyUnsupportedOwnershipClaim: historical });
  const receiptPolicy = record(terms.receiptPolicy, "project.terms.receiptPolicy");
  if (project.status === "active" && authority.state !== "verified" && (receiptPolicy.state !== "pending-authority-activation" || validReward.paymentMode !== "disabled")) fail("active projects without verified repository authority require pending receipts and disabled payments");
  if (project.status === "active" && authority.state === "verified" && (receiptPolicy.state !== "active" || receiptPolicy.activatedAt !== record(authority.proof, "project.authority.proof").verifiedAt)) fail("active projects require receipt cutover at the immutable authority activation");
  if (project.status === "active" && authority.state === "verified" && (record(terms.inbound, "project.terms.inbound").mode === "unknown" || record(terms.repositoryLicense, "project.terms.repositoryLicense").state === "unknown" || (validReward.kind === "external-prize-share" && isRecord(terms.externalPrize) && terms.externalPrize.version === "unknown"))) fail("active projects require known mandatory terms");
  const modelPolicy = record(project.modelPolicy, "project.modelPolicy");
  exactKeys(modelPolicy, ["disclosureRequired", "mode"], "project.modelPolicy");
  if (modelPolicy.mode !== "open-declared" || modelPolicy.disclosureRequired !== true) fail("project.modelPolicy must allow every declared model and require disclosure");
  const links = record(project.links, "project.links");
  if (!Object.hasOwn(links, "repository") || !Object.hasOwn(links, "issues")) fail("project.links must include repository and issues");
  for (const [name, link] of Object.entries(links)) {
    text(name, "project link name", { max: 40, pattern: /^[a-z][a-z0-9-]*$/u });
    const checked = url(link, `project.links.${name}`, name === "x" ? "https://x.com" : undefined);
    if (name === "x" && (URL.parse(checked)?.search !== "" || !/^\/[A-Za-z0-9_]{1,15}$/u.test(pathOf(checked)))) fail("project.links.x must be an X profile URL");
  }
  return project;
}

function ownSections(value: unknown): Trusted {
  return isRecord(value) ? { escrow: value.escrow, securityBounty: value.securityBounty } : {};
}

/** @throws {never} */
export function definitionProblem(value: unknown, trusted: Trusted): string | undefined {
    return problemOf(() => {
    const slopbot = isRecord(value) && isRecord(value.slopbot)? value.slopbot: undefined;
    const until = typeof slopbot?.catchUpUntil === "string"? Math.floor(Date.parse(slopbot.catchUpUntil) / hourMs): 0;
    const history = (Array.isArray(slopbot?.catchUpHistory)? slopbot.catchUpHistory: []).map((entry) => (isRecord(entry) && typeof entry.startedAt === "string"? Math.floor(Date.parse(entry.startedAt) / hourMs): 0));
    if (catchUpRefused(until, history)) fail("catch_up_refused");
    validateProjectDefinition(value, { trusted, historical: false});
});
}

/** @throws {never} */
export function historicalDefinitionProblem(value: unknown, trusted: Trusted): string | undefined {
  return problemOf(() => validateProjectDefinition(value, { trusted, historical: true }));
}

function strictStored(value: unknown): Json {
  return validateProjectDefinition(value, { trusted: ownSections(value), historical: false });
}

/** @throws {never} */
export function registryProblem(values: ReadonlyArray<unknown>): string | undefined {
  return problemOf(() => {
    if (values.length > 100) fail("project registry must contain 0 to 100 projects");
    const projects = values.map(strictStored);
    if (projects.filter((project) => isRecord(project.skill) && project.skill.publishAtRoot === true).length > 1) fail("project registry must declare at most one root-published contributor skill");
    const repositories = (project: Json) => list(project.repositories).filter(isRecord).flatMap((repository) => repositoryIdentities(repository).map((path) => path.toLowerCase()));
    const groups: ReadonlyArray<readonly [string, ReadonlyArray<unknown>]> = [
      ["ids", projects.map((project) => project.id)],
      ["contributor skills", projects.map((project) => record(project.skill, "project.skill").id)],
      ["review skills", projects.map((project) => record(project.reviewSkill, "project.reviewSkill").id)],
      ["repositories", projects.flatMap(repositories)],
    ];
    for (const [field, entries] of groups) if (new Set(entries).size !== entries.length) fail(`project registry contains duplicate ${field}`);
    for (const project of projects)
      for (const repositoryId of list(project.repositories).filter(isRecord).flatMap(repositoryIdentities)) {
        const legacyId = legacyHolder(repositoryId);
        if (legacyId !== undefined && legacyId !== project.id) fail(`project registry lists ${repositoryId} under id ${String(project.id)}; contributor history keeps it under id ${legacyId}`);
      }
    for (const project of projects) {
      const participation = isRecord(project.participation) ? project.participation : undefined;
      if (participation?.state === "archived" && !projects.some((candidate) => candidate.id === participation.successorProjectId)) fail("archived project successor is not in the project registry");
    }
  });
}

function assertFundingRouteTransition(previousRoutes: ReadonlyArray<Json>, nextRoutes: ReadonlyArray<Json>): void {
  if (nextRoutes.length < previousRoutes.length || nextRoutes.length > previousRoutes.length + 1) fail("funding history must remain an append-only prefix with at most one successor");
  let closedIndex: number | null = null;
  previousRoutes.forEach((previous, index) => {
    const next = nextRoutes[index];
    if (next === undefined || previous.network !== next.network || previous.asset !== next.asset || previous.address !== next.address || previous.effectiveAt !== next.effectiveAt) fail("historical funding routes must remain an exact append-only prefix");
    if (previous.replacedAt !== null) {
      if (previous.replacedAt !== next.replacedAt) fail("closed funding routes are immutable");
    } else if (next.replacedAt !== null) {
      if (closedIndex !== null) fail("a transition may close at most one funding route");
      closedIndex = index;
    }
  });
  const successor = nextRoutes[previousRoutes.length];
  if (successor === undefined) {
    if (closedIndex !== null) fail("an active funding route may close only with a successor");
    return;
  }
  if (successor.replacedAt !== null) fail("an appended funding successor must be active");
  const activePredecessor = previousRoutes.findIndex((route) => route.network === successor.network && route.asset === successor.asset && route.replacedAt === null);
  if (activePredecessor === -1) {
    if (closedIndex !== null) fail("a funding successor must rotate the closed route");
    return;
  }
  if (closedIndex !== activePredecessor || nextRoutes[activePredecessor]?.replacedAt !== successor.effectiveAt) fail("a funding rotation must close its active predecessor exactly when its successor starts");
}

function assertRepositoryTransition(previousRepositories: ReadonlyArray<Json>, nextRepositories: ReadonlyArray<Json>): void {
  if (nextRepositories.length < previousRepositories.length) fail("repository inventory cannot change");
  for (const added of nextRepositories.slice(previousRepositories.length))
    if (added.githubId === undefined || added.nodeId === undefined || added.countsFrom === undefined || added.aliases !== undefined) fail("an appended repository needs githubId, nodeId and countsFrom and no aliases");
  previousRepositories.forEach((previous, index) => {
    const next = nextRepositories[index] ?? {};
    if (previous.githubId !== next.githubId || previous.nodeId !== next.nodeId || previous.countsFrom !== next.countsFrom) fail("repository githubId, nodeId and countsFrom are immutable once published");
    const previousAliases = list(previous.aliases).map(String);
    const nextAliases = list(next.aliases).map(String);
    if (previous.id !== next.id || previous.integrationBranch !== next.integrationBranch || previous.description !== next.description) fail("repository transfer, rename, or integration-branch drift requires a new project review");
    if (nextAliases.length < previousAliases.length || nextAliases.length > previousAliases.length + 1 || previousAliases.some((alias, aliasIndex) => alias.toLowerCase() !== nextAliases[aliasIndex]?.toLowerCase())) fail("repository aliases must remain an append-only prefix with at most one transfer per review");
    if (nextAliases.length === previousAliases.length) {
      if (canonical(previous) !== canonical(next)) fail("repository metadata may change only with an appended transfer alias");
      return;
    }
    const alias = nextAliases.at(-1) ?? "";
    const currentPath = pathOf(String(next.githubUrl)).replace(/^\//u, "").replace(/\/$/u, "");
    if (alias.toLowerCase() !== currentPath.toLowerCase() || String(next.displayName).toLowerCase() !== alias.toLowerCase()) fail("a repository transfer must publish its appended alias as the current repository identity");
  });
}

function bindingTerms(terms: Json): string {
  const prize = isRecord(terms.externalPrize) ? terms.externalPrize : undefined;
  return canonical({
    policyRevision: terms.revision,
    licenseSha256: record(terms.repositoryLicense, "project.terms.repositoryLicense").fileSha256,
    inboundTermsSha256: record(terms.inbound, "project.terms.inbound").fileSha256,
    prizeRulesSha256: prize?.rulesSha256 ?? null,
  });
}

const evmImplementationReviewKeys = ["authority", "vaultImplementation", "vaultImplementationCodeSha256", "factoryImplementation", "factoryImplementationCodeSha256"];
const offChainDeploymentKeys = ["maxNativeCostWei", "bindingConsentNonceLimit"];

function implementationReview(review: unknown): string {
  const fields = isRecord(review) ? review : {};
  return JSON.stringify(evmImplementationReviewKeys.map((key) => String(fields[key] ?? "").toLowerCase()));
}

function assertEvmUpgradeHistory(previous: Json, next: Json): void {
  const before = list(previous.history);
  const after = list(next.history);
  const changed = implementationReview(previous) !== implementationReview(next);
  if (after.length !== before.length + (changed ? 1 : 0) || before.some((entry, index) => JSON.stringify(entry) !== JSON.stringify(after[index])) || (changed && implementationReview(after[before.length]) !== implementationReview(previous))) fail("Reviewed EVM upgrade history must append the outgoing implementation");
}

function deploymentKeyChanged(deployment: Json, successor: Json, key: string): boolean {
  if (offChainDeploymentKeys.includes(key)) return false;
  if (isRecord(deployment.evmUpgrade) && isRecord(successor.evmUpgrade) && ["evmUpgrade", "sourceCommit", "deploymentTransaction"].includes(key)) return false;
  if (Boolean(deployment.programId) && deployment.upgradeAuthority !== null && ["codeSha256", "upgradeAuthority", "sourceCommit", "deploymentTransaction"].includes(key)) return false;
  return key === "evmUpgrade" ? JSON.stringify(deployment[key]) !== JSON.stringify(successor[key]) : deployment[key] !== successor[key];
}

function assertEscrowTransition(previousValue: unknown, nextValue: unknown, allowUnfundedChange: boolean): void {
  const previous = isRecord(previousValue) ? previousValue : undefined;
  const next = isRecord(nextValue) ? nextValue : undefined;
  const before = list(previous?.deployments).filter(isRecord);
  for (const deployment of list(next?.deployments).filter(isRecord))
    if (isRecord(deployment.evmUpgrade) && deployment.evmUpgrade.history !== undefined && !before.some((candidate) => candidate.network === deployment.network)) fail("A new escrow deployment cannot carry reviewed EVM upgrade history");
  if (previous === undefined) return;
  if (next === undefined || ((!allowUnfundedChange || before.length > 0) && (previous.chain !== next.chain || previous.effectiveCycle !== next.effectiveCycle)) || previous.feeMode !== next.feeMode || previous.feeBasisPoints !== next.feeBasisPoints || previous.withdrawalFeeBasisPoints !== next.withdrawalFeeBasisPoints) fail("An escrow project's settlement chain and fee policy cannot change");
  const after = list(next.deployments).filter(isRecord);
  for (const deployment of before) {
    const successor = after.find((candidate) => candidate.network === deployment.network);
    if (successor === undefined || isRecord(deployment.evmUpgrade) !== isRecord(successor.evmUpgrade) || Object.keys(deployment).some((key) => deploymentKeyChanged(deployment, successor, key))) fail("Historical escrow deployments are immutable");
    if (isRecord(deployment.evmUpgrade) && isRecord(successor.evmUpgrade)) assertEvmUpgradeHistory(deployment.evmUpgrade, successor.evmUpgrade);
  }
}

function assertSecurityBountyTransition(previousValue: unknown, nextValue: unknown): void {
  const previous = isRecord(previousValue) ? previousValue : undefined;
  const next = isRecord(nextValue) ? nextValue : undefined;
  const settlement = isRecord(previous?.settlement) ? previous.settlement : undefined;
  if (!(settlement !== undefined && list(settlement.deployments).length === 0 && next?.settlement === undefined)) assertEscrowTransition(settlement, next?.settlement, false);
  if (previous !== undefined && next === undefined) fail("a security bounty program cannot be removed; close it instead");
}

function assertPolicyTransition(previousValue: unknown, nextValue: unknown, trusted: Trusted): void {
  const previous = validateProjectDefinition(previousValue, { trusted: ownSections(previousValue), historical: true });
  const next = validateProjectDefinition(nextValue, { trusted, historical: false });
  if (previous.id !== next.id) fail("project id cannot change");
  const previousFunding = record(previous.funding, "project.funding");
  const nextFunding = record(next.funding, "project.funding");
  const previousReward = record(previous.reward, "project.reward");
  const unfundedMonthly = previousReward.kind === "monthly-pool" && previousReward.fundingState !== "committed" && BigInt(String(previousReward.committedMinor)) === 0n && previousReward.paymentMode !== "enabled" && list(isRecord(previous.escrow) ? previous.escrow.deployments : undefined).length === 0 && list(previousFunding.addresses).length === 0 && list(previousFunding.commitments).length === 0;
  assertEscrowTransition(previous.escrow, next.escrow, unfundedMonthly);
  assertSecurityBountyTransition(previous.securityBounty, next.securityBounty);
  assertFundingRouteTransition(list(previousFunding.addresses).filter(isRecord), list(nextFunding.addresses).filter(isRecord));
  const previousAuthority = record(previous.authority, "project.authority");
  const nextAuthority = record(next.authority, "project.authority");
  if (previousAuthority.repositoryId !== nextAuthority.repositoryId || previousAuthority.repositoryNodeId !== nextAuthority.repositoryNodeId) fail("repository transfer, rename, or integration-branch drift requires a new project review");
  assertRepositoryTransition(list(previous.repositories).filter(isRecord), list(next.repositories).filter(isRecord));
  const previousTerms = record(previous.terms, "project.terms");
  const nextTerms = record(next.terms, "project.terms");
  const previousPolicy = record(previousTerms.receiptPolicy, "project.terms.receiptPolicy");
  const nextPolicy = record(nextTerms.receiptPolicy, "project.terms.receiptPolicy");
  const previousBindings = list(previousPolicy.bindings);
  const nextBindings = list(nextPolicy.bindings);
  const initialActivation = previousPolicy.state === "pending-authority-activation" && nextPolicy.state === "active";
  if (initialActivation && (nextAuthority.state !== "verified" || nextBindings.length !== 1 || nextPolicy.activatedAt !== record(nextAuthority.proof, "project.authority.proof").verifiedAt)) fail("receipt policy activation requires exactly one first binding at authority verification");
  if (previousPolicy.state === "active") {
    if (nextPolicy.state !== "active") fail("active receipt policy cannot revert to pending");
    if (previousPolicy.activatedAt !== nextPolicy.activatedAt) fail("receipt policy cutover activation is immutable");
    if (nextBindings.length < previousBindings.length || previousBindings.some((binding, index) => canonical(binding) !== canonical(nextBindings[index]))) fail("historical receipt policy bindings must remain an exact append-only prefix");
    const appended = nextBindings.length - previousBindings.length;
    if (appended > 1) fail("receipt policy transition may append at most one binding");
    if ((bindingTerms(previousTerms) !== bindingTerms(nextTerms)) !== (appended === 1)) fail("receipt policy binding append must exactly match a binding-relevant terms change");
  }
  const material = (project: Json, terms: Json) => canonical({ steward: project.steward, terms: Object.fromEntries(Object.entries(terms).filter(([key]) => key !== "receiptPolicy")) });
  if (material(previous, previousTerms) !== material(next, nextTerms) && previousTerms.revision === nextTerms.revision && !initialActivation) fail("material terms drift requires a new revision");
  if (nextAuthority.state === "verified" && record(nextAuthority.proof, "project.authority.proof").policyRevision !== nextTerms.revision) fail("repository proof does not bind the current policy revision");
}

function exclusionsOf(project: unknown): ReadonlyArray<Exclusion> {
  const reward = isRecord(project) && isRecord(project.reward) ? project.reward : undefined;
  return list(reward?.payoutExclusions).filter(isRecord).map((entry) => ({ actorId: String(entry.actorId), nodeId: String(entry.nodeId), relationship: String(entry.relationship), fromCycle: String(entry.fromCycle), untilCycle: typeof entry.untilCycle === "string" ? entry.untilCycle : null }));
}

function excludedSet(exclusions: ReadonlyArray<Exclusion>, cycleId: string): string {
  return exclusions.filter((entry) => entry.fromCycle <= cycleId && (entry.untilCycle === null || cycleId < entry.untilCycle)).map((entry) => `${entry.nodeId}\0${entry.actorId}\0${entry.relationship}`).sort().join("\n");
}

function nextCycle(cycleId: string): string {
  const year = Number(cycleId.slice(0, 4));
  const month = Number(cycleId.slice(5, 7));
  return month === 12 ? `${String(year + 1).padStart(4, "0")}-01` : `${cycleId.slice(0, 4)}-${String(month + 1).padStart(2, "0")}`;
}

function assertPayoutExclusionTransition(previous: unknown, next: unknown, nowIso: string): void {
  const before = exclusionsOf(previous);
  const after = exclusionsOf(next);
  const openCycle = nowIso.slice(0, 7);
  const first = [...before, ...after].map((entry) => entry.fromCycle).sort()[0];
  if (first === undefined) return;
  for (let cycleId = first; cycleId <= openCycle; cycleId = nextCycle(cycleId)) if (excludedSet(before, cycleId) !== excludedSet(after, cycleId)) fail(`payout exclusions apply prospectively; ${cycleId} cannot change`);
}

function assertCatchUpTransition(previous: unknown, next: unknown, nowIso: string): void {
  const previousSlopbot = isRecord(previous) && isRecord(previous.slopbot)? previous.slopbot: undefined;
  const nextSlopbot = isRecord(next) && isRecord(next.slopbot)? next.slopbot: undefined;
  if (canonical(previousSlopbot?.catchUpHistory)!== canonical(nextSlopbot?.catchUpHistory)) fail("project.slopbot.catchUpHistory is written by the server only");
  const previousUntil = typeof previousSlopbot?.catchUpUntil === "string"? previousSlopbot.catchUpUntil: undefined;
  const nextUntil = typeof nextSlopbot?.catchUpUntil === "string"? nextSlopbot.catchUpUntil: undefined;
  if (nextUntil === undefined || nextUntil === previousUntil) return;
  const nowHours = Math.floor(Date.parse(nowIso) / hourMs);
  const untilHours = Math.floor(Date.parse(nextUntil) / hourMs);
  const nowMonth = Number(nowIso.slice(0, 4) + nowIso.slice(5, 7));
  const starts = list(nextSlopbot?.catchUpHistory).filter(isRecord).map((entry) => entry.startedAt).filter((startedAt): startedAt is string => typeof startedAt === "string");
  const lastStart = starts.length === 0? undefined: starts[starts.length - 1];
  const lastStartMonth = lastStart === undefined? 0: Number(lastStart.slice(0, 4) + lastStart.slice(5, 7));
  if (previousUntil!== undefined && Date.parse(previousUntil) > Date.parse(nowIso)) {
    if (untilHours <= Math.floor(Date.parse(previousUntil) / hourMs)) return;
    const startedAtHours = lastStart === undefined? nowHours: Math.floor(Date.parse(lastStart) / hourMs);
    if (!catchUpCanMove(startedAtHours, untilHours, nowHours)) fail("project.slopbot.catchUpUntil cannot move a running pause past fourteen days from its start");
    return;
  }
  if (!catchUpCanStart(untilHours, nowHours, lastStartMonth, nowMonth)) fail("project.slopbot.catchUpUntil must start a pause at most fourteen days ahead and at most once per UTC month");
}

/** @throws {never} */
export function transitionProblem(previous: unknown, next: unknown, nowIso: string, trusted: Trusted = ownSections(previous)): string | undefined {
  return problemOf(() => {
    assertPolicyTransition(previous, next, trusted);
    assertPayoutExclusionTransition(previous, next, nowIso);
    assertCatchUpTransition(previous, next, nowIso);
  });
}
