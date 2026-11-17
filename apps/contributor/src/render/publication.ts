// spec/contributor/publication.md, "The server renders only template files whose bytes match the index digest"; spec/contributor/publication.md, "The bootstrap's renderer contract names files that exist byte-identical at the build commit"; spec/contributor/skillRendering.md, "Rendering depends only on the template commit and the approved revision"
import { storedZip } from "./archive.ts";
import { type Role, isProjectId, publicSiteOrigin, templatePaths } from "./fields.ts";
import { type GuideRequest, type InstallClient, renderInstallGuide } from "./installGuide.ts";
import { type Rendered, type SkillFile, generatedSkillName, renderProjectSkill } from "./render.ts";
import { type TemplateIndex, type VerifiedFiles, guideRendererPaths, sha256Hex, sourceRepository, verifyTemplateFiles } from "./templateIndex.ts";

export interface PublicationInput {
  readonly index: TemplateIndex;
  readonly fetched: ReadonlyMap<string, Uint8Array>;
  readonly manifest: unknown;
  readonly revision: number;
  readonly manifestSha256: string;
  readonly generatedAt: string;
}

export type Unavailable =
  | { readonly reason: "commitNotFullSha" }
  | { readonly reason: "templatePath"; readonly role: Role }
  | { readonly reason: "templateFiles"; readonly role: Role; readonly failure: Exclude<VerifiedFiles, { kind: "verified" }> }
  | { readonly reason: "render"; readonly role: Role; readonly refusal: Exclude<Rendered, { kind: "rendered" }> }
  | { readonly reason: "notUtf8"; readonly role: Role; readonly path: string }
  | { readonly reason: "guide"; readonly role: Role; readonly message: string };

export type Publication =
  | { readonly kind: "published"; readonly files: ReadonlyMap<string, Uint8Array> }
  | { readonly kind: "unpublished" }
  | { readonly kind: "unavailable"; readonly problem: Unavailable };

interface Binding {
  readonly projectId: string;
  readonly revision: number;
  readonly manifestSha256: string;
}

type RolePublication = { readonly kind: "role"; readonly files: ReadonlyArray<SkillFile> } | { readonly kind: "unavailable"; readonly problem: Unavailable };

type Guides = { readonly kind: "guides"; readonly texts: Readonly<Record<InstallClient, string>> } | { readonly kind: "refused"; readonly message: string };

type Decoded = { readonly kind: "text"; readonly text: string } | { readonly kind: "notUtf8"; readonly path: string };

const roles: ReadonlyArray<Role> = ["contributor", "reviewer"];
const commitPattern = /^[0-9a-f]{40}$/u;
const guideEntrypoint = guideRendererPaths[0];
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

const skillPolicy =
  "Every provider, exact model identifier, and agent client may participate. Exact provider, model, client, and skill revision disclosure is required, self-reported, and never changes score.";
const telemetryPolicy =
  "Contribute through GitHub with exact provider, model, and client disclosure. Signed receipts, usage collection, private traces, and wallet registration are optional. Inspected traces require consent under https://slop.cash/protocol/private-trace-v1.md. From November 2026, monthly and external-prize reward shares use accepted-work Points only. Optional traces add no payment weight. Older calculations and funded awards stay unchanged; unpaid September–October work stays subject to the reviewed historical reconciliation. Missing evidence never blocks submission.";
const reviewPolicy =
  "Advisory review only. The reviewer must post exact provider, model, and client identity with optional finalized private-trace evidence. Maintainers decide acceptance, score, and every money-state transition.";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fieldOf = (value: unknown, key: string): unknown => (isRecord(value) ? value[key] : undefined);

const json = (value: unknown) => encoder.encode(`${JSON.stringify(value, null, 2)}\n`);

const unavailable = (problem: Unavailable) => ({ kind: "unavailable", problem }) as const;

/** @throws {never} */
export function publishesGeneratedSkills(manifest: unknown): boolean {
  return fieldOf(fieldOf(manifest, "skill"), "sourcePath") === templatePaths.contributor && fieldOf(manifest, "contribution") !== undefined;
}

function decoded(file: SkillFile): Decoded {
  try {
    return { kind: "text", text: decoder.decode(file.bytes) };
  } catch {
    return { kind: "notUtf8", path: file.path };
  }
}

function guidesFor(request: Omit<GuideRequest, "client">): Guides {
  const codex = renderInstallGuide({ ...request, client: "codex" });
  if (codex.kind === "refused") return codex;
  const claude = renderInstallGuide({ ...request, client: "claude-code" });
  if (claude.kind === "refused") return claude;
  const manual = renderInstallGuide({ ...request, client: "manual" });
  if (manual.kind === "refused") return manual;
  return { kind: "guides", texts: { codex: codex.text, "claude-code": claude.text, manual: manual.text } };
}

function publishRole(input: PublicationInput, role: Role, binding: Binding): RolePublication {
  const { index } = input;
  const review = role === "reviewer";
  const prefix = review ? "review-" : "";
  const name = generatedSkillName(role, binding.projectId);
  const sourcePath = templatePaths[role];
  const group = index[role];
  if (group.sourcePath !== sourcePath) return unavailable({ reason: "templatePath", role });
  const verified = verifyTemplateFiles(group, input.fetched);
  if (verified.kind !== "verified") return unavailable({ reason: "templateFiles", role, failure: verified });
  const rendered = renderProjectSkill({
    role,
    templateFiles: verified.files,
    manifest: input.manifest,
    registry: { revision: binding.revision, manifestSha256: binding.manifestSha256 },
  });
  if (rendered.kind !== "rendered") return unavailable({ reason: "render", role, refusal: rendered });
  const skill = rendered.files.find((file) => file.path === "SKILL.md");
  if (skill === undefined) return unavailable({ reason: "render", role, refusal: { kind: "refusedTemplate", problem: "lacksSkill" } });
  const skillText = decoded(skill);
  if (skillText.kind === "notUtf8") return unavailable({ reason: "notUtf8", role, path: skillText.path });
  const references: string[] = [];
  for (const file of rendered.files.filter(({ path }) => path.startsWith("references/") && path.endsWith(".md"))) {
    const reference = decoded(file);
    if (reference.kind === "notUtf8") return unavailable({ reason: "notUtf8", role, path: reference.path });
    references.push(reference.text);
  }
  const skillDigest = sha256Hex(skill.bytes);
  const revisionStatus = index.revisionStatus;
  const provenance = {
    schemaVersion: "1",
    name,
    repository: sourceRepository,
    revision: revisionStatus === "committed" ? index.commit : null,
    revisionStatus,
    source: { path: `${sourcePath}/SKILL.md`, sha256: skillDigest },
    files: rendered.files.map(({ path, bytes }) => ({ path, sha256: sha256Hex(bytes) })),
    registry: binding,
  };
  const archive = storedZip(
    [...rendered.files, { path: "PROVENANCE.json", bytes: json(provenance) }].map(({ path, bytes }) => ({ path: `${name}/${path}`, bytes })),
  );
  const archiveDigest = sha256Hex(archive);
  const artifactOrigin = `${publicSiteOrigin}/projects/${binding.projectId}`;
  const guides = guidesFor({ artifactOrigin, skillName: name, skillRepositoryPath: sourcePath });
  if (guides.kind === "refused") return unavailable({ reason: "guide", role, message: guides.message });
  const guideRecord = (client: InstallClient, file: string) => ({
    publicUrl: `${artifactOrigin}/${prefix}${file}`,
    sha256: sha256Hex(encoder.encode(guides.texts[client])),
    renderer: {
      entrypoint: guideEntrypoint,
      repository: sourceRepository,
      revision: index.renderer.revisionStatus === "committed" ? index.commit : null,
      revisionStatus: index.renderer.revisionStatus,
      paths: [...index.renderer.paths],
      arguments: ["--artifact-origin", artifactOrigin, "--client", client, "--skill", name, "--source", sourcePath],
    },
  });
  const manifest = {
    schemaVersion: "1",
    name,
    repository: sourceRepository,
    revision: index.commit,
    revisionStatus,
    generatedAt: input.generatedAt,
    source: {
      path: `${sourcePath}/SKILL.md`,
      url: `https://github.com/${sourceRepository}/blob/${index.commit}/${sourcePath}/SKILL.md`,
      publicUrl: `${artifactOrigin}/${prefix}skill.md`,
      sha256: skillDigest,
    },
    archive: {
      url: `${artifactOrigin}/downloads/${name}.skill`,
      sha256: archiveDigest,
      checksumUrl: `${artifactOrigin}/downloads/${name}.skill.sha256`,
    },
    guides: {
      codex: guideRecord("codex", "codex.md"),
      claude: guideRecord("claude-code", "claude.md"),
      manual: guideRecord("manual", "manual.md"),
    },
    authority: {
      apiOrigin: "https://api.github.com",
      rawOrigin: "https://raw.githubusercontent.com",
      canonicalPath: sourcePath,
      acceptedRevisions: [...index.acceptedRevisions],
      registry: { ...binding, url: `${publicSiteOrigin}/api/v1/project-revisions/${binding.projectId}/${binding.revision}` },
    },
    provenance: { status: "self-reported", policy: skillPolicy },
    telemetry: { source: "ccusage@20.0.20", policy: telemetryPolicy },
    ...(review ? { review: { policy: reviewPolicy } } : {}),
  };
  const markdown = (text: string) => encoder.encode(text);
  return {
    kind: "role",
    files: [
      { path: `${prefix}skill.md`, bytes: skill.bytes },
      { path: `${prefix}mission.md`, bytes: markdown(`${skillText.text}\n\n---\n\n${references.join("\n\n---\n\n")}`) },
      { path: `${prefix}codex.md`, bytes: markdown(guides.texts.codex) },
      { path: `${prefix}claude.md`, bytes: markdown(guides.texts["claude-code"]) },
      { path: `${prefix}claude-code.md`, bytes: markdown(guides.texts["claude-code"]) },
      { path: `${prefix}manual.md`, bytes: markdown(guides.texts.manual) },
      { path: `${prefix}skill-manifest.json`, bytes: json(manifest) },
      { path: `downloads/${name}.skill`, bytes: archive },
      { path: `downloads/${name}.skill.sha256`, bytes: markdown(`${archiveDigest}  ${name}.skill\n`) },
    ],
  };
}

/** @throws {never} */
export function buildProjectPublication(input: PublicationInput): Publication {
  if (!publishesGeneratedSkills(input.manifest)) return { kind: "unpublished" };
  if (!commitPattern.test(input.index.commit)) return unavailable({ reason: "commitNotFullSha" });
  const projectId = fieldOf(input.manifest, "id");
  if (!isProjectId(projectId)) return unavailable({ reason: "render", role: "contributor", refusal: { kind: "refusedManifest" } });
  const binding = { projectId, revision: input.revision, manifestSha256: input.manifestSha256 };
  const files = new Map<string, Uint8Array>();
  for (const role of roles) {
    const published = publishRole(input, role, binding);
    if (published.kind === "unavailable") return published;
    for (const file of published.files) files.set(file.path, file.bytes);
  }
  return { kind: "published", files };
}
