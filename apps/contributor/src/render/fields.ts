// spec/contributor/rendering.md, "A template that carries project.json or lacks SKILL.md, or a manifest that fails the field checks, refuses"

export const contributionFields = [
  "approvedScope",
  "contributionGuide",
  "supportedTasks",
  "requiredTests",
  "reviewExpectations",
  "securityContact",
  "closurePolicy",
  "maintainerNotes",
] as const;

export type ContributionField = (typeof contributionFields)[number];

export type Role = "contributor" | "reviewer";

export const templatePaths = {
  contributor: "skills/project-contributor-template",
  reviewer: "skills/project-reviewer-template",
} as const satisfies Record<Role, string>;

export const usageAdapters = { codex: "codex", "claude-code": "claude", "grok-build": "grok" } as const;

export const publicSiteOrigin = "https://slop.cash";

const projectIdPattern = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u;
const repositoryIdPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const digestPattern = /^[0-9a-f]{64}$/u;
const forbiddenBranchCharacters = /[~^:?*[\\]/u;

/** @throws {never} */
export function isProjectId(value: unknown): value is string {
  return typeof value === "string" && projectIdPattern.test(value);
}

/** @throws {never} */
export function isRepositoryId(value: unknown): value is string {
  return typeof value === "string" && repositoryIdPattern.test(value);
}

/** @throws {never} */
export function isDigest(value: unknown): value is string {
  return typeof value === "string" && digestPattern.test(value);
}

/** @throws {never} */
export function isIntegrationBranch(value: unknown): value is string {
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
    !forbiddenBranchCharacters.test(value) &&
    [...value].every((character) => {
      const code = character.charCodeAt(0);
      return code > 32 && code !== 127;
    }) &&
    value.split("/").every((part) => part !== "" && !part.startsWith(".") && !part.endsWith(".lock"))
  );
}
