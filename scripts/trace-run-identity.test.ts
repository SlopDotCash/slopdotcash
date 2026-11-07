/**
 * A run names the project and repository it belongs to, and the closure check
 * re-derives that pair from the pull request instead of trusting the row. An
 * unchecked pair is accepted and then never counts, so the author only learns
 * at closure. Refuse it at creation instead.
 */
import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { signApiToken } from "../backend/trace/auth";
import {
  CloudflareTracePersistence,
  type R2Bucket,
} from "../backend/trace/cloudflare-persistence";
import {
  handleTraceApi,
  type TraceApiDependencies,
} from "../backend/trace/handler";
import { sqliteD1 } from "../tests/sqlite-d1";
import { seedProject } from "../tests/project-registry.fixture";

const SECRET = "trace-run-identity-test-secret-0123456789abcdef";
const ACTOR = "777101";
const T0 = Date.parse("2026-11-07T00:00:00.000Z");
const GHOST = "0".repeat(40);

function r2(): R2Bucket {
  return {
    async head() {
      return null;
    },
    async put() {
      return {};
    },
    async get() {
      return null;
    },
  };
}

function api() {
  const { db, sqlite } = sqliteD1(
    readdirSync(new URL("../migrations/", import.meta.url))
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  sqlite.exec("PRAGMA foreign_keys=ON");
  seedProject(sqlite, "alpha", "example/alpha", {
    repositories: [
      {
        id: "example/alpha",
        displayName: "example/alpha",
        githubUrl: "https://github.com/example/alpha",
        description: "Reproducible research tooling for everyone.",
        integrationBranch: "main",
        aliases: ["example/alpha-old"],
      },
    ],
  });
  seedProject(sqlite, "beta", "example/beta");
  let counter = 0;
  const deps: TraceApiDependencies = {
    persistence: new CloudflareTracePersistence(db, r2()),
    authSecret: SECRET,
    operatorGithubIds: new Set<string>(),
    now: () => new Date(T0),
    randomId: () => `run-identity-${++counter}`,
    verifyIdentityAssertion: async () => null,
    privateIntakeStatus: async () => ({
      status: "verified",
      enabled: true,
      verifiedAt: new Date(T0).toISOString(),
    }),
  };
  const token = async () => {
    const iat = Math.floor(T0 / 1000);
    return signApiToken(
      {
        iss: "slop.cash",
        aud: "private-trace-api",
        sub: `github:${ACTOR}`,
        githubId: ACTOR,
        githubLogin: "contributor",
        roles: ["contributor"],
        iat,
        exp: iat + 300,
        jti: `run-identity-jti-0123456789-${++counter}`,
      },
      SECRET,
    );
  };
  const createRun = async (projectId: string, repository: string) => {
    const response = await handleTraceApi(
      new Request("http://localhost/api/v1/runs", {
        method: "POST",
        headers: {
          authorization: `Bearer ${await token()}`,
          "content-type": "application/json",
          "idempotency-key": `create-key-${++counter}-0123456789`,
        },
        body: JSON.stringify({
          clientRunId: `client_${counter}`,
          projectId,
          repository,
          projectPolicyRevision: GHOST,
          provider: "openai",
          model: "gpt-5",
          client: "codex",
          clientVersion: "1.0.0",
        }),
      }),
      deps,
    );
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  };
  return { createRun, sqlite };
}

test("an unregistered project is refused at creation", async () => {
  const t = api();
  const refused = await t.createRun("ghost", "example/alpha");
  expect({ status: refused.status, error: refused.body.error }).toEqual({
    status: 404,
    error: "project_not_found",
  });
});

test("a repository outside the project is refused at creation", async () => {
  const t = api();
  const refused = await t.createRun("alpha", "example/beta");
  expect({ status: refused.status, error: refused.body.error }).toEqual({
    status: 422,
    error: "repository_not_in_project",
  });
});

test("the registered pair and its alias are accepted", async () => {
  const t = api();
  for (const repository of ["example/alpha", "example/alpha-old"]) {
    const created = await t.createRun("alpha", repository);
    expect({ repository, status: created.status }).toEqual({
      repository,
      status: 201,
    });
  }
  const rows = t.sqlite
    .query("SELECT project_id, repository FROM trace_runs ORDER BY repository")
    .all() as Array<{ project_id: string; repository: string }>;
  expect(rows).toEqual([
    { project_id: "alpha", repository: "example/alpha" },
    { project_id: "alpha", repository: "example/alpha-old" },
  ]);
});
