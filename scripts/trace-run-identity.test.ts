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
import { seedProject } from "../tests/project-registry.fixture";
import { sqliteD1 } from "../tests/sqlite-d1";

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
  // Both rows come from the public registry, so the pair under test is one a
  // contributor would actually post and the repository of another project is
  // one that exists.
  seedProject(sqlite, "slopdotcash", "SlopDotCash/slopdotcash");
  seedProject(sqlite, "eliza", "elizaOS/eliza");
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

test("a project that left the registry is refused at creation", async () => {
  const t = api();
  const created = await t.createRun("slopdotcash", "SlopDotCash/slopdotcash");
  expect(created.status).toBe(201);
  // A project row is permanent in production (`projects_no_delete`), so the
  // trigger comes off to represent the row being gone.
  t.sqlite.exec("DROP TRIGGER projects_no_delete");
  t.sqlite.exec("DELETE FROM projects WHERE id = 'slopdotcash'");
  const refused = await t.createRun("slopdotcash", "SlopDotCash/slopdotcash");
  expect({ status: refused.status, error: refused.body.error }).toEqual({
    status: 404,
    error: "project_not_found",
  });
});

test("a repository outside the project is refused at creation", async () => {
  const t = api();
  const refused = await t.createRun("slopdotcash", "elizaOS/eliza");
  expect({ status: refused.status, error: refused.body.error }).toEqual({
    status: 422,
    error: "repository_not_in_project",
  });
  // Control in the same test: the pair that belongs together is accepted.
  const accepted = await t.createRun("slopdotcash", "SlopDotCash/slopdotcash");
  expect(accepted.status).toBe(201);
});

test("the registered pair is accepted and stored as posted", async () => {
  const t = api();
  const created = await t.createRun("slopdotcash", "SlopDotCash/slopdotcash");
  expect(created.status).toBe(201);
  const rows = t.sqlite
    .query("SELECT project_id, repository FROM trace_runs")
    .all() as Array<{ project_id: string; repository: string }>;
  expect(rows).toEqual([
    { project_id: "slopdotcash", repository: "SlopDotCash/slopdotcash" },
  ]);
});

test("a repository registered only as an alias or current path is accepted", async () => {
  const t = api();
  // The schema requires `githubUrl` to match one registered identity, so a
  // renamed repository carries the new path as an alias and the manifest points
  // the URL at it. Both the alias and the derived current path are that string.
  seedProject(t.sqlite, "renamed", "SlopDotCash/slopdotcash", {
    repositories: [
      {
        id: "SlopDotCash/slopdotcash",
        aliases: ["slopcash/old-name"],
        displayName: "slopdotcash",
        githubUrl: "https://github.com/slopcash/old-name",
        description: "Reproducible research tooling for everyone.",
        integrationBranch: "main",
      },
    ],
  });
  const alias = await t.createRun("renamed", "slopcash/old-name");
  expect(alias.body.error).toBeUndefined();
  expect(alias.status).toBe(201);
  // Control in the same test: the primary id still passes, so the alias is what
  // moves when the accepted set is narrowed.
  const primary = await t.createRun("renamed", "SlopDotCash/slopdotcash");
  expect(primary.status).toBe(201);
});
