// A renamed or transferred repository keeps its original path as the
// manifest id and records the current path as the appended alias and the
// githubUrl (`assertRepositoryTransition`, `repositoryKeys`). The owner checks
// run the production `repositoryControl` against GitHub's current answer, so a
// project with a recorded transfer must still match, and a later rename that
// the manifest does not record must still be refused.
import { expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { readdirSync } from "node:fs";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import {
  handleProjectApi,
  type ProjectApiDependencies,
} from "../backend/projects/handler";
import { slopbotRepositoryAccess } from "../backend/projects/repository-access";
import { repositoryControl } from "../backend/projects/setup";
import { sha256Hex } from "../src/lib/sha256";
import { applicationManifest } from "../tests/project-application-manifest";
import { sqliteD1 } from "../tests/sqlite-d1";
import { routeRepositoryAccess } from "../workers/slopbot/repository-access";

const NOW = "2026-10-27T00:00:00.000Z";
const OWNER = { githubId: "900000002", githubLogin: "owner" };
const API = "https://api.github.com";

/** GitHub's answer for repository 123456789 under its current name. */
function repositoryFacts(fullName: string) {
  return {
    id: 123456789,
    node_id: "R_example",
    full_name: fullName,
    private: false,
    owner: {
      id: 987654321,
      node_id: "O_example",
      login: "example",
      type: "Organization" as const,
    },
  };
}

/** A project registered as example/open-registry, then renamed on GitHub to
 * example/renamed-registry and recorded the way the registry rules require. */
function renamedProject(currentName: string) {
  const { db, sqlite } = sqliteD1(
    readdirSync(new URL("../migrations/", import.meta.url))
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  const base = applicationManifest("open-registry", "example/open-registry");
  const [repository] = base.repositories as Record<string, unknown>[];
  const manifest = JSON.stringify({
    ...base,
    // The stored form of the verified reward asset.
    rewardAsset: {
      ...(base.rewardAsset as Record<string, unknown>),
      decimals: 6,
      chainId: "1",
      cluster: null,
      verifiedAt: "2026-10-10T00:00:00.000Z",
    },
    repositories: [
      {
        ...repository,
        aliases: ["example/renamed-registry"],
        displayName: "example/renamed-registry",
        githubUrl: "https://github.com/example/renamed-registry",
      },
    ],
  });
  sqlite
    .prepare(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES('open-registry',1,?,?,'Fixture',?)",
    )
    .run(manifest, sha256Hex(manifest), NOW);
  sqlite
    .prepare(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES('open-registry','paused',1,?,?,?,?)",
    )
    .run(manifest, sha256Hex(manifest), NOW, NOW);
  // GitHub answers every former name with the repository under its current name.
  const current = repositoryFacts(currentName);
  const github = {
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      return url.startsWith(`${API}/repos/example/`)
        ? Response.json(current)
        : Response.json({ message: "Not Found" }, { status: 404 });
    }) as typeof fetch,
    token: undefined,
    apiOrigin: API,
  };
  const deps: ProjectApiDependencies = {
    persistence: new CloudflareProjectPersistence(db),
    adminGithubIds: new Set(),
    moderatorGithubIds: new Set(),
    now: () => new Date(NOW),
    randomId: () => crypto.randomUUID(),
    sessionActor: async () => OWNER,
    readTokenMetadata: async () => {
      throw new Error("No asset edit in this workflow");
    },
    github: { fetch: github.fetch },
    vettingClearance: async () => ({ state: "unscanned" }),
    repositoryControl: (manifest, facts) =>
      repositoryControl(manifest, github, facts),
    repositoryAccess: async () => ({
      installation: "installed",
      installationId: 42,
      permission: "admin",
      roleName: "admin",
      repository: current,
    }),
  };
  return deps;
}

async function setupCheck(deps: ProjectApiDependencies) {
  const response = await handleProjectApi(
    new Request("https://slop.cash/api/v1/project-setup/open-registry/check", {
      method: "POST",
      headers: {
        origin: "https://slop.cash",
        "content-type": "application/json",
      },
      body: "{}",
    }),
    deps,
  );
  if (response === null) throw new Error("No project API response");
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    setup: { checks: { authority: { state: string; message: string } } };
  };
  return body.setup.checks.authority;
}

test("an owner of a repository with a recorded rename keeps setup authority", async () => {
  expect(
    await setupCheck(renamedProject("example/renamed-registry")),
  ).toMatchObject({
    state: "verified",
  });
});

async function reviseHeadline(deps: ProjectApiDependencies) {
  const current = await deps.persistence.getProject("open-registry");
  if (current === null) throw new Error("open-registry is not listed");
  const response = await handleProjectApi(
    new Request("https://slop.cash/api/v1/projects/open-registry", {
      method: "PUT",
      headers: {
        origin: "https://slop.cash",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        manifest: {
          ...current.manifest,
          headline: "Reproducible research tooling under its new name.",
        },
        expectedRevision: current.revision,
      }),
    }),
    deps,
  );
  if (response === null) throw new Error("No project API response");
  return {
    status: response.status,
    body: (await response.json()) as { error?: string; message?: string },
    revision: (await deps.persistence.getProject("open-registry"))?.revision,
  };
}

test("an owner of a repository with a recorded rename can publish a revision", async () => {
  const result = await reviseHeadline(
    renamedProject("example/renamed-registry"),
  );
  expect(result.status).toBe(200);
  expect(result.revision).toBe(2);
});

/**
 * The production Slopbot repository-access route (service binding client and
 * Worker) against GitHub's App API. GitHub serves a renamed repository only
 * under its current name: an authenticated read of a former name answers 301
 * to `/repositories/:id/...`, and the Worker does not follow redirects.
 */
function slopbotAccess(
  currentName: string,
): ProjectApiDependencies["repositoryAccess"] {
  const env = {
    SLOPBOT_APP_ID: "1",
    SLOPBOT_APP_PRIVATE_KEY: generateKeyPairSync("rsa", {
      modulusLength: 2048,
    })
      .privateKey.export({ format: "pem", type: "pkcs8" })
      .toString(),
  };
  const current = repositoryFacts(currentName);
  const repository = `/repos/${currentName}`;
  const github = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname } = new URL(String(input));
    if (pathname === `${repository}/installation`)
      return Response.json({ id: 42, suspended_at: null });
    if (
      pathname === "/app/installations/42/access_tokens" &&
      init?.method === "POST"
    )
      return Response.json(
        { token: "installation-token-fixture" },
        { status: 201 },
      );
    if (pathname === repository) return Response.json(current);
    if (
      pathname === `${repository}/collaborators/${OWNER.githubLogin}/permission`
    )
      return Response.json({
        permission: "admin",
        role_name: "admin",
        user: { id: Number(OWNER.githubId) },
      });
    const former = /^\/repos\/example\/[^/]+(\/.*)?$/u.exec(pathname);
    if (former !== null)
      return Response.json(
        {
          message: "Moved Permanently",
          url: `${API}/repositories/${current.id}${former[1] ?? ""}`,
        },
        {
          status: 301,
          headers: {
            location: `${API}/repositories/${current.id}${former[1] ?? ""}`,
          },
        },
      );
    return Response.json({ message: "Not Found" }, { status: 404 });
  }) as typeof fetch;
  const slopbot = {
    fetch: async (request: Request) =>
      (await routeRepositoryAccess(request, env, github)) ??
      new Response("not found", { status: 404 }),
  };
  return (target, actor) => slopbotRepositoryAccess(slopbot, target, actor);
}

test("Slopbot reads a repository with a recorded rename under its current name", async () => {
  const deps = {
    ...renamedProject("example/renamed-registry"),
    repositoryAccess: slopbotAccess("example/renamed-registry"),
  };
  expect(await setupCheck(deps)).toMatchObject({
    state: "verified",
  });
  const result = await reviseHeadline(deps);
  expect(result.status).toBe(200);
  expect(result.revision).toBe(2);
});

test("a later rename that the manifest does not record is still refused", async () => {
  const deps = renamedProject("example/third-name");
  expect(await setupCheck(deps)).toMatchObject({
    state: "denied",
  });
  const result = await reviseHeadline(deps);
  expect(result).toMatchObject({
    status: 422,
    body: {
      error: "invalid_manifest",
    },
    revision: 1,
  });
});
