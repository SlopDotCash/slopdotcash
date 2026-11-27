// spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"; spec/contributor/skillRendering.md, "Rendering depends only on the template commit and the approved revision"
import { publishesGeneratedSkills } from "@repo/contributor/render/publication";
import { type RegistryBinding, renderProjectSkill } from "@repo/contributor/render/render";
// eslint-disable-next-line boundaries/no-unknown-dependencies -- committed skill template bundled via Vite ?raw
import contributorTemplate from "../../../../../../skills/project-contributor-template/SKILL.md?raw";
// eslint-disable-next-line boundaries/no-unknown-dependencies -- committed skill template bundled via Vite ?raw
import reviewerTemplate from "../../../../../../skills/project-reviewer-template/SKILL.md?raw";

export type SkillRole = "contributor" | "reviewer";

export type { RegistryBinding };

export interface SkillText {
  readonly path: string;
  readonly text: string;
}

export type SkillPreviews =
  | { readonly kind: "rendered"; readonly roles: Readonly<Record<SkillRole, ReadonlyArray<SkillText>>> }
  | { readonly kind: "committed"; readonly sourcePath: string }
  | { readonly kind: "refused" };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const templates: Readonly<Record<SkillRole, string>> = { contributor: contributorTemplate, reviewer: reviewerTemplate };

function sourcePathOf(manifest: unknown): string {
  const skill = typeof manifest === "object" && manifest !== null && "skill" in manifest ? manifest.skill : undefined;
  const path = typeof skill === "object" && skill !== null && "sourcePath" in skill ? skill.sourcePath : undefined;
  return typeof path === "string" ? path : "";
}

function rendered(role: SkillRole, manifest: unknown, registry: RegistryBinding): ReadonlyArray<SkillText> | undefined {
  const result = renderProjectSkill({ role, templateFiles: [{ path: "SKILL.md", bytes: encoder.encode(templates[role]) }], manifest, registry });
  return result.kind === "rendered" ? result.files.map((file) => ({ path: file.path, text: decoder.decode(file.bytes) })) : undefined;
}

/** @throws {never} */
export function skillPreviews(manifest: unknown, registry: RegistryBinding): SkillPreviews {
  if (!publishesGeneratedSkills(manifest)) return { kind: "committed", sourcePath: sourcePathOf(manifest) };
  const contributor = rendered("contributor", manifest, registry);
  const reviewer = rendered("reviewer", manifest, registry);
  return contributor && reviewer ? { kind: "rendered", roles: { contributor, reviewer } } : { kind: "refused" };
}
