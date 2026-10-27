/**
 * Builds every public artifact of a project's generated skills from the
 * canonical templates and one approved D1 revision: the raw skill, mission,
 * client install guides, routing manifest, provenance and archive. This is
 * the per-project publication #866 ran at build time, run by the Pages
 * Function per request instead. The output is deterministic, and the
 * archive is exactly what src/lib/install-command.ts accepts: it re-renders
 * the files from the template revision and the registry revision and refuses
 * any difference (PRD SKL-03, SKL-04).
 */

import { renderInstallGuide } from "../../scripts/render-install-guide.mjs";
import { sha256Hex } from "./async-sha256.mjs";
import { PROJECT_SKILL_TEMPLATES } from "./project-schema.mjs";
import {
  publishesGeneratedSkills,
  renderProjectSkill,
} from "./project-skill.mjs";

export { sha256Hex } from "./async-sha256.mjs";

export const SOURCE_REPOSITORY = "SlopDotCash/slopdotcash";
/** Generated skills always name the canonical site as their authority. */
export const PUBLIC_SITE_ORIGIN = "https://slop.cash";
/** Files the bootstrap skill fetches to rebuild an install guide. */
export const GUIDE_RENDERER_PATHS = Object.freeze([
  "scripts/render-install-guide.mjs",
  "src/lib/install-command.ts",
  "skills/project-contributor-template/scripts/skill-authority.mjs",
]);
/** Revisions the generated installer may authorize, for every skill manifest. */
export const ACCEPTED_SKILL_REVISIONS = Object.freeze([
  "current main head",
  "main ancestor whose bytes match its own immutable canonical source; newer-template notices do not disable it",
  "open non-draft same-repository PR head into main, zero behind current main, with a release-candidate label event after the exact current-head event",
]);

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1)
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * An uncompressed ZIP with sorted, contiguous entries, UTF-8 names, a fixed
 * 1980-01-01 time, mode 0644 and no comments or extra fields, so equal
 * inputs give equal bytes and the installer's strict archive checks pass.
 */
export function storedZip(entries) {
  const sorted = [...entries].sort((left, right) =>
    comparePaths(left.path, right.path),
  );
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { path, bytes } of sorted) {
    const name = encoder.encode(path);
    const crc = crc32(bytes);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(12, 0x0021, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, bytes.length, true);
    view.setUint32(22, bytes.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, (3 << 8) | 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(14, 0x0021, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, bytes.length, true);
    centralView.setUint32(24, bytes.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(38, (0o100644 << 16) >>> 0, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, bytes);
    centrals.push(central);
    offset += local.length + bytes.length;
  }
  const centralSize = centrals.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, sorted.length, true);
  endView.setUint16(10, sorted.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, end];
  const archive = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let position = 0;
  for (const part of parts) {
    archive.set(part, position);
    position += part.length;
  }
  return archive;
}

function json(value) {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
}

async function verifiedTemplateFiles(group, readFile) {
  const files = {};
  for (const file of group.files) {
    // Template paths are POSIX names relative to the template root: an index
    // built on Windows must publish the same archive bytes as a Linux build.
    const path = file.path.replaceAll("\\", "/");
    const bytes = await readFile(`${group.sourcePath}/${path}`);
    if ((await sha256Hex(bytes)) !== file.sha256)
      throw new Error(
        `Skill template file ${group.sourcePath}/${path} does not match its digest`,
      );
    files[path] = bytes;
  }
  return files;
}

async function guideRecord(template, input) {
  return {
    publicUrl: input.publicUrl,
    sha256: await sha256Hex(input.source),
    renderer: {
      entrypoint: "scripts/render-install-guide.mjs",
      repository: SOURCE_REPOSITORY,
      revision:
        template.renderer.revisionStatus === "committed"
          ? template.commit
          : null,
      revisionStatus: template.renderer.revisionStatus,
      paths: [...template.renderer.paths],
      arguments: [
        "--artifact-origin",
        input.artifactOrigin,
        "--client",
        input.client,
        "--skill",
        input.skillName,
        "--source",
        input.skillRepositoryPath,
      ],
    },
  };
}

async function publishRole({
  template,
  readFile,
  project,
  binding,
  role,
  generatedAt,
}) {
  const review = role === "reviewer";
  const prefix = review ? "review-" : "";
  const name = review ? project.reviewSkill.id : project.skill.id;
  const sourcePath = PROJECT_SKILL_TEMPLATES[role];
  const group = review ? template.reviewer : template.contributor;
  if (group.sourcePath !== sourcePath)
    throw new Error(`Skill template index does not name ${sourcePath}`);
  const rendered = renderProjectSkill({
    role,
    templateFiles: await verifiedTemplateFiles(group, readFile),
    manifest: project,
    registry: {
      revision: binding.revision,
      manifestSha256: binding.manifestSha256,
    },
  });
  const paths = Object.keys(rendered).sort(comparePaths);
  const fileManifest = [];
  for (const path of paths)
    fileManifest.push({ path, sha256: await sha256Hex(rendered[path]) });
  const skillBytes = rendered["SKILL.md"];
  const skillDigest = await sha256Hex(skillBytes);
  const revisionStatus = template.revisionStatus;
  const provenance = {
    schemaVersion: "1",
    name,
    repository: SOURCE_REPOSITORY,
    revision: revisionStatus === "committed" ? template.commit : null,
    revisionStatus,
    source: { path: `${sourcePath}/SKILL.md`, sha256: skillDigest },
    files: fileManifest,
    registry: binding,
  };
  const archive = storedZip(
    [
      ...paths.map((path) => ({ path, bytes: rendered[path] })),
      { path: "PROVENANCE.json", bytes: json(provenance) },
    ].map(({ path, bytes }) => ({ path: `${name}/${path}`, bytes })),
  );
  const archiveDigest = await sha256Hex(archive);
  const artifactOrigin = `${PUBLIC_SITE_ORIGIN}/projects/${project.id}`;
  const references = paths
    .filter((path) => path.startsWith("references/") && path.endsWith(".md"))
    .map((path) => decoder.decode(rendered[path]));
  const skillText = decoder.decode(skillBytes);
  const guides = {};
  for (const client of ["codex", "claude-code", "manual"])
    guides[client] = renderInstallGuide({
      artifactOrigin,
      client,
      skillName: name,
      skillRepositoryPath: sourcePath,
    });
  const guideInput = (client, file) => ({
    artifactOrigin,
    client,
    publicUrl: `${artifactOrigin}/${prefix}${file}`,
    skillName: name,
    skillRepositoryPath: sourcePath,
    source: guides[client],
  });
  const manifest = {
    schemaVersion: "1",
    name,
    repository: SOURCE_REPOSITORY,
    revision: template.commit,
    revisionStatus,
    generatedAt,
    source: {
      path: `${sourcePath}/SKILL.md`,
      url: `https://github.com/${SOURCE_REPOSITORY}/blob/${template.commit}/${sourcePath}/SKILL.md`,
      publicUrl: `${artifactOrigin}/${prefix}skill.md`,
      sha256: skillDigest,
    },
    archive: {
      url: `${artifactOrigin}/downloads/${name}.skill`,
      sha256: archiveDigest,
      checksumUrl: `${artifactOrigin}/downloads/${name}.skill.sha256`,
    },
    guides: {
      codex: await guideRecord(template, guideInput("codex", "codex.md")),
      claude: await guideRecord(
        template,
        guideInput("claude-code", "claude.md"),
      ),
      manual: await guideRecord(template, guideInput("manual", "manual.md")),
    },
    authority: {
      apiOrigin: "https://api.github.com",
      rawOrigin: "https://raw.githubusercontent.com",
      canonicalPath: sourcePath,
      releaseCandidateLabel: "slop-release-candidate",
      acceptedRevisions: [...template.acceptedRevisions],
      // The trust root is (template revision on main, this digest); the
      // maintainer-authored fields come from Slop's registry.
      registry: {
        ...binding,
        url: `${PUBLIC_SITE_ORIGIN}/api/v1/project-revisions/${project.id}/${binding.revision}`,
      },
    },
    provenance: {
      status: "self-reported",
      policy:
        "Every provider, exact model identifier, and agent client may participate. Exact provider, model, client, and skill revision disclosure is required, self-reported, and never changes score.",
    },
    telemetry: {
      source: "ccusage@20.0.20",
      policy:
        "Contribute through GitHub with exact provider, model, and client disclosure. Signed receipts, usage collection, private traces, and wallet registration are optional. Inspected traces require consent under https://slop.cash/protocol/private-trace-v1.md. From November 2026, monthly and external-prize reward shares use accepted-work Points only. Optional traces add no payment weight. Older calculations and funded awards stay unchanged; unpaid September–October work stays subject to the reviewed historical reconciliation. Missing evidence never blocks submission.",
    },
    ...(review
      ? {
          review: {
            policy:
              "Advisory review only. The reviewer must post exact provider, model, and client identity with optional finalized private-trace evidence. Maintainers decide acceptance, score, and every money-state transition.",
          },
        }
      : {}),
  };
  const markdown = (text) => encoder.encode(text);
  return {
    name,
    archiveSha256: archiveDigest,
    files: {
      [`${prefix}skill.md`]: skillBytes,
      [`${prefix}mission.md`]: markdown(
        `${skillText}\n\n---\n\n${references.join("\n\n---\n\n")}`,
      ),
      [`${prefix}codex.md`]: markdown(guides.codex),
      [`${prefix}claude.md`]: markdown(guides["claude-code"]),
      [`${prefix}claude-code.md`]: markdown(guides["claude-code"]),
      [`${prefix}manual.md`]: markdown(guides.manual),
      [`${prefix}skill-manifest.json`]: json(manifest),
      [`downloads/${name}.skill`]: archive,
      [`downloads/${name}.skill.sha256`]: markdown(
        `${archiveDigest}  ${name}.skill\n`,
      ),
    },
  };
}

/**
 * @param template the build's /skill-templates/index.json
 * @param readFile resolves a template repository path to its bytes
 * @param project the manifest of the approved revision
 * @param revision the revision number; manifestSha256 its stored digest
 * @param generatedAt the revision's creation time, so output stays stable
 * @returns a map of paths under /projects/<id>/ to bytes, or null when the
 *   project publishes no generated skill
 */
export async function buildProjectPublication({
  template,
  readFile,
  project,
  revision,
  manifestSha256,
  generatedAt,
}) {
  if (!publishesGeneratedSkills(project)) return null;
  if (!/^[0-9a-f]{40}$/u.test(template.commit ?? ""))
    throw new TypeError("Skill template commit is not a full SHA");
  const binding = { projectId: project.id, revision, manifestSha256 };
  const files = {};
  for (const role of ["contributor", "reviewer"])
    Object.assign(
      files,
      (
        await publishRole({
          template,
          readFile,
          project,
          binding,
          role,
          generatedAt,
        })
      ).files,
    );
  return files;
}
