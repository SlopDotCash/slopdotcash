import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
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
import { REWARD_ASSET_NETWORKS } from "../src/lib/reward-asset.mjs";
import { applicationManifest } from "../tests/project-application-manifest";
import { sqliteD1 } from "../tests/sqlite-d1";
import { localVettingEvidence } from "../tests/vetting-evidence-fixture";
import {
  acquireQueuedAssessment,
  type QueueConnection,
  readPendingAssessments,
} from "../workers/vetting/queue";

let retained: Awaited<ReturnType<typeof localVettingEvidence>>;
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const ORIGIN = "https://slop.cash";
const now = new Date("2026-10-19T12:00:00Z");
const assessmentId = `vet_${"a".repeat(32)}`;
const templateText = "Harmless contributor and reviewer fixture.";
const rendererText = "export const fixture = true;";
const sharedTemplatePath = "skills/contributor/SKILL.md";
const templateInputs = {
  contributor: {
    sourcePath: "skills/contributor",
    files: [{ path: "SKILL.md", sha256: digest(templateText) }],
  },
  reviewer: {
    sourcePath: "skills/reviewer",
    files: [{ path: "SKILL.md", sha256: digest(templateText) }],
  },
  rendererSources: [
    { path: "src/render.mjs", sha256: digest(rendererText) },
    { path: sharedTemplatePath, sha256: digest(templateText) },
  ],
  acceptedRevisions: ["1"],
};
const templateSha256 = digest(JSON.stringify(templateInputs));
let root: string;
let commitSha: string;
/** The local repository that stands in for GitHub's Git transport. */
let repositoryPath: string;
let vetting: CloudflareVettingPersistence;
let projects: CloudflareProjectPersistence;
let server: ReturnType<typeof Bun.serve>;
let connection: QueueConnection;
let mode: "normal" | "manifest" | "template" | "identity" = "normal";
const methods: string[] = [];
const source = "Harmless source, never executed.";
const sourcePath = "README.txt";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "slop-queue-workflow-"));
  const repository = join(root, "git");
  repositoryPath = repository;
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
  await writeFile(join(repository, sourcePath), source);
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
  const { db, sqlite } = sqliteD1(
    (await readdir(new URL("../migrations", import.meta.url)))
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  retained = await localVettingEvidence(db, () => now);
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
            evidence: retained.evidence,
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
            repositoryControl: async () => ({ state: "matched" }),
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
      if (path.endsWith(`/${sharedTemplatePath}`))
        return new Response(templateText);
      return new Response(null, { status: 404 });
    },
  });
  connection = {
    origin: ORIGIN,
    ...pair,
    now: () => now,
    testGitRemote: () => `file://${repositoryPath}`,
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
  await retained?.dispose();
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
});

test("conflicting digests for a shared template path refuse acquisition", async () => {
  mode = "normal";
  const conflictingText = "export const conflicting = true;";
  const conflictingInputs = {
    ...templateInputs,
    rendererSources: templateInputs.rendererSources.map((file) =>
      file.path === sharedTemplatePath
        ? { ...file, sha256: digest(conflictingText) }
        : file,
    ),
  };
  const conflictingSha256 = digest(JSON.stringify(conflictingInputs));
  const conflicted: QueueConnection = {
    ...connection,
    fetch: (async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (
        path.endsWith(`/${sharedTemplatePath}`) &&
        !path.startsWith("/skill-templates/")
      )
        return new Response(conflictingText);
      const response = await connection.fetch!(input, init);
      if (path === "/api/v1/vetting/requests") {
        const queue = await response.json();
        for (const assessment of queue.assessments)
          if (assessment.assessmentId === assessmentId)
            assessment.templateSha256 = conflictingSha256;
        return Response.json(queue);
      }
      if (path === "/skill-templates/index.json") {
        const index = await response.json();
        index.templateSha256 = conflictingSha256;
        index.renderer.sources = conflictingInputs.rendererSources;
        return Response.json(index);
      }
      return response;
    }) as typeof fetch,
  };
  const before = await readdir(root);
  await expect(
    acquireQueuedAssessment(conflicted, assessmentId, root),
  ).rejects.toThrow("Conflicting template input digests");
  expect(await readdir(root)).toEqual(before);
  expect((await vetting.getAssessment(assessmentId))?.state).toBe("pending");
});

test("shared template inputs still verify the second source URL", async () => {
  mode = "normal";
  const changed: QueueConnection = {
    ...connection,
    fetch: (async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (
        path.endsWith(`/${sharedTemplatePath}`) &&
        !path.startsWith("/skill-templates/")
      )
        return new Response("changed renderer source bytes");
      return connection.fetch!(input, init);
    }) as typeof fetch,
  };
  const before = await readdir(root);
  await expect(
    acquireQueuedAssessment(changed, assessmentId, root),
  ).rejects.toThrow("Template file bytes changed");
  expect(await readdir(root)).toEqual(before);
  expect((await vetting.getAssessment(assessmentId))?.state).toBe("pending");
});

test("changed revision/template bytes and wrong signer leave queue pending and no completed bundle", async () => {
  for (const selected of ["manifest", "template", "identity"] as const) {
    mode = selected;
    const before = await readdir(root);
    const failure = await acquireQueuedAssessment(
      connection,
      assessmentId,
      root,
    ).catch((error: unknown) => error);
    // The retry reason separates a refused pin from changed bytes.
    expect((failure as Error).name).toBe(
      selected === "identity" ? "AcquisitionRefusal" : "Error",
    );
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

test("a recorded repository rename acquires through the current GitHub name", async () => {
  mode = "normal";
  // The registry keeps the original path as the id and records the current
  // path as the appended alias and githubUrl (`assertRepositoryTransition`).
  const original = JSON.parse(
    (await projects.getRevisionText("queue-fixture", 1))!.manifestText,
  );
  const [repository] = original.repositories;
  const renamedText = JSON.stringify({
    ...original,
    repositories: [
      {
        ...repository,
        aliases: ["example/renamed"],
        displayName: "example/renamed",
        githubUrl: "https://github.com/example/renamed",
      },
    ],
  });
  const renamedSha256 = digest(renamedText);
  const requested: string[] = [];
  const remotes: string[] = [];
  const renamed: QueueConnection = {
    ...connection,
    testGitRemote: (path) => {
      remotes.push(path);
      return `file://${repositoryPath}`;
    },
    fetch: (async (input, init) => {
      const path = new URL(String(input)).pathname;
      requested.push(path);
      // GitHub answers the former name with a redirect, which acquisition refuses.
      if (path.startsWith("/repos/example/fixture"))
        throw new TypeError("fetch failed: unexpected redirect");
      if (path === "/repos/example/renamed")
        return Response.json({
          id: 123456789,
          node_id: "R_example",
          full_name: "example/renamed",
          private: false,
        });
      if (path.startsWith("/api/v1/project-revisions/"))
        return Response.json({
          projectId: "queue-fixture",
          revision: 1,
          manifestSha256: renamedSha256,
          manifestText: renamedText,
        });
      const response = await connection.fetch!(input, init);
      if (path === "/api/v1/vetting/requests") {
        const queue = await response.json();
        for (const assessment of queue.assessments)
          if (assessment.assessmentId === assessmentId)
            assessment.manifestSha256 = renamedSha256;
        return Response.json(queue);
      }
      return response;
    }) as typeof fetch,
  };
  const acquired = await acquireQueuedAssessment(renamed, assessmentId, root);
  const bundle = JSON.parse(
    await readFile(join(acquired.directory, "queued-inputs.json"), "utf8"),
  );
  expect(bundle.repositoryIdentity).toEqual({
    id: "123456789",
    nodeId: "R_example",
    fullName: "example/renamed",
  });
  expect(
    requested.some((path) => path.startsWith("/repos/example/fixture")),
  ).toBe(false);
  // Source is fetched from the current name only.
  expect(remotes).toEqual(["example/renamed"]);
  await rm(acquired.directory, { recursive: true, force: true });
  expect((await vetting.getAssessment(assessmentId))?.state).toBe("pending");
});

test("an unrecorded repository rename is still refused", async () => {
  mode = "normal";
  const moved: QueueConnection = {
    ...connection,
    fetch: (async (input, init) => {
      if (new URL(String(input)).pathname === "/repos/example/fixture")
        return Response.json({
          id: 123456789,
          node_id: "R_example",
          full_name: "example/elsewhere",
          private: false,
        });
      return connection.fetch!(input, init);
    }) as typeof fetch,
  };
  const before = await readdir(root);
  const failure = await acquireQueuedAssessment(
    moved,
    assessmentId,
    root,
  ).catch((error: unknown) => error);
  expect((failure as Error).name).toBe("AcquisitionRefusal");
  expect(await readdir(root)).toEqual(before);
});
