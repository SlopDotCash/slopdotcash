import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import { handleProjectApi } from "../backend/projects/handler";
import { handleVettingApi } from "../backend/vetting/handler";
import { CloudflareVettingPersistence } from "../backend/vetting/persistence";
import { ACCEPTED_SKILL_REVISIONS } from "../src/lib/project-skill-publication.mjs";
import { REWARD_ASSET_NETWORKS } from "../src/lib/reward-asset.mjs";
import { applicationManifest } from "../tests/project-application-manifest";
import { sqliteD1 } from "../tests/sqlite-d1";
import {
  acquireQueuedAssessment,
  type QueueConnection,
  readPendingAssessments,
} from "../workers/vetting/queue";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const ORIGIN = "https://slop.cash";
const now = new Date("2026-10-19T12:00:00Z");
const assessmentId = `vet_${"a".repeat(32)}`;
const templateText = "Harmless contributor and reviewer fixture.";
const rendererText = "export const fixture = true;";
const templateInputs = {
  contributor: {
    sourcePath: "skills/contributor",
    files: [{ path: "SKILL.md", sha256: digest(templateText) }],
  },
  reviewer: {
    sourcePath: "skills/reviewer",
    files: [{ path: "SKILL.md", sha256: digest(templateText) }],
  },
  rendererSources: [{ path: "src/render.mjs", sha256: digest(rendererText) }],
  // The deployed index publishes these exact strings (scripts/prepare-site.mjs).
  acceptedRevisions: [...ACCEPTED_SKILL_REVISIONS],
};
const templateSha256 = digest(JSON.stringify(templateInputs));
let root: string;
let commitSha: string;
let treeSha: string;
let blobSha: string;
let vetting: CloudflareVettingPersistence;
let projects: CloudflareProjectPersistence;
let server: ReturnType<typeof Bun.serve>;
let connection: QueueConnection;
let mode: "normal" | "manifest" | "template" | "identity" = "normal";
const methods: string[] = [];
const source = "Harmless source, never executed.";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "slop-queue-workflow-"));
  const repository = join(root, "git");
  await mkdir(repository);
  const git = (...args: string[]) => {
    const output = spawnSync(
      "git",
      ["-c", "core.hooksPath=/dev/null", ...args],
      { cwd: repository },
    );
    if (output.status !== 0) throw new Error(output.stderr.toString());
    return output.stdout.toString().trim();
  };
  git("init", "-q");
  await writeFile(join(repository, "README.txt"), source);
  git("add", ".");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--no-gpg-sign",
    "-qm",
    "Harmless fixture",
  );
  commitSha = git("rev-parse", "HEAD");
  treeSha = git("rev-parse", "HEAD^{tree}");
  blobSha = git("rev-parse", "HEAD:README.txt");
  const { db, sqlite } = sqliteD1([
    "0019_project_registry.sql",
    "0020_project_application_github_check.sql",
    "0023_project_enforcements.sql",
    "0024_notifications.sql",
    "0025_community_security_vetting.sql",
    "0026_private_security_cases.sql",
  ]);
  projects = new CloudflareProjectPersistence(db);
  vetting = new CloudflareVettingPersistence(db);
  const manifest = applicationManifest("queue-fixture", "example/fixture");
  const network = REWARD_ASSET_NETWORKS.ethereum;
  manifest.rewardAsset = {
    ...(manifest.rewardAsset as object),
    decimals: network.stablecoin.decimals,
    chainId: network.chainId,
    cluster: network.cluster,
    verifiedAt: now.toISOString(),
  };
  const manifestText = JSON.stringify(manifest);
  const manifestSha256 = digest(manifestText);
  sqlite
    .prepare(
      "INSERT INTO project_revisions (project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,1,?,?,?,?)",
    )
    .run(
      "queue-fixture",
      manifestText,
      manifestSha256,
      "Fixture approval",
      now.toISOString(),
    );
  sqlite
    .prepare(
      "INSERT INTO projects (id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES (?,'paused',1,?,?,?,?)",
    )
    .run(
      "queue-fixture",
      manifestText,
      manifestSha256,
      now.toISOString(),
      now.toISOString(),
    );
  await vetting.createAssessment({
    id: assessmentId,
    projectId: "queue-fixture",
    revision: 1,
    manifestSha256,
    contentSha256: manifestSha256,
    commitSha,
    templateSha256,
    requestedBy: { githubId: "1", githubLogin: "fixture" },
    requestedAt: now.toISOString(),
    requestReason: "Fixture acquisition",
  });
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKey = Buffer.from(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  ).toString("base64");
  server = Bun.serve({
    port: 0,
    async fetch(incoming) {
      methods.push(incoming.method);
      const path = new URL(incoming.url).pathname;
      const request = new Request(`${ORIGIN}${path}`, incoming);
      if (path === "/api/v1/vetting/requests")
        return (
          (await handleVettingApi(request, {
            vetting,
            projects,
            resultPublicKeys: publicKey,
            livePin: async () => ({ commitSha, templateSha256 }),
            session: async () => null,
            now: () => now,
            randomId: () => "unused",
          })) ?? new Response(null, { status: 404 })
        );
      if (path.startsWith("/api/v1/project-revisions/")) {
        if (mode === "manifest")
          return Response.json({
            projectId: "queue-fixture",
            revision: 1,
            manifestSha256,
            manifestText: "changed",
          });
        return (
          (await handleProjectApi(request, {
            persistence: projects,
            adminGithubIds: new Set(),
            moderatorGithubIds: new Set(),
            now: () => now,
            randomId: () => "unused",
            sessionActor: async () => null,
            notifyAdmins: async () => false,
            repositoryControl: async () => ({
              state: "unproven",
              reason: "fixture",
            }),
            readTokenMetadata: async () => {
              throw new Error("unused");
            },
            github: { fetch: async () => new Response(null, { status: 404 }) },
            vettingClearance: async () => ({ state: "unscanned" }),
          })) ?? new Response(null, { status: 404 })
        );
      }
      if (path === "/repos/example/fixture")
        return Response.json({
          id: mode === "identity" ? 987654321 : 123456789,
          node_id: "R_example",
          full_name: "example/fixture",
          private: false,
        });
      if (path === "/skill-templates/index.json")
        return Response.json({
          schemaVersion: "1",
          repository: "example/templates",
          commit: commitSha,
          templateSha256,
          revisionStatus: "committed",
          contributor: templateInputs.contributor,
          reviewer: templateInputs.reviewer,
          renderer: {
            sources: templateInputs.rendererSources,
            revisionStatus: "committed",
          },
          acceptedRevisions: templateInputs.acceptedRevisions,
        });
      if (path.startsWith("/skill-templates/"))
        return new Response(mode === "template" ? "changed" : templateText);
      if (path.endsWith("/src/render.mjs")) return new Response(rendererText);
      if (path.endsWith(`/commits/${commitSha}`))
        return Response.json({ sha: commitSha, tree: { sha: treeSha } });
      if (path.endsWith(`/trees/${treeSha}`))
        return Response.json({
          sha: treeSha,
          truncated: false,
          tree: [
            { path: "README.txt", mode: "100644", type: "blob", sha: blobSha },
          ],
        });
      if (path.endsWith(`/blobs/${blobSha}`))
        return Response.json({
          sha: blobSha,
          encoding: "base64",
          size: Buffer.byteLength(source),
          content: Buffer.from(source).toString("base64"),
        });
      return new Response(null, { status: 404 });
    },
  });
  connection = {
    origin: ORIGIN,
    ...pair,
    now: () => now,
    fetch: ((request: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(request));
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("error");
      return fetch(
        `http://localhost:${server.port}${url.pathname}${url.search}`,
        init,
      );
    }) as typeof fetch,
  };
});
afterAll(async () => {
  server.stop(true);
  await rm(root, { recursive: true, force: true });
});

test("signed real queue and SQLite revision acquire exact Git and template bytes without finishing assessment", async () => {
  mode = "normal";
  expect((await readPendingAssessments(connection))[0].assessmentId).toBe(
    assessmentId,
  );
  const acquired = await acquireQueuedAssessment(
    connection,
    assessmentId,
    root,
  );
  const bundle = JSON.parse(
    await readFile(join(acquired.directory, "queued-inputs.json"), "utf8"),
  );
  expect(bundle.assessment.commitSha).toBe(commitSha);
  expect(bundle.assessment.templateSha256).toBe(templateSha256);
  expect(bundle.inputs).toHaveLength(3);
  expect(
    await readFile(
      join(acquired.directory, "objects", digest(templateText)),
      "utf8",
    ),
  ).toBe(templateText);
  expect(bundle.state).toBe("quarantined");
  expect(bundle.visibilityGaps).toContain(
    "execution-dependencies-and-release-assets-not-acquired",
  );
  expect(bundle.visibilityGaps).not.toContain(
    "skill-template-inputs-not-acquired",
  );
  expect(bundle.visibilityGaps).toContain(
    "secure-runtime-and-model-review-not-performed",
  );
  expect((await vetting.getAssessment(assessmentId))?.state).toBe("pending");
  expect(new Set(methods)).toEqual(new Set(["GET"]));
  // Optional private capture lets the real analyzer/VM assembly workflow consume
  // these handler-produced bytes. No keys or database are copied.
  if (process.env.SLOP_VETTING_ACQUISITION_EVIDENCE) {
    await cp(
      acquired.directory,
      process.env.SLOP_VETTING_ACQUISITION_EVIDENCE,
      {
        recursive: true,
        errorOnExist: true,
        force: false,
      },
    );
  }
});

test("changed revision/template bytes and wrong signer leave queue pending and no completed bundle", async () => {
  for (const selected of ["manifest", "template", "identity"] as const) {
    mode = selected;
    const before = await readdir(root);
    await expect(
      acquireQueuedAssessment(connection, assessmentId, root),
    ).rejects.toThrow();
    expect(await readdir(root)).toEqual(before);
    expect((await vetting.getAssessment(assessmentId))?.state).toBe("pending");
  }
  const wrong = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  await expect(
    readPendingAssessments({ ...connection, ...wrong }),
  ).rejects.toThrow();
  expect((await vetting.getAssessment(assessmentId))?.state).toBe("pending");
});
