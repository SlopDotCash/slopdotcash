/**
 * A project's public links and chain (operator decision, 16 November 2026):
 * the project page shows the vault network, website and X account when
 * present, and owners set the website and X account themselves. `links` is a
 * presentation field, so an owner revision publishes it at once.
 *
 * The rules match `validateProjectDefinition` in project-schema.mjs: every
 * link is an https URL of at most 500 characters with no credentials or
 * fragment, and `links.x` is exactly `https://x.com/<handle>`.
 */
import { ESCROW_NETWORKS } from "./escrow-policy.mjs";
import type { ProjectDefinition } from "./projects.mjs";
import { NETWORK_NAMES } from "./reward-asset.mjs";

const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/u;
const X_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
]);
const MAX_URL = 500;

export type LinkInput =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

/**
 * An X account as typed by an owner: `@handle`, `handle`, or a profile URL
 * on x.com or twitter.com. Empty means no X link. The stored form is always
 * `https://x.com/<handle>`.
 */
export function normalizeXInput(input: string): LinkInput {
  const text = input.trim();
  if (text === "") return { ok: true, value: null };
  const handle = text.startsWith("@") ? text.slice(1) : text;
  if (X_HANDLE.test(handle))
    return { ok: true, value: `https://x.com/${handle}` };
  const error = "Enter an X handle such as @slopcash, or its x.com link.";
  let parsed: URL;
  try {
    parsed = new URL(
      /^[a-z][a-z0-9+.-]*:/iu.test(text) ? text : `https://${text}`,
    );
  } catch {
    return { ok: false, error };
  }
  const path = parsed.pathname.replace(/\/$/u, "");
  const name = path.slice(1);
  if (
    !["https:", "http:"].includes(parsed.protocol) ||
    !X_HOSTS.has(parsed.hostname.toLowerCase()) ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash ||
    !X_HANDLE.test(name)
  )
    return { ok: false, error };
  return { ok: true, value: `https://x.com/${name}` };
}

/**
 * A website as typed by an owner. A bare domain gets `https://`; any other
 * scheme, credentials or a `#fragment` are refused. Empty means no website.
 */
export function normalizeWebsiteInput(input: string): LinkInput {
  const text = input.trim();
  if (text === "") return { ok: true, value: null };
  const value = /^[a-z][a-z0-9+.-]*:/iu.test(text) ? text : `https://${text}`;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, error: "Enter a website address." };
  }
  if (parsed.protocol !== "https:")
    return { ok: false, error: "Use an https:// address." };
  if (
    value.length > MAX_URL ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    !parsed.hostname.includes(".") ||
    /\s/u.test(value)
  )
    return {
      ok: false,
      error: `Enter an https:// address of at most ${MAX_URL} characters, without a #section.`,
    };
  return { ok: true, value };
}

/** The handle of a stored `https://x.com/<handle>` link, else null. */
export function xHandle(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.slice(1);
    return parsed.origin === "https://x.com" && X_HANDLE.test(name)
      ? name
      : null;
  } catch {
    return null;
  }
}

/** A stored X link as the owner's form shows it: `@handle`. */
export function xInputValue(url: string | undefined): string {
  const handle = xHandle(url);
  return handle ? `@${handle}` : (url ?? "");
}

/**
 * `links` with the website and X account set or removed. Repository, issues
 * and any other named link stay exactly as they were.
 */
export function withOwnerLinks(
  links: Readonly<Record<string, string>>,
  website: string | null,
  x: string | null,
): Record<string, string> {
  const { website: _website, x: _x, ...rest } = links;
  return {
    ...rest,
    ...(website ? { website } : {}),
    ...(x ? { x } : {}),
  };
}

export type ProjectChain = { name: string; symbol: string | null };

/**
 * The networks of the project's recorded vaults (monthly pool and private
 * bounty), each with its payout asset symbol when Slop knows it. Empty when
 * no vault is recorded.
 */
export function projectChains(project: ProjectDefinition): ProjectChain[] {
  const deployments = [
    ...(project.escrow?.deployments ?? []),
    ...(project.securityBounty?.settlement?.deployments ?? []),
  ];
  const chains: ProjectChain[] = [];
  for (const deployment of deployments) {
    const network = ESCROW_NETWORKS[deployment.network];
    if (!network) continue;
    const base = NETWORK_NAMES[network.chain] ?? network.chain;
    const name = network.testnet ? `${base} testnet` : base;
    const asset = deployment.asset.toLowerCase();
    const symbol =
      network.assets.find((entry) => entry.address.toLowerCase() === asset)
        ?.symbol ??
      (project.rewardAsset &&
      project.rewardAsset.network === network.chain &&
      project.rewardAsset.address.toLowerCase() === asset
        ? project.rewardAsset.symbol
        : null);
    const existing = chains.find((entry) => entry.name === name);
    if (!existing) chains.push({ name, symbol });
    else if (existing.symbol !== symbol) existing.symbol = null;
  }
  return chains;
}

/** A website link as the project page shows it: host and path, no scheme. */
export function websiteLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host.replace(/^www\./u, "")}${path}${parsed.search}`;
  } catch {
    return url;
  }
}
