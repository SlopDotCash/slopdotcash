import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { renderProjectSkill } from "../../src/lib/project-skill.mjs";
import { applicationManifest } from "../../tests/project-application-manifest";
import { sqliteD1 } from "../../tests/sqlite-d1";
import {
  closureEligibility,
  hasRecordedSkillRun,
  isMember,
} from "./closure-eligibility";

const NOW = "2026-10-30T14:00:00.000Z";
const databases: { close(): void }[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function setupRenamedProject() {
  const { db, sqlite } = sqliteD1(
    readdirSync("migrations")
      .filter((p) => p.endsWith(".sql"))
      .sort(),
  );
  databases.push(sqlite);
  const raw = applicationManifest("alpha", "example/alpha", {
    status: "active",
    rewardAsset: {
      network: "ethereum",
      kind: "stablecoin",
      address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      symbol: "USDC",
      chainId: "1",
      cluster: null,
      decimals: 6,
      verifiedAt: NOW,
    },
    repositories: [
      {
        id: "example/alpha",
        aliases: ["renamed-org/alpha-next"],
        displayName: "renamed-org/alpha-next",
        githubUrl: "https://github.com/renamed-org/alpha-next",
        description: "Reproducible research tooling for everyone.",
        integrationBranch: "main",
      },
      {
        id: "renamed-org/alpha-docs",
        displayName: "renamed-org/alpha-docs",
        githubUrl: "https://github.com/renamed-org/alpha-docs",
        description: "Documentation repository.",
        integrationBranch: "main",
      },
    ],
    links: {
      repository: "https://github.com/renamed-org/alpha-next",
      issues: "https://github.com/renamed-org/alpha-next/issues",
    },
  });
  const definition = assertProjectDefinition(raw);
  const manifest = JSON.stringify(definition);
  const digest = createHash("sha256").update(manifest).digest("hex");
  sqlite
    .query(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES('alpha',1,?,?,'repository transfer',?)",
    )
    .run(manifest, digest, NOW);
  sqlite
    .query(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES('alpha','active',1,?,?,?,?)",
    )
    .run(manifest, digest, NOW, NOW);
  for (const key of [
    "example/alpha",
    "renamed-org/alpha-next",
    "renamed-org/alpha-docs",
  ]) {
    sqlite
      .query(
        "INSERT INTO project_repositories(repository_key,project_id) VALUES(?,'alpha')",
      )
      .run(key);
  }
  sqlite
    .query(
      "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,1)",
    )
    .run(btoa("04:User42"), "42", "contributor", NOW);
  return { db, sqlite, definition };
}

test("matches a recorded Slop run across a repository rename or transfer", async () => {
  const { db, sqlite, definition } = setupRenamedProject();
  const rendered = renderProjectSkill({
    role: "contributor",
    templateFiles: {
      "SKILL.md": new TextEncoder().encode("# {{SLOP_SKILL_NAME}}"),
    },
    manifest: definition,
    registry: { revision: 1, manifestSha256: "a".repeat(64) },
  });
  const skillProject = JSON.parse(
    new TextDecoder().decode(rendered["project.json"]),
  ) as {
    repositoryId: string;
  };
  expect(skillProject.repositoryId).toBe("example/alpha");

  sqlite
    .query(
      `INSERT INTO trace_runs(
        id, client_run_id, github_user_id, github_login, project_id,
        repository, project_policy_revision, provider, model, client,
        client_version, state, trace_sha256, created_at, finalized_at,
        create_idempotency_key
      ) VALUES (
        'run_renamed_1', 'client_1', '42', 'contributor', 'alpha',
        ?, 'rev-1', 'google', 'gemini-3.1-pro', 'antigravity',
        '1.0.0', 'awaiting_trace', NULL, ?, NULL, 'idem_run_1'
      )`,
    )
    .run(skillProject.repositoryId, NOW);
  sqlite
    .query(
      `INSERT INTO run_progress_events(
        id, run_id, github_user_id, kind, occurred_at, source,
        github_object_id, github_url, head_sha, created_at, idempotency_key
      ) VALUES (
        'evt_renamed_1', 'run_renamed_1', '42', 'pull_request_opened', ?, 'agent',
        'PR_kwDO_renamed_1', 'https://github.com/renamed-org/alpha-next/pull/7',
        NULL, ?, 'idem_evt_1'
      )`,
    )
    .run(NOW, NOW);

  const member = await isMember(db, 42);
  const recordedSkillRun = await hasRecordedSkillRun(db, {
    authorId: 42,
    projectId: "alpha",
    owner: "renamed-org",
    repo: "alpha-next",
    nodeId: "PR_kwDO_renamed_1",
  });
  expect(member).toBe(true);
  expect(recordedSkillRun).toBe(true);
  expect(
    closureEligibility({
      itemKind: "pull_request",
      exemption: "not-exempt",
      member,
      recordedSkillRun,
    }),
  ).toEqual({
    eligible: true,
    why: "verified member with a recorded Slop run for this pull request",
  });
});

test("isolates sibling repositories and rejects mismatched authors or pull request node IDs", async () => {
  const { db, sqlite } = setupRenamedProject();
  sqlite
    .query(
      `INSERT INTO trace_runs(
        id, client_run_id, github_user_id, github_login, project_id,
        repository, project_policy_revision, provider, model, client,
        client_version, state, trace_sha256, created_at, finalized_at,
        create_idempotency_key
      ) VALUES (
        'run_docs_1', 'client_docs', '42', 'contributor', 'alpha',
        'renamed-org/alpha-docs', 'rev-1', 'google', 'gemini-3.1-pro', 'antigravity',
        '1.0.0', 'awaiting_trace', NULL, ?, NULL, 'idem_run_docs'
      )`,
    )
    .run(NOW);
  sqlite
    .query(
      `INSERT INTO run_progress_events(
        id, run_id, github_user_id, kind, occurred_at, source,
        github_object_id, github_url, head_sha, created_at, idempotency_key
      ) VALUES (
        'evt_docs_1', 'run_docs_1', '42', 'pull_request_opened', ?, 'agent',
        'PR_kwDO_docs_1', 'https://github.com/renamed-org/alpha-docs/pull/1',
        NULL, ?, 'idem_evt_docs'
      )`,
    )
    .run(NOW, NOW);

  expect(
    await hasRecordedSkillRun(db, {
      authorId: 42,
      projectId: "alpha",
      owner: "renamed-org",
      repo: "alpha-next",
      nodeId: "PR_kwDO_docs_1",
    }),
  ).toBe(false);
  expect(
    await hasRecordedSkillRun(db, {
      authorId: 99,
      projectId: "alpha",
      owner: "renamed-org",
      repo: "alpha-docs",
      nodeId: "PR_kwDO_docs_1",
    }),
  ).toBe(false);
  expect(
    await hasRecordedSkillRun(db, {
      authorId: 42,
      projectId: "alpha",
      owner: "renamed-org",
      repo: "alpha-docs",
      nodeId: "PR_kwDO_other",
    }),
  ).toBe(false);
  expect(
    await hasRecordedSkillRun(db, {
      authorId: 42,
      projectId: "alpha",
      owner: "renamed-org",
      repo: "alpha-docs",
      nodeId: "PR_kwDO_docs_1",
    }),
  ).toBe(true);
});
