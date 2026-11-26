// spec/frontend/projectLinks.md, "The project page names each vault network once, with its asset only when every vault on it agrees, and shows the website and X account only when present"; spec/backend/projects.md, "Owner revisions publish at once against the expected revision"
import { EVM_NATIVE_ASSET, isNetworkKey, NETWORKS, SOLANA_NATIVE_ASSET } from "@repo/settlement/kernels/networks";
import { projectNetworks, type VaultNetwork } from "../../gen/frontend__projectLinks.ts";
import { CHAIN_NAMES } from "./assetText.ts";

export type LinkInput = { readonly ok: true; readonly value: string | null } | { readonly ok: false; readonly error: string };

export interface VaultDeployment {
  readonly network: string;
  readonly asset?: string;
}

export interface ChainProject {
  readonly escrow?: { readonly deployments: ReadonlyArray<VaultDeployment> };
  readonly securityBounty?: { readonly settlement?: { readonly deployments: ReadonlyArray<VaultDeployment> } };
  readonly rewardAsset?: { readonly network: string; readonly address: string; readonly symbol: string };
}

export interface ProjectChain {
  readonly name: string;
  readonly symbol: string | null;
}

export const maxLinkLength = 500;

const xHandlePattern = /^[A-Za-z0-9_]{1,15}$/u;

const xHosts: ReadonlySet<string> = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com"]);

const schemePattern = /^[a-z][a-z0-9+.-]*:/iu;

const xError = "Enter an X handle such as @slopcash, or its x.com link.";

const withScheme = (text: string) => (schemePattern.test(text) ? text : `https://${text}`);

/** An X account as an owner types it (`@handle`, `handle`, or an x.com or twitter.com profile link), stored as `https://x.com/<handle>`; empty is none. @throws {never} */
export function normalizeXInput(input: string): LinkInput {
  const text = input.trim();
  if (text === "") return { ok: true, value: null };
  const handle = text.startsWith("@") ? text.slice(1) : text;
  if (xHandlePattern.test(handle)) return { ok: true, value: `https://x.com/${handle}` };
  const parsed = URL.parse(withScheme(text));
  if (parsed === null) return { ok: false, error: xError };
  const name = parsed.pathname.replace(/\/$/u, "").slice(1);
  const profile =
    (parsed.protocol === "https:" || parsed.protocol === "http:") &&
    xHosts.has(parsed.hostname.toLowerCase()) &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.port === "" &&
    parsed.search === "" &&
    parsed.hash === "" &&
    xHandlePattern.test(name);
  return profile ? { ok: true, value: `https://x.com/${name}` } : { ok: false, error: xError };
}

/** A website as an owner types it: a bare domain gains `https://`; another scheme, credentials or a `#section` are refused; empty is none. @throws {never} */
export function normalizeWebsiteInput(input: string): LinkInput {
  const text = input.trim();
  if (text === "") return { ok: true, value: null };
  const value = withScheme(text);
  const parsed = URL.parse(value);
  if (parsed === null) return { ok: false, error: "Enter a website address." };
  if (parsed.protocol !== "https:") return { ok: false, error: "Use an https:// address." };
  const refused = value.length > maxLinkLength || parsed.username !== "" || parsed.password !== "" || parsed.hash !== "" || !parsed.hostname.includes(".") || /\s/u.test(value);
  return refused ? { ok: false, error: `Enter an https:// address of at most ${maxLinkLength} characters, without a #section.` } : { ok: true, value };
}

/** The handle of a stored `https://x.com/<handle>` link, else null. @throws {never} */
export function xHandle(url: string | undefined): string | null {
  const parsed = url ? URL.parse(url) : null;
  const name = parsed?.pathname.slice(1) ?? "";
  return parsed?.origin === "https://x.com" && xHandlePattern.test(name) ? name : null;
}

/** A stored X link as the owner's form shows it: `@handle`, else the stored text. @throws {never} */
export function xInputValue(url: string | undefined): string {
  const handle = xHandle(url);
  return handle ? `@${handle}` : (url ?? "");
}

/** `links` with the website and X account set or removed; every other named link stays as it was. @throws {never} */
export function withOwnerLinks(links: Readonly<Record<string, string>>, website: string | null, x: string | null): Record<string, string> {
  const rest = Object.entries(links).filter(([name]) => name !== "website" && name !== "x");
  return Object.fromEntries<string>([...rest, ...(website ? ([["website", website]] as const) : []), ...(x ? ([["x", x]] as const) : [])]);
}

function sameAddress(family: "evm" | "solana", left: string, right: string): boolean {
  return family === "evm" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** @throws {never} */
function vaultNetwork(project: ChainProject, deployment: VaultDeployment): VaultNetwork[] {
  if (!isNetworkKey(deployment.network)) return [];
  const network = NETWORKS[deployment.network];
  const asset = deployment.asset ?? "";
  const own = project.rewardAsset;
  const native = network.family === "solana" ? { address: SOLANA_NATIVE_ASSET, symbol: "SOL" } : { address: EVM_NATIVE_ASSET, symbol: "ETH" };
  const symbol = asset === ""
    ? ""
    : ((sameAddress(network.family, asset, native.address) ? native.symbol : undefined) ??
      network.assets.find((entry) => sameAddress(network.family, entry.address, asset))?.symbol ??
      (own !== undefined && own.network === network.chain && sameAddress(network.family, own.address, asset) ? own.symbol : ""));
  return [{ network: network.testnet ? `${CHAIN_NAMES[network.chain]} testnet` : CHAIN_NAMES[network.chain], symbol }];
}

/** The networks of the recorded vaults (monthly pool, then private bounty), each once, with its asset symbol when every vault on it agrees. @throws {never} */
export function projectChains(project: ChainProject): ProjectChain[] {
  const deployments = [...(project.escrow?.deployments ?? []), ...(project.securityBounty?.settlement?.deployments ?? [])];
  return projectNetworks(deployments.flatMap((deployment) => vaultNetwork(project, deployment))).map(({ network, symbol }) => ({ name: network, symbol: symbol === "" ? null : symbol }));
}

/** A website as the project page shows it: host without `www.`, then the path unless it is `/`, then the query. @throws {never} */
export function websiteLabel(url: string): string {
  const parsed = URL.parse(url);
  if (parsed === null) return url;
  return `${parsed.host.replace(/^www\./u, "")}${parsed.pathname === "/" ? "" : parsed.pathname}${parsed.search}`;
}
