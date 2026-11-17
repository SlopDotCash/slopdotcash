// spec/contributor/skillRendering.md, "Rendering depends only on the template commit and the approved revision"; spec/contributor/skillRendering.md, "A maintainer note that would cross a template rule never takes effect"
import { Arbitrary, Schema } from "effect";
import { contract } from "vibestack/testing";
import { type Role, contributionFields, templatePaths } from "./fields.ts";
import { type RenderInput, type Rendered, comparePaths, generatedSkillName, renderProjectSkill } from "./render.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const templateFiles = [
  {
    path: "SKILL.md",
    bytes: encoder.encode(
      "---\nname: {{SLOP_SKILL_NAME}}\n---\n\nShip to {{SLOP_REPOSITORY}} on `{{SLOP_INTEGRATION_BRANCH}}` ({{SLOP_INTEGRATION_BRANCH}}) for {{SLOP_PROJECT_ID}}.\n",
    ),
  },
  { path: "references/scope.md", bytes: encoder.encode("{{SLOP_PROJECT_ID}} and `{{SLOP_INTEGRATION_BRANCH}}` stay literal here.\n") },
  { path: "agents/openai.yaml", bytes: encoder.encode("interface:\n  display_name: \"{{SLOP_SKILL_NAME}}\"\n") },
];

const inputs = Arbitrary.schema(
  Schema.Struct({ reviewer: Schema.Boolean, id: Schema.String, branch: Schema.String, text: Schema.String, revision: Schema.Int }),
).pipe(
  Arbitrary.map(({ reviewer, id, branch, text, revision }): RenderInput => {
    const role: Role = reviewer ? "reviewer" : "contributor";
    const projectId = `p${id.toLowerCase().replace(/[^a-z0-9]/gu, "").slice(0, 40)}`;
    const integrationBranch = `b${branch.replace(/[^A-Za-z0-9`_/-]/gu, "").slice(0, 200).replace(/\/+/gu, "/").replace(/\/$/u, "")}`;
    const skill = { id: generatedSkillName(role, projectId), sourcePath: templatePaths[role] };
    return {
      role,
      templateFiles,
      manifest: {
        id: projectId,
        [reviewer ? "reviewSkill" : "skill"]: skill,
        repositories: [{ id: `owner/${projectId}`, integrationBranch }],
        contribution: Object.fromEntries(contributionFields.map((field) => [field, `${field}: ${text.toWellFormed()}`])),
      },
      registry: { revision: 1 + Math.abs(revision % 1_000_000), manifestSha256: "0".repeat(64) },
    };
  }),
);

const keepsTemplateText = (input: RenderInput, output: Rendered) => {
  if (output.kind !== "rendered") return false;
  const paths = output.files.map((file) => file.path);
  const project: unknown = JSON.parse(decoder.decode(output.files.find((file) => file.path === "project.json")?.bytes));
  const contribution = typeof project === "object" && project !== null && "contribution" in project ? project.contribution : undefined;
  const manifest = input.manifest as { contribution: unknown };
  return (
    paths.every((path, index) => index === 0 || comparePaths(paths[index - 1] ?? "", path) < 0) &&
    paths.includes("project.json") &&
    input.templateFiles
      .filter((file) => file.path !== "SKILL.md")
      .every((file) => output.files.some((rendered) => rendered.path === file.path && rendered.bytes === file.bytes)) &&
    JSON.stringify(contribution) === JSON.stringify(manifest.contribution)
  );
};

export const renderingIsDeterministic = contract({ input: inputs, run: renderProjectSkill, deterministic: true, invariant: keepsTemplateText });
