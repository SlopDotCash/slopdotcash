// spec/contributor/publication.md, "The server renders only template files whose bytes match the index digest"; spec/contributor/publication.md, "The bootstrap's renderer contract names files that exist byte-identical at the build commit"; spec/contributor/rendering.md, "The same template files, approved manifest, revision and digest render the same sorted bytes"; spec/contributor/skillAuthority.md, "Only the exact GitHub API authority receives the optional credential"
import { Arbitrary, Option, Schema } from "effect";
import { contract } from "vibestack/testing";
import { type Role, contributionFields, publicSiteOrigin, templatePaths } from "./fields.ts";
import { type GuideRequest, type InstallGuide, installClients, renderInstallGuide } from "./installGuide.ts";
import { type Publication, type PublicationInput, buildProjectPublication } from "./publication.ts";
import { type SkillFile, generatedSkillName } from "./render.ts";
import { type TemplateGroup, type TemplateIndex, acceptedRevisions, rendererSourcePaths, sha256Hex, sourceRepository, templateSha256 } from "./templateIndex.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const roles: ReadonlyArray<Role> = ["contributor", "reviewer"];

const templateFiles: ReadonlyArray<SkillFile> = [
  {
    path: "SKILL.md",
    bytes: encoder.encode("---\nname: {{SLOP_SKILL_NAME}}\n---\n\nShip to {{SLOP_REPOSITORY}} on `{{SLOP_INTEGRATION_BRANCH}}` for {{SLOP_PROJECT_ID}}.\n"),
  },
  { path: "agents/openai.yaml", bytes: encoder.encode("interface:\n  display_name: \"{{SLOP_SKILL_NAME}}\"\n") },
  { path: "references/scope.md", bytes: encoder.encode("{{SLOP_PROJECT_ID}} stays literal here.\n") },
];

const groupOf = (role: Role): TemplateGroup => ({
  sourcePath: templatePaths[role],
  files: templateFiles.map(({ path, bytes }) => ({ path, sha256: sha256Hex(bytes) })),
});

const fetched = new Map(roles.flatMap((role) => templateFiles.map(({ path, bytes }) => [`${templatePaths[role]}/${path}`, bytes] as const)));

const rendererSources = rendererSourcePaths.map((path) => ({ path, sha256: sha256Hex(encoder.encode(path)) }));

const projectIdOf = (text: string) => {
  const core = text.toLowerCase().replace(/[^a-z0-9-]/gu, "").slice(0, 41);
  return `p${core}${core.endsWith("-") ? "0" : ""}`;
};

const RevisionStatus = Schema.Literals(["committed", "working-tree"]);

const inputs = Arbitrary.schema(
  Schema.Struct({
    id: Schema.String,
    text: Schema.String,
    revision: Schema.Int,
    manifestSeed: Schema.String,
    commitSeed: Schema.String,
    revisionStatus: RevisionStatus,
    rendererStatus: RevisionStatus,
    generatedAt: Schema.String,
  }),
).pipe(
  Arbitrary.map(({ id, text, revision, manifestSeed, commitSeed, revisionStatus, rendererStatus, generatedAt }): PublicationInput => {
    const projectId = projectIdOf(id);
    const contributor = groupOf("contributor");
    const reviewer = groupOf("reviewer");
    const index: TemplateIndex = {
      schemaVersion: "1",
      repository: sourceRepository,
      commit: sha256Hex(encoder.encode(commitSeed)).slice(0, 40),
      templateSha256: templateSha256({ contributor, reviewer, rendererSources, acceptedRevisions }),
      revisionStatus,
      contributor,
      reviewer,
      renderer: { paths: [...rendererSourcePaths], sources: rendererSources, revisionStatus: rendererStatus },
      acceptedRevisions: [...acceptedRevisions],
    };
    return {
      index,
      fetched,
      manifest: {
        id: projectId,
        skill: { id: generatedSkillName("contributor", projectId), sourcePath: templatePaths.contributor },
        reviewSkill: { id: generatedSkillName("reviewer", projectId), sourcePath: templatePaths.reviewer },
        repositories: [{ id: `owner/${projectId}`, integrationBranch: "main" }],
        contribution: Object.fromEntries(contributionFields.map((field) => [field, `${field}: ${text.toWellFormed()}`])),
      },
      revision: 1 + Math.abs(revision % 1_000_000),
      manifestSha256: sha256Hex(encoder.encode(manifestSeed)),
      generatedAt,
    };
  }),
);

const GuideRecord = Schema.Struct({
  sha256: Schema.String,
  renderer: Schema.Struct({ revision: Schema.NullOr(Schema.String), revisionStatus: Schema.String }),
});

const SkillManifest = Schema.Struct({
  archive: Schema.Struct({ sha256: Schema.String }),
  guides: Schema.Struct({ codex: GuideRecord, claude: GuideRecord, manual: GuideRecord }),
});

const guideFiles = [
  ["codex", "codex.md"],
  ["claude", "claude.md"],
  ["manual", "manual.md"],
] as const;

const prefixOf = (role: Role) => (role === "reviewer" ? "review-" : "");

const projectIdIn = (input: PublicationInput) =>
  Option.match(Schema.decodeUnknownOption(Schema.Struct({ id: Schema.String }))(input.manifest), { onNone: () => "", onSome: ({ id }) => id });

const publishedPaths = (projectId: string) =>
  roles.flatMap((role) => {
    const prefix = prefixOf(role);
    const name = generatedSkillName(role, projectId);
    return [
      `${prefix}skill.md`,
      `${prefix}mission.md`,
      `${prefix}codex.md`,
      `${prefix}claude.md`,
      `${prefix}claude-code.md`,
      `${prefix}manual.md`,
      `${prefix}skill-manifest.json`,
      `downloads/${name}.skill`,
      `downloads/${name}.skill.sha256`,
    ];
  });

const bindsArtifacts = (input: PublicationInput, output: Publication) => {
  if (output.kind !== "published") return false;
  const { files } = output;
  const bytesAt = (path: string) => files.get(path) ?? new Uint8Array();
  const textAt = (path: string) => decoder.decode(bytesAt(path));
  const expectedRevision = input.index.renderer.revisionStatus === "committed" ? input.index.commit : null;
  const projectId = projectIdIn(input);
  const paths = publishedPaths(projectId);
  return (
    files.size === paths.length &&
    [...files.keys()].every((path, n) => path === paths[n]) &&
    roles.every((role) => {
      const prefix = prefixOf(role);
      const name = generatedSkillName(role, projectId);
      const archiveDigest = sha256Hex(bytesAt(`downloads/${name}.skill`));
      const manifest = Schema.decodeUnknownOption(SkillManifest)(JSON.parse(textAt(`${prefix}skill-manifest.json`)));
      return (
        Option.isSome(manifest) &&
        textAt(`downloads/${name}.skill.sha256`) === `${archiveDigest}  ${name}.skill\n` &&
        manifest.value.archive.sha256 === archiveDigest &&
        textAt(`${prefix}claude-code.md`) === textAt(`${prefix}claude.md`) &&
        guideFiles.every(([client, file]) => {
          const record = manifest.value.guides[client];
          return (
            record.sha256 === sha256Hex(bytesAt(`${prefix}${file}`)) &&
            record.renderer.revisionStatus === input.index.renderer.revisionStatus &&
            record.renderer.revision === expectedRevision
          );
        })
      );
    })
  );
};

export const publicationBindsItsArtifacts = contract({ input: inputs, run: buildProjectPublication, deterministic: true, invariant: bindsArtifacts });

const guideRequests = Arbitrary.schema(Schema.Struct({ id: Schema.String, reviewer: Schema.Boolean, client: Schema.Literals(installClients) })).pipe(
  Arbitrary.map(({ id, reviewer, client }): GuideRequest => {
    const projectId = projectIdOf(id);
    const role: Role = reviewer ? "reviewer" : "contributor";
    return {
      artifactOrigin: `${publicSiteOrigin}/projects/${projectId}`,
      client,
      skillName: generatedSkillName(role, projectId),
      skillRepositoryPath: templatePaths[role],
    };
  }),
);

const namesProductionAuthority = (request: GuideRequest, guide: InstallGuide) =>
  guide.kind === "guide" &&
  guide.text.includes("https://api.github.com") &&
  guide.text.includes("https://raw.githubusercontent.com") &&
  guide.text.includes(request.skillName);

export const guideNamesProductionAuthority = contract({ input: guideRequests, run: renderInstallGuide, deterministic: true, invariant: namesProductionAuthority });
