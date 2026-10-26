import {
  CloudflareProjectPersistence,
  type ProjectD1Database,
} from "../backend/projects/cloudflare-persistence";
import { githubApiOrigin } from "../backend/projects/github-lookup";
import {
  assetTemplateSource,
  handleProjectArtifactRequest,
} from "../backend/projects/skill-publication";
import type { R2Bucket } from "../backend/trace/cloudflare-persistence";
import { VettingEvidence } from "../backend/vetting/evidence";
import {
  readVettingPin,
  vettingBranchCache,
} from "../backend/vetting/live-pin";
import { CloudflareVettingPersistence } from "../backend/vetting/persistence";
import { onRequest as socialMetadata } from "./index";

type Env = {
  SLOP_DB?: ProjectD1Database;
  VETTING_EVIDENCE?: R2Bucket;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  /** Local browser tests only: a loopback GitHub API fixture origin. */
  SLOP_GITHUB_API_ORIGIN?: string;
  /** Optional read-only GitHub token for integration-branch head reads. */
  SLOP_GITHUB_READ_TOKEN?: string;
};

type PagesContext = {
  request: Request;
  env: Env;
  next(): Promise<Response>;
  waitUntil?: (promise: Promise<unknown>) => void;
};

export async function onRequest(context: PagesContext): Promise<Response> {
  const db = context.env.SLOP_DB;
  if (db !== undefined) {
    const persistence = new CloudflareProjectPersistence(db);
    const evidence = new VettingEvidence({
      db,
      bucket: context.env.VETTING_EVIDENCE,
      now: () => new Date(),
      randomId: () => crypto.randomUUID(),
    });
    const vetting = new CloudflareVettingPersistence(
      db,
      async (assessment) =>
        assessment.result !== null && evidence.retained(assessment.result),
    );
    const github = {
      fetch: (url: string, init: RequestInit) => fetch(url, init),
      token: context.env.SLOP_GITHUB_READ_TOKEN,
      apiOrigin: githubApiOrigin(context.env.SLOP_GITHUB_API_ORIGIN),
      cache: vettingBranchCache(context.request),
    };
    const artifact = await handleProjectArtifactRequest(context.request, {
      getProject: (id) => persistence.getProject(id),
      listProjects: () => persistence.listProjects(),
      listEnforcements: () => persistence.listEnforcements(),
      loadTemplate: assetTemplateSource(
        context.env.ASSETS,
        new URL(context.request.url).origin,
      ),
      vettingClearance: (project, templateSha256) =>
        vetting.manifestClearance(
          project.id,
          project.manifest,
          project.revision,
          () => readVettingPin(github, project.manifest, templateSha256),
        ),
    });
    if (artifact !== null) return artifact;
  }
  return socialMetadata(context);
}
