/**
 * Serves each project's generated skills, guides, routing manifests,
 * archives, terms, and the project discovery index from the current D1
 * revision and the canonical templates. Only the security-vetting clearance
 * reads GitHub, to compare the cleared commit with the live integration-branch
 * head; each skill request also verifies its retained private evidence.
 */

import type {
  ProjectEnforcement,
  ProjectRecord,
} from "../../src/lib/project-contracts";
import { publishesGeneratedSkills } from "../../src/lib/project-skill.mjs";
import {
  buildProjectPublication,
  PUBLIC_SITE_ORIGIN,
} from "../../src/lib/project-skill-publication.mjs";
import { PROJECT_ID } from "../http";
import type { VettingClearance } from "../vetting/persistence";
import { publicRestrictionOf } from "./enforcement";

/** The build's /skill-templates/index.json. */
export type SkillTemplateIndex = {
  schemaVersion: "1";
  repository: string;
  commit: string;
  /**
   * SHA-256 of the canonical JSON of the contributor and reviewer template
   * files, the renderer sources and the accepted revisions: every input of
   * the generated skill bytes except the provenance commit. Vetting binds
   * this digest (VET-07).
   */
  templateSha256: string;
  revisionStatus: "committed" | "working-tree";
  contributor: {
    sourcePath: string;
    files: { path: string; sha256: string }[];
  };
  reviewer: {
    sourcePath: string;
    files: { path: string; sha256: string }[];
  };
  renderer: {
    paths: string[];
    sources: { path: string; sha256: string }[];
    revisionStatus: "committed" | "working-tree";
  };
  acceptedRevisions: string[];
};

export type SkillTemplateSource = {
  index: SkillTemplateIndex;
  readFile(path: string): Promise<Uint8Array>;
};

const MAX_TEMPLATE_FILE_BYTES = 1024 * 1024;

/** Reads the build's published template bytes through the static assets. */
export function assetTemplateSource(
  assets: { fetch(request: Request): Promise<Response> } | undefined,
  origin: string,
): () => Promise<SkillTemplateSource> {
  return async () => {
    if (!assets) throw new Error("Static assets are unavailable");
    const read = async (path: string) => {
      const response = await assets.fetch(
        new Request(`${origin}/skill-templates/${path}`),
      );
      if (!response.ok) throw new Error(`Skill template ${path} is missing`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > MAX_TEMPLATE_FILE_BYTES)
        throw new Error(`Skill template ${path} is too large`);
      return bytes;
    };
    const index = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await read("index.json"),
      ),
    ) as SkillTemplateIndex;
    return { index, readFile: read };
  };
}

export type SkillPublicationDependencies = {
  getProject(id: string): Promise<ProjectRecord | null>;
  listProjects(): Promise<ProjectRecord[]>;
  listEnforcements(): Promise<ProjectEnforcement[]>;
  loadTemplate(): Promise<SkillTemplateSource>;
  /**
   * Security vetting of the revision's exact content, integration-branch head
   * and the digest of the template inputs the skills render from (VET-01,
   * VET-07). Only "cleared" serves a skill. Discovery also requires an
   * active project so the index matches installer refusal of paused work.
   */
  vettingClearance(
    project: ProjectRecord,
    templateSha256: string,
  ): Promise<VettingClearance>;
};

/** Paths the generated publication defines, plus readable aliases. */
const ARTIFACT =
  /^(?:(?:review-)?(?:skill|mission|codex|claude|claude-code|manual)\.md|(?:review-)?skill-manifest\.json|downloads\/[a-z0-9-]{1,96}\.skill(?:\.sha256)?|terms\.json|SKILL\.md|review\/SKILL\.md)$/u;
const ALIASES: Record<string, string> = {
  "SKILL.md": "skill.md",
  "review/SKILL.md": "review-skill.md",
};

function route(
  pathname: string,
): { projectId: string; path: string } | "discovery" | null {
  if (pathname === "/.well-known/slop/projects.json") return "discovery";
  const match = /^\/projects\/([^/]+)\/(.+)$/u.exec(pathname);
  if (!match || !PROJECT_ID.test(match[1]) || !ARTIFACT.test(match[2]))
    return null;
  return { projectId: match[1], path: ALIASES[match[2]] ?? match[2] };
}

function contentType(path: string): string {
  if (path.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".sha256")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function headers(type: string, extra: Record<string, string> = {}) {
  return {
    "access-control-allow-origin": "*",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "content-type": type,
    "referrer-policy": "no-referrer",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "x-content-type-options": "nosniff",
    ...extra,
  };
}

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      ...headers("text/plain; charset=utf-8"),
      "cache-control": "no-store",
    },
  });
}

function bytesResponse(path: string, bytes: Uint8Array): Response {
  return new Response(bytes as Uint8Array<ArrayBuffer>, {
    status: 200,
    headers: headers(
      contentType(path),
      path.startsWith("downloads/") && path.endsWith(".skill")
        ? { "content-disposition": "attachment" }
        : {},
    ),
  });
}

function jsonResponse(value: unknown): Response {
  return bytesResponse(
    "value.json",
    new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`),
  );
}

/** A retired or restricted project serves no skill, guide or archive. */
function listed(
  project: ProjectRecord | null,
  records: ProjectEnforcement[],
): project is ProjectRecord {
  return (
    project !== null &&
    project.manifest.listingTier !== "retired" &&
    publicRestrictionOf(project, records).state === "clear"
  );
}

/** The routing index the bootstrap skill matches a repository origin against. */
async function discovery(
  deps: SkillPublicationDependencies,
): Promise<Response> {
  const [all, records] = await Promise.all([
    deps.listProjects(),
    deps.listEnforcements(),
  ]);
  const template = await deps.loadTemplate();
  // Paused projects may still be cleared (legacy exemption) and may serve
  // skill bytes for inspection, but the bootstrap skill and installer only
  // accept active projects. Keep the discovery index identical to that gate.
  const candidates = all.filter(
    (project) =>
      project.status === "active" &&
      listed(project, records) &&
      publishesGeneratedSkills(project.manifest),
  );
  const clearances = await Promise.all(
    candidates.map((project) =>
      deps.vettingClearance(project, template.index.templateSha256),
    ),
  );
  const projects = candidates.filter(
    (_, index) => clearances[index].state === "cleared",
  );
  return jsonResponse({
    schemaVersion: "1",
    projects: projects.flatMap((project) =>
      project.manifest.repositories.map((repository) => ({
        project_id: project.id,
        project_url: `${PUBLIC_SITE_ORIGIN}/projects/${project.id}/`,
        repository: repository.aliases?.at(-1) ?? repository.id,
        review_skill: project.manifest.reviewSkill.id,
        review_skill_manifest: `${PUBLIC_SITE_ORIGIN}/projects/${project.id}/review-skill-manifest.json`,
        skill: project.manifest.skill.id,
        skill_source: project.manifest.skill.sourcePath,
      })),
    ),
  });
}

async function artifact(
  target: { projectId: string; path: string },
  deps: SkillPublicationDependencies,
): Promise<Response> {
  const [project, records] = await Promise.all([
    deps.getProject(target.projectId),
    deps.listEnforcements(),
  ]);
  const restriction = project && publicRestrictionOf(project, records);
  if (restriction && restriction.state !== "clear")
    return text(
      410,
      `This project is ${restriction.state}. Its skills, guides and archives are not available.\n`,
    );
  if (!listed(project, records)) return text(404, "Project not found.\n");
  if (target.path === "terms.json") {
    const manifest = project.manifest;
    return jsonResponse({
      schemaVersion: "1",
      projectId: manifest.id,
      status: manifest.status,
      steward: manifest.steward,
      authority: manifest.authority,
      terms: manifest.terms,
      // Public program terms only; cases never leave the restricted tables.
      securityBounty: manifest.securityBounty ?? null,
    });
  }
  if (!publishesGeneratedSkills(project.manifest))
    return text(
      404,
      "This project has not published its skills yet. Its maintainers must complete the contribution fields first.\n",
    );
  const template = await deps.loadTemplate();
  const vetting = await deps.vettingClearance(
    project,
    template.index.templateSha256,
  );
  if (vetting.state === "unverified")
    return text(
      503,
      "Slop cannot confirm this repository's retained admission evidence. Try again.\n",
    );
  if (vetting.state !== "cleared")
    return text(
      404,
      "This repository has no usable admission clearance. Slop serves no skill while admission or a required security investigation is unscanned, queued, quarantined, stale or banned.\n",
    );
  const files = await buildProjectPublication({
    template: template.index,
    readFile: template.readFile,
    project: project.manifest,
    revision: project.revision,
    manifestSha256: project.manifestSha256,
    generatedAt: project.updatedAt,
  });
  const bytes = files?.[target.path];
  return bytes === undefined
    ? text(404, "Artifact not found.\n")
    : bytesResponse(target.path, bytes);
}

/** Returns null when the path is not a project artifact, so the SPA serves it. */
export async function handleProjectArtifactRequest(
  request: Request,
  deps: SkillPublicationDependencies,
): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const target = route(new URL(request.url).pathname);
  if (target === null) return null;
  try {
    // Clearance includes current private-evidence availability and expiry. A
    // cached whole response would bypass that check after access expires.
    const response = await (target === "discovery"
      ? discovery(deps)
      : artifact(target, deps));
    const headers = new Headers(response.headers);
    headers.set("cache-control", "no-store");
    return new Response(request.method === "HEAD" ? null : response.body, {
      status: response.status,
      headers,
    });
  } catch {
    console.error("project artifact failure");
    return text(503, "Project artifacts are unavailable. Try again.\n");
  }
}
