import { fetchWithDeadline, readBoundedJson } from "./browser-json";
import {
  formatMonthlyCapDisplay,
  MAX_MONTHLY_CAP_MINOR,
} from "./project-schema.mjs";
import { PROJECTS, type ProjectDefinition } from "./projects.mjs";
import { sha256Hex } from "./sha256";
export function rootPublishedTemplateProject(
  projects: readonly ProjectDefinition[] = PROJECTS,
): ProjectDefinition {
  const publishers = projects.filter(
    (project) => project.skill.publishAtRoot === true,
  );
  if (publishers.length !== 1) {
    throw new TypeError(
      "project registry must declare exactly one root-published template skill",
    );
  }
  return publishers[0];
}

export const ROOT_PUBLISHED_TEMPLATE = rootPublishedTemplateProject();

export function safeProposalHttpsUrl(value: string): boolean {
  if (value.length === 0 || value.length > 500) return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.length > 0 &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}

export function immutableProposalTermsUrl(
  value: string,
  repository: string,
  commit: string,
): boolean {
  if (!safeProposalHttpsUrl(value)) return false;
  const parsed = new URL(value);
  const prefix = `/${repository}/blob/${commit}/`;
  return (
    parsed.origin === "https://github.com" &&
    !parsed.search &&
    parsed.pathname.startsWith(prefix) &&
    parsed.pathname.length > prefix.length
  );
}

const GITHUB_REPOSITORY_LINK =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s?#]+)\/([^/\s?#]+?)(?:\.git)?(?:\/[^\s]*)?(?:[?#][^\s]*)?$/iu;
const GITHUB_REPOSITORY_SSH =
  /^(?:ssh:\/\/)?git@github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/iu;
const REPOSITORY_PATH = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

/**
 * Turns a pasted github.com link (https, bare host, ssh, with .git, a
 * trailing slash, a deeper path, a query or a hash) into the owner/name form
 * the project manifest requires. Anything that is not a github.com link is
 * only trimmed, so a wrong value stays visible instead of being guessed.
 */
export function normalizeRepositoryInput(value: string): string {
  const trimmed = value.trim();
  const match =
    GITHUB_REPOSITORY_LINK.exec(trimmed) ?? GITHUB_REPOSITORY_SSH.exec(trimmed);
  return match ? `${match[1]}/${match[2]}` : trimmed;
}

export function validRepositoryPath(value: string): boolean {
  return value.length <= 201 && REPOSITORY_PATH.test(value);
}

export function boundedText(
  value: string,
  minimum: number,
  maximum: number,
): boolean {
  const length = value.trim().length;
  return length >= minimum && length <= maximum;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 48);
}

export function monthlyPoolValue(value: string): {
  display: string;
  minor: string;
  valid: boolean;
} {
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/u.test(value)) {
    return { display: "$0", minor: "0", valid: false };
  }
  const [whole, fraction = ""] = value.split(".");
  const minor = (
    BigInt(whole) * 1_000_000n +
    BigInt(fraction.padEnd(2, "0")) * 10_000n
  ).toString();
  if (BigInt(minor) > MAX_MONTHLY_CAP_MINOR) {
    return { display: "$0", minor: "0", valid: false };
  }
  return {
    display: formatMonthlyCapDisplay(minor),
    minor,
    valid: true,
  };
}

export interface RepositoryLookup {
  repository: string;
  numericId: string;
  nodeId: string;
  defaultBranch: string;
  owner: {
    login: string;
    actorId: string;
    nodeId: string;
    kind: "individual" | "organization";
  };
  license:
    | { state: "verified"; spdx: string; commitSha: string; fileSha256: string }
    | { state: "unknown"; reason: string };
}

async function githubJson(path: string, signal: AbortSignal) {
  const response = await fetchWithDeadline(`https://api.github.com${path}`, {
    credentials: "omit",
    headers: { Accept: "application/vnd.github+json" },
    signal,
  });
  if (response.status === 404) return null;
  if (response.status === 403 || response.status === 429)
    throw new Error(
      "GitHub limited lookups from this network. Try again later or enter the facts by hand.",
    );
  if (!response.ok) throw new Error(`GitHub returned ${response.status}.`);
  const value = await readBoundedJson(response, 512 * 1024, "GitHub lookup");
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("GitHub returned an unexpected response.");
  return value as Record<string, unknown>;
}

function unknownLicense(
  facts: Omit<RepositoryLookup, "license">,
  reason: string,
): RepositoryLookup {
  return { ...facts, license: { state: "unknown", reason } };
}

/**
 * Reads public repository facts from GitHub without credentials. A failed or
 * partial lookup never fills a fact: unknown license terms stay unknown.
 */
export async function lookupGitHubRepository(
  repository: string,
  signal: AbortSignal,
): Promise<RepositoryLookup> {
  const repo = await githubJson(`/repos/${repository}`, signal);
  if (!repo) throw new Error("GitHub has no public repository with that name.");
  const owner = repo.owner as Record<string, unknown> | undefined;
  if (
    repo.private !== false ||
    !Number.isSafeInteger(repo.id) ||
    typeof repo.node_id !== "string" ||
    !/^[A-Za-z0-9_=-]{1,100}$/u.test(repo.node_id) ||
    typeof repo.full_name !== "string" ||
    !validRepositoryPath(repo.full_name) ||
    typeof repo.default_branch !== "string" ||
    !owner ||
    !Number.isSafeInteger(owner.id) ||
    typeof owner.login !== "string" ||
    typeof owner.node_id !== "string" ||
    (owner.type !== "User" && owner.type !== "Organization")
  )
    throw new Error("GitHub returned incomplete repository facts.");
  const facts: Omit<RepositoryLookup, "license"> = {
    repository: repo.full_name,
    numericId: String(repo.id),
    nodeId: repo.node_id,
    defaultBranch: repo.default_branch,
    owner: {
      login: owner.login,
      actorId: String(owner.id),
      nodeId: owner.node_id,
      kind: owner.type === "User" ? "individual" : "organization",
    },
  };
  try {
    const branch = await githubJson(
      `/repos/${repo.full_name}/branches/${encodeURIComponent(repo.default_branch)}`,
      signal,
    );
    const commitSha = (branch?.commit as Record<string, unknown> | undefined)
      ?.sha;
    if (typeof commitSha !== "string" || !/^[0-9a-f]{40}$/u.test(commitSha))
      return unknownLicense(facts, "The default branch could not be read.");
    const license = await githubJson(
      `/repos/${repo.full_name}/license?ref=${commitSha}`,
      signal,
    );
    if (!license) return unknownLicense(facts, "GitHub found no license file.");
    if (license.path !== "LICENSE")
      return unknownLicense(
        facts,
        `The license file is ${String(license.path)}. A manifest records only a root LICENSE file.`,
      );
    const spdx = (license.license as Record<string, unknown> | undefined)
      ?.spdx_id;
    if (
      typeof spdx !== "string" ||
      spdx === "NOASSERTION" ||
      !/^[A-Za-z0-9-.+]{1,80}$/u.test(spdx)
    )
      return unknownLicense(facts, "GitHub could not identify the license.");
    if (license.encoding !== "base64" || typeof license.content !== "string")
      return unknownLicense(facts, "GitHub did not return the license bytes.");
    const binary = atob(license.content.replace(/\s/gu, ""));
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    return {
      ...facts,
      license: {
        state: "verified",
        spdx,
        commitSha,
        fileSha256: sha256Hex(bytes),
      },
    };
  } catch (error: unknown) {
    if (signal.aborted) throw error;
    return unknownLicense(
      facts,
      `License facts could not be read. ${error instanceof Error ? error.message : ""}`.trim(),
    );
  }
}
