/**
 * Renders a project's contributor or reviewer skill from its canonical
 * template and approved registry revision (PRD SKL-03). The installer's
 * Python authority in scripts/skill-kit/skill-authority.mjs implements the
 * same rendering byte for byte; change both together.
 */

import {
  CONTRIBUTION_FIELDS,
  PROJECT_SKILL_TEMPLATES,
} from "./project-schema.mjs";

const PROJECT_ID = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const BRANCH = /^[A-Za-z0-9._/-]{1,255}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const PLACEHOLDER = /\{\{SLOP_[A-Z_]+\}\}/u;
const USAGE_ADAPTERS = Object.freeze({
  codex: "codex",
  "claude-code": "claude",
  "grok-build": "grok",
});

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function bytes(value) {
  return typeof value === "string" ? encoder.encode(value) : value;
}

/**
 * @param {{
 *   role: "contributor" | "reviewer",
 *   templateFiles: Record<string, string | Uint8Array>,
 *   manifest: import("./projects.mjs").ProjectDefinition,
 *   registry: { revision: number, manifestSha256: string },
 * }} input
 * @returns {Record<string, Uint8Array>} rendered files, sorted by path
 */
export function renderProjectSkill({
  role,
  templateFiles,
  manifest,
  registry,
}) {
  const skill = role === "contributor" ? manifest.skill : manifest.reviewSkill;
  const template = PROJECT_SKILL_TEMPLATES[role];
  const repository = manifest.repositories?.[0];
  const contribution = manifest.contribution;
  if (
    skill?.sourcePath !== template ||
    !PROJECT_ID.test(manifest.id) ||
    !REPOSITORY.test(repository?.id ?? "") ||
    !BRANCH.test(repository?.integrationBranch ?? "") ||
    !contribution ||
    !Number.isSafeInteger(registry.revision) ||
    registry.revision < 1 ||
    !DIGEST.test(registry.manifestSha256)
  )
    throw new TypeError(`${manifest.id} cannot render its ${role} skill`);
  if (!Object.hasOwn(templateFiles, "SKILL.md"))
    throw new TypeError(`${template} has no SKILL.md`);
  if (Object.hasOwn(templateFiles, "project.json"))
    throw new TypeError(`${template} cannot ship a project.json`);
  const values = {
    "{{SLOP_SKILL_NAME}}": skill.id,
    "{{SLOP_PROJECT_ID}}": manifest.id,
    "{{SLOP_REPOSITORY}}": repository.id,
    "{{SLOP_INTEGRATION_BRANCH}}": repository.integrationBranch,
  };
  let skillText = decoder.decode(bytes(templateFiles["SKILL.md"]));
  for (const [token, value] of Object.entries(values))
    skillText = skillText.replaceAll(token, value);
  if (PLACEHOLDER.test(skillText))
    throw new TypeError(`${template} has an unknown placeholder`);
  const project = {
    schemaVersion: "1",
    projectId: manifest.id,
    repositoryId: repository.id,
    skillName: skill.id,
    skillSourcePath: template,
    publicOrigin: `https://slop.cash/projects/${manifest.id}`,
    policyAuthority: "https://slop.cash",
    usageAdapters: { ...USAGE_ADAPTERS },
    registry: {
      revision: registry.revision,
      manifestSha256: registry.manifestSha256,
    },
    contribution: Object.fromEntries(
      CONTRIBUTION_FIELDS.map((field) => {
        const value = contribution[field];
        if (typeof value !== "string" || !value.isWellFormed())
          throw new TypeError(
            `${manifest.id} contribution.${field} is invalid`,
          );
        return [field, value];
      }),
    ),
  };
  const rendered = {
    ...Object.fromEntries(
      Object.entries(templateFiles).map(([path, contents]) => [
        path,
        bytes(contents),
      ]),
    ),
    "SKILL.md": encoder.encode(skillText),
    "project.json": encoder.encode(`${JSON.stringify(project, null, 2)}\n`),
  };
  return Object.fromEntries(
    Object.entries(rendered).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  );
}

/** True when a project's skills are generated from the canonical templates. */
export function usesGeneratedSkills(manifest) {
  return manifest.skill.sourcePath === PROJECT_SKILL_TEMPLATES.contributor;
}
