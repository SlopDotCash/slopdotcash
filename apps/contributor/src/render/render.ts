// spec/contributor/rendering.md, "The same template files, approved manifest, revision and digest render the same sorted bytes"; spec/contributor/rendering.md, "Maintainer fields appear only in project.json and never change template text"
import {
  type ContributionField,
  type Role,
  contributionFields,
  isDigest,
  isIntegrationBranch,
  isProjectId,
  isRepositoryId,
  publicSiteOrigin,
  templatePaths,
  usageAdapters,
} from "./fields.ts";
import { substitute } from "./renderText.ts";

export interface RegistryBinding {
  readonly revision: number;
  readonly manifestSha256: string;
}

export interface SkillFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface RenderInput {
  readonly role: Role;
  readonly templateFiles: ReadonlyArray<SkillFile>;
  readonly manifest: unknown;
  readonly registry: RegistryBinding;
}

export type Rendered =
  | { readonly kind: "rendered"; readonly files: ReadonlyArray<SkillFile> }
  | { readonly kind: "refusedManifest" }
  | { readonly kind: "refusedTemplate"; readonly problem: "lacksSkill" | "carriesProjectJson" | "notUtf8" }
  | { readonly kind: "refusedPlaceholder" };

interface Renderable {
  readonly projectId: string;
  readonly skillName: string;
  readonly repository: string;
  readonly integrationBranch: string;
  readonly contribution: Readonly<Record<ContributionField, string>>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fieldOf = (value: unknown, key: string): unknown => (isRecord(value) ? value[key] : undefined);

const isContribution = (value: unknown): value is Readonly<Record<ContributionField, string>> =>
  isRecord(value) &&
  contributionFields.every((field) => {
    const text = value[field];
    return typeof text === "string" && text.isWellFormed();
  });

/** @throws {never} */
export function generatedSkillName(role: Role, projectId: string): string {
  return role === "contributor" ? `contribute-to-${projectId}` : `review-${projectId}-contributions`;
}

/** @throws {never} */
export function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function renderable(role: Role, manifest: unknown, registry: RegistryBinding): Renderable | undefined {
  const skill = fieldOf(manifest, role === "contributor" ? "skill" : "reviewSkill");
  const repositories = fieldOf(manifest, "repositories");
  const repository: unknown = Array.isArray(repositories) ? repositories[0] : undefined;
  const projectId = fieldOf(manifest, "id");
  const skillName = fieldOf(skill, "id");
  const repositoryId = fieldOf(repository, "id");
  const integrationBranch = fieldOf(repository, "integrationBranch");
  const contribution = fieldOf(manifest, "contribution");
  if (
    fieldOf(skill, "sourcePath") !== templatePaths[role] ||
    !isProjectId(projectId) ||
    skillName !== generatedSkillName(role, projectId) ||
    !isRepositoryId(repositoryId) ||
    !isIntegrationBranch(integrationBranch) ||
    !isContribution(contribution) ||
    !Number.isSafeInteger(registry.revision) ||
    registry.revision < 1 ||
    !isDigest(registry.manifestSha256)
  )
    return undefined;
  return { projectId, skillName, repository: repositoryId, integrationBranch, contribution };
}

function decoded(bytes: Uint8Array): string | undefined {
  try {
    return decoder.decode(bytes);
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function renderProjectSkill({ role, templateFiles, manifest, registry }: RenderInput): Rendered {
  const project = renderable(role, manifest, registry);
  if (project === undefined) return { kind: "refusedManifest" };
  const skill = templateFiles.find((file) => file.path === "SKILL.md");
  if (skill === undefined) return { kind: "refusedTemplate", problem: "lacksSkill" };
  if (templateFiles.some((file) => file.path === "project.json")) return { kind: "refusedTemplate", problem: "carriesProjectJson" };
  const skillText = decoded(skill.bytes);
  if (skillText === undefined) return { kind: "refusedTemplate", problem: "notUtf8" };
  const substituted = substitute(skillText, project);
  if (substituted.kind === "refusedPlaceholder") return substituted;
  const projectJson = {
    schemaVersion: "1",
    projectId: project.projectId,
    repositoryId: project.repository,
    skillName: project.skillName,
    skillSourcePath: templatePaths[role],
    publicOrigin: `${publicSiteOrigin}/projects/${project.projectId}`,
    policyAuthority: publicSiteOrigin,
    usageAdapters: { ...usageAdapters },
    registry: { revision: registry.revision, manifestSha256: registry.manifestSha256 },
    contribution: Object.fromEntries(contributionFields.map((field) => [field, project.contribution[field]])),
  };
  const files = new Map(templateFiles.map((file) => [file.path, file.bytes]));
  files.set("SKILL.md", encoder.encode(substituted.text));
  files.set("project.json", encoder.encode(`${JSON.stringify(projectJson, null, 2)}\n`));
  return {
    kind: "rendered",
    files: [...files].sort(([left], [right]) => comparePaths(left, right)).map(([path, bytes]) => ({ path, bytes })),
  };
}
