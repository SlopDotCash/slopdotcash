// spec/contributor/publication.md, "Skill artifacts need published skill fields and current clearance, and an unverified clearance answers retry"
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { bundle, migrate, startWorker } from "@repo/platform/testing";
import { migrationsDir, repoRoot } from "@repo/platform/testing/paths";
import { type Role, templatePaths } from "../../../src/render/fields.ts";
import { acceptedRevisions, decodeTemplateIndex, guideRendererPaths, rendererSourcePaths, sha256Hex, sourceRepository, templateFilePath, templateGroup, templateSha256 } from "../../../src/render/templateIndex.ts";
import { listFilesRecursively } from "./harness.ts";

const site = "https://slop.test";
const roles: ReadonlyArray<Role> = ["contributor", "reviewer"];

export interface PublishedSite {
  readonly origin: string;
  close(): Promise<void>;
}

export interface SitePlan {
  readonly commit: string;
  readonly projectId: string;
  readonly revision: number;
  readonly manifestText: string;
}

function treeOf(directory: string) {
  const root = join(repoRoot, directory);
  return listFilesRecursively(root).map((file) => ({ path: file.slice(root.length + 1).split("\\").join("/"), bytes: new Uint8Array(readFileSync(file)) }));
}

function siteFiles(commit: string) {
  const groups = roles.map((role) => {
    const files = treeOf(templatePaths[role]);
    const grouped = templateGroup(role, files);
    if (grouped.kind !== "group") throw new Error(`${templatePaths[role]} is not a bounded template tree`);
    return { group: grouped.group, files };
  });
  const [contributor, reviewer] = groups;
  if (contributor === undefined || reviewer === undefined) throw new Error("both template groups are required");
  const sources = rendererSourcePaths.map((path) => ({ path, sha256: sha256Hex(new Uint8Array(readFileSync(join(repoRoot, path)))) }));
  const indexText = `${JSON.stringify({
    schemaVersion: "1",
    repository: sourceRepository,
    commit,
    templateSha256: templateSha256({ contributor: contributor.group, reviewer: reviewer.group, rendererSources: sources, acceptedRevisions }),
    revisionStatus: "committed",
    contributor: contributor.group,
    reviewer: reviewer.group,
    renderer: { paths: [...guideRendererPaths], sources, revisionStatus: "committed" },
    acceptedRevisions: [...acceptedRevisions],
  }, null, 2)}\n`;
  const decoded = decodeTemplateIndex(indexText);
  if (decoded.kind !== "decoded") throw new Error(`the fixture template index does not decode: ${decoded.kind}`);
  const files = [{ path: "skill-templates/index.json", bytes: new TextEncoder().encode(indexText) }];
  for (const { group, files: tree } of groups) {
    for (const file of tree) files.push({ path: `skill-templates/${templateFilePath(group, { path: file.path, sha256: sha256Hex(file.bytes) })}`, bytes: file.bytes });
  }
  return { files, templateSha256: decoded.index.templateSha256 };
}

/** @throws {Error} */
export async function servePublication(plan: SitePlan): Promise<PublishedSite> {
  const assets = mkdtempSync(join(tmpdir(), "slop-installer-site-"));
  const { files, templateSha256: pin } = siteFiles(plan.commit);
  for (const file of files) {
    mkdirSync(dirname(join(assets, file.path)), { recursive: true });
    writeFileSync(join(assets, file.path), file.bytes);
  }
  const script = await bundle(join(import.meta.dirname, "..", "..", ".."), { config: "test/support/installer/vite.config.ts", entry: "installerPublication" });
  const mf = startWorker({ script, d1: { SLOP_DB: "slop-private" }, assets });
  const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
  if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
  const db = await mf.getD1Database("SLOP_DB");
  const digest = sha256Hex(new TextEncoder().encode(plan.manifestText));
  const at = "2026-11-01T00:00:00.000Z";
  await db.prepare("INSERT INTO project_revisions (project_id, revision, manifest, manifest_sha256, reason, actor_github_id, actor_github_login, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(plan.projectId, plan.revision, plan.manifestText, digest, `Revision ${plan.revision}`, "41", "member-41", at).run();
  await db.prepare("INSERT INTO projects (id, status, revision, manifest, manifest_sha256, created_at, updated_at) VALUES (?, 'active', ?, ?, ?, ?, ?)").bind(plan.projectId, plan.revision, plan.manifestText, digest, at, at).run();
  const planned = await mf.dispatchFetch(`${site}/api/v1/test/publication-security`, {
    method: "POST",
    headers: { origin: site, "content-type": "application/json" },
    body: JSON.stringify({ restrictions: [], clearances: [{ projectId: plan.projectId, revision: plan.revision, templateSha256: pin, read: "ClearanceCleared" }] }),
  });
  if (planned.status !== 200) throw new Error(`the security plan was refused: ${planned.status} ${await planned.text()}`);
  const bridge = createServer((request, response) => {
    mf.dispatchFetch(`${site}${request.url ?? "/"}`, { method: request.method ?? "GET" })
      .then(async (answer) => {
        response.statusCode = answer.status;
        const type = answer.headers.get("content-type");
        if (type !== null) response.setHeader("content-type", type);
        response.end(Buffer.from(await answer.arrayBuffer()));
      })
      .catch((error: unknown) => {
        response.statusCode = 599;
        response.end(String(error));
      });
  });
  const port = await new Promise<number>((resolve) => bridge.listen(0, "127.0.0.1", () => {
    const address = bridge.address();
    resolve(typeof address === "object" && address !== null ? address.port : 0);
  }));
  return {
    origin: `http://127.0.0.1:${port}/projects/${plan.projectId}`,
    close: async () => {
      await new Promise<void>((resolve) => bridge.close(() => resolve()));
      await mf.dispose();
      rmSync(assets, { recursive: true, force: true });
    },
  };
}
