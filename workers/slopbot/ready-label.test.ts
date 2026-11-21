// The slopbot:ready label (operator decision, 16 November 2026; PRD section
// 5). Slopbot labels a pull request and adds one comment line only while all
// five conditions hold at the exact head commit, removes the label when one
// stops holding, and never merges. Local HTTP fixtures exercise the control.

import type { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { findProject } from "../../src/lib/projects.mjs";
import {
  assertReadyLabelSettings,
  type ReadyLabelSettings,
  readyLabelSettings,
} from "../../src/lib/slopbot-ready.mjs";
import { MIGRATIONS, sqliteD1 } from "../../tests/sqlite-d1";
import type { Job } from "./contracts";
import type { D1Database, D1QueryStatement } from "./persistence";
import {
  type ChangedFile,
  dispatchReadyChecks,
  LARGE_DELETION_LINES,
  ownerPatternRegExp,
  PENDING_RECHECK_MS,
  protectedChange,
  protectedPathReason,
  READY_LABEL,
  READY_LINE_MARKER,
  type ReadyFacts,
  type ReadyJob,
  readyDecision,
  readyJob,
  readyLabelWanted,
  refreshReadyLabel,
  withReadyLine,
} from "./ready-label";

const SETTINGS: ReadyLabelSettings = {
  enabled: true,
  approvals: 1,
  maxChangedLines: 400,
  maxChangedFiles: 20,
  protectedPaths: [],
};

const FILE: ChangedFile = {
  filename: "src/parser.ts",
  status: "modified",
  additions: 10,
  deletions: 2,
  patch: "@@ -1 +1 @@\n-a\n+b",
};

const READY: ReadyFacts = {
  open: true,
  draft: false,
  mergeable: true,
  mergeableState: "clean",
  verdict: "none",
  additions: 10,
  deletions: 2,
  changedFiles: 1,
  files: [FILE],
  approvals: 1,
  changesRequested: false,
};

// ---------------------------------------------------------------------------
// The decision, one condition at a time.

test("all five conditions at the head commit make the pull request ready", () => {
  expect(readyDecision(READY, SETTINGS)).toEqual({
    ready: true,
    reason: "all conditions hold",
    pending: false,
  });
});

test("condition 1: checks not all passing or the branch not mergeable is not ready", () => {
  for (const state of ["unstable", "blocked", "behind", "dirty", "unknown"]) {
    const decision = readyDecision(
      { ...READY, mergeableState: state, mergeable: state !== "dirty" },
      SETTINGS,
    );
    expect(decision.ready).toBe(false);
    expect(decision.reason).toContain("every check passing");
  }
  // Pending check results have no webhook, so they are checked again.
  expect(
    readyDecision({ ...READY, mergeableState: "unstable" }, SETTINGS).pending,
  ).toBe(true);
  expect(
    readyDecision(
      { ...READY, mergeable: false, mergeableState: "dirty" },
      SETTINGS,
    ).pending,
  ).toBe(false);
  expect(
    readyDecision({ ...READY, mergeable: null, mergeableState: null }, SETTINGS)
      .ready,
  ).toBe(false);
});

test("condition 2: a finding, a limited review, a running or missing review is not ready", () => {
  expect(readyDecision({ ...READY, verdict: "finding" }, SETTINGS).reason).toBe(
    "Slopbot's review of this commit has a finding",
  );
  expect(readyDecision({ ...READY, verdict: "limited" }, SETTINGS).ready).toBe(
    false,
  );
  expect(readyDecision({ ...READY, verdict: "missing" }, SETTINGS).ready).toBe(
    false,
  );
  const running = readyDecision({ ...READY, verdict: "running" }, SETTINGS);
  expect(running.ready).toBe(false);
  expect(running.pending).toBe(true);
});

test("condition 3: too few approvals or an open change request is not ready", () => {
  expect(readyDecision({ ...READY, approvals: 0 }, SETTINGS).reason).toBe(
    "0 of 1 required approvals at this commit from accounts with write access",
  );
  expect(
    readyDecision({ ...READY, approvals: 1 }, { ...SETTINGS, approvals: 2 })
      .ready,
  ).toBe(false);
  expect(
    readyDecision({ ...READY, approvals: 2 }, { ...SETTINGS, approvals: 2 })
      .ready,
  ).toBe(true);
  expect(
    readyDecision({ ...READY, approvals: 3, changesRequested: true }, SETTINGS)
      .reason,
  ).toBe("an account with write access requested changes");
});

test("condition 4: over the line or file cap, or a large deletion, is not ready", () => {
  expect(
    readyDecision({ ...READY, additions: 399, deletions: 2 }, SETTINGS).reason,
  ).toBe("401 changed lines is over the cap of 400");
  expect(
    readyDecision({ ...READY, changedFiles: 21, files: null }, SETTINGS).reason,
  ).toBe("21 changed files is over the cap of 20");
  expect(
    readyDecision(
      { ...READY, additions: 0, deletions: LARGE_DELETION_LINES + 1 },
      { ...SETTINGS, maxChangedLines: 5000 },
    ).reason,
  ).toContain("large deletion");
  // An incomplete file list never counts as clear.
  expect(readyDecision({ ...READY, files: null }, SETTINGS).ready).toBe(false);
  expect(readyDecision({ ...READY, changedFiles: 2 }, SETTINGS).ready).toBe(
    false,
  );
});

test("condition 5: a protected path is refused, and so are deletions and binaries", () => {
  const touches = (file: Partial<ChangedFile>) =>
    readyDecision({ ...READY, files: [{ ...FILE, ...file }] }, SETTINGS);
  expect(touches({ filename: ".github/workflows/ci.yml" }).reason).toBe(
    "it touches CI or GitHub settings (.github/workflows/ci.yml)",
  );
  expect(touches({ filename: "web/package.json" }).ready).toBe(false);
  expect(touches({ filename: "contracts/Vault.sol" }).ready).toBe(false);
  expect(touches({ filename: "SECURITY.md" }).reason).toBe(
    "it touches SECURITY.md (SECURITY.md)",
  );
  expect(touches({ status: "removed" }).reason).toBe(
    "it touches a deleted file (src/parser.ts)",
  );
  expect(touches({ patch: undefined }).reason).toContain("binary");
  // A rename out of a protected path is refused by its previous name.
  expect(
    touches({
      filename: "docs/old-ci.yml",
      previous_filename: ".github/workflows/old.yml",
      status: "renamed",
    }).ready,
  ).toBe(false);
});

test("the built-in protected set covers each category the operator named", () => {
  const cases: [string, string][] = [
    [".github/dependabot.yml", "CI or GitHub settings"],
    [".gitlab-ci.yml", "CI or GitHub settings"],
    [".circleci/config.yml", "CI or GitHub settings"],
    ["package-lock.json", "a dependency manifest or lockfile"],
    ["services/api/go.sum", "a dependency manifest or lockfile"],
    ["Cargo.toml", "a dependency manifest or lockfile"],
    ["requirements-dev.txt", "a dependency manifest or lockfile"],
    ["bun.lock", "a dependency manifest or lockfile"],
    ["src/payments/fees.ts", "contracts or payment code"],
    ["programs/escrow/src/lib.rs", "contracts or payment code"],
    ["evm/Token.sol", "contracts or payment code"],
    ["skills/slop/SKILL.md", "a skill, agent or policy file"],
    ["AGENTS.md", "a skill, agent or policy file"],
    ["docs/CLAUDE.md", "a skill, agent or policy file"],
    ["LICENSE", "a skill, agent or policy file"],
    [".github/slop-project.json", "CI or GitHub settings"],
    ["slop-project.json", "the Slop project manifest"],
    ["Security.md", "SECURITY.md"],
    ["assets/logo.png", "a binary file or a file without a text diff"],
    ["dist/app.wasm", "a binary file or a file without a text diff"],
  ];
  for (const [path, reason] of cases)
    expect([path, protectedPathReason(path)]).toEqual([path, reason]);
  for (const path of ["src/parser.ts", "docs/guide.md", "README.md"])
    expect(protectedPathReason(path)).toBeNull();
});

test("owner patterns add protected paths and never remove the built-in ones", () => {
  const owner = ["docs/legal/", "*.sql", "src/**/generated/*.ts"];
  expect(protectedPathReason("docs/legal/terms.md", owner)).toBe(
    "a path this project protects",
  );
  expect(protectedPathReason("db/migrations/0001.sql", owner)).toBe(
    "a path this project protects",
  );
  expect(protectedPathReason("src/a/b/generated/x.ts", owner)).toBe(
    "a path this project protects",
  );
  expect(protectedPathReason("docs/guide.md", owner)).toBeNull();
  // An owner pattern cannot unprotect a default: there is no exclusion form,
  // and the built-in set is checked first.
  expect(protectedPathReason(".github/workflows/ci.yml", ["!.github/"])).toBe(
    "CI or GitHub settings",
  );
  expect(ownerPatternRegExp("docs").test("site/docs/a.md")).toBe(true);
  expect(ownerPatternRegExp("docs/a").test("site/docs/a")).toBe(false);
  expect(protectedChange([{ ...FILE, filename: "db/schema.sql" }], owner)).toBe(
    "a path this project protects (db/schema.sql)",
  );
});

test("an open or draft state blocks readiness", () => {
  expect(readyDecision({ ...READY, open: false }, SETTINGS).ready).toBe(false);
  expect(readyDecision({ ...READY, draft: true }, SETTINGS).ready).toBe(false);
});

test("the comment line is added before the details, replaced and removed", () => {
  const body = [
    "<!-- slopbot:review -->",
    "**Slopbot review complete — no finding**",
    "",
    "Summary.",
    "",
    "<details><summary>Review details</summary>",
    "",
    "- Reviewed revision: `b`",
    "</details>",
  ].join("\n");
  const first = withReadyLine(body, `${READY_LINE_MARKER} first`);
  expect(
    first.split("\n").filter((l) => l.startsWith(READY_LINE_MARKER)),
  ).toEqual([`${READY_LINE_MARKER} first`]);
  expect(first.indexOf(READY_LINE_MARKER)).toBeLessThan(
    first.indexOf("<details>"),
  );
  const second = withReadyLine(first, `${READY_LINE_MARKER} second`);
  expect(second).toContain("second");
  expect(second).not.toContain("first");
  expect(withReadyLine(second, null)).not.toContain(READY_LINE_MARKER);
});

// ---------------------------------------------------------------------------
// Settings: off by default, strict when present.

test("the label is off by default: absent or disabled settings are null", () => {
  const project = findProject("asi");
  if (!project) throw new Error("fixture project missing");
  expect(project.slopbot?.readyLabel).toBeUndefined();
  expect(readyLabelSettings(project)).toBeNull();
  expect(
    readyLabelSettings({
      slopbot: { readyLabel: { ...SETTINGS, enabled: false } },
    }),
  ).toBeNull();
  expect(readyLabelSettings({ slopbot: { readyLabel: SETTINGS } })).toBe(
    SETTINGS,
  );
});

test("the manifest accepts valid settings and refuses out-of-bound ones", () => {
  const project = findProject("asi");
  if (!project) throw new Error("fixture project missing");
  const withReady = (readyLabel: unknown) => ({
    ...project,
    slopbot: { automaticClosure: false, readyLabel },
  });
  expect(() =>
    assertProjectDefinition(
      withReady({ ...SETTINGS, protectedPaths: ["docs/legal/", "*.sql"] }),
    ),
  ).not.toThrow();
  for (const bad of [
    { ...SETTINGS, approvals: 0 },
    { ...SETTINGS, approvals: 11 },
    { ...SETTINGS, maxChangedLines: 5001 },
    { ...SETTINGS, maxChangedFiles: 1.5 },
    { ...SETTINGS, protectedPaths: ["/abs"] },
    { ...SETTINGS, protectedPaths: ["../up"] },
    { ...SETTINGS, protectedPaths: ["a", "a"] },
    { ...SETTINGS, extra: true },
    { enabled: true },
  ])
    expect(() => assertProjectDefinition(withReady(bad))).toThrow();
  expect(() => assertReadyLabelSettings(SETTINGS, "x")).not.toThrow();
});

// ---------------------------------------------------------------------------
// Against a local GitHub: label writes, removal on push, permission reads.

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const HEAD = "b".repeat(40);
const NEW_HEAD = "d".repeat(40);
const COMMENT = [
  "<!-- slopbot:review -->",
  "**Slopbot review complete — no finding**",
  "",
  "Summary.",
  "",
  "<details><summary>Review details</summary>",
  "",
  "</details>",
].join("\n");

type World = {
  head: string;
  labels: string[];
  mergeableState: string;
  files: ChangedFile[];
  reviews: {
    user: { id: number; login: string; type: string };
    state: string;
    commit_id: string;
  }[];
  permissions: Record<string, string>;
  comment: string;
  /** The head GitHub reports from the second pull read onward. */
  headAfterFirstRead?: string;
};

function world(overrides: Partial<World> = {}): World {
  return {
    head: HEAD,
    labels: [],
    mergeableState: "clean",
    files: [FILE],
    reviews: [
      {
        user: { id: 7, login: "maint", type: "User" },
        state: "APPROVED",
        commit_id: HEAD,
      },
    ],
    permissions: { maint: "write" },
    comment: COMMENT,
    ...overrides,
  };
}

async function withGitHub(
  readyLabel: ReadyLabelSettings | undefined,
  state: World,
  run: (input: {
    db: D1Database;
    sqlite: Database;
    job: ReadyJob;
    requests: string[];
  }) => Promise<void>,
  seedReview: { verdict: unknown; action: string } | null = {
    verdict: {
      category: "none",
      confidence: 0.9,
      limitations: [],
    },
    action: "comment",
  },
) {
  const { db, sqlite } = sqliteD1(MIGRATIONS);
  const fixture = findProject("asi");
  if (!fixture) throw new Error("fixture project missing");
  const project = {
    ...fixture,
    status: "active",
    ...(readyLabel ? { slopbot: { automaticClosure: false, readyLabel } } : {}),
  };
  assertProjectDefinition(project);
  const manifest = JSON.stringify(project);
  const digest = createHash("sha256").update(manifest).digest("hex");
  const at = "2026-11-16T00:00:00.000Z";
  sqlite.run(
    "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,1,?,?,?,?)",
    [project.id, manifest, digest, "local ready-label fixture", at],
  );
  sqlite.run(
    "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES (?,'active',1,?,?,?,?)",
    [project.id, manifest, digest, at, at],
  );
  const [owner, repo] = new URL(project.repositories[0].githubUrl).pathname
    .slice(1)
    .split("/");
  sqlite.run(
    "INSERT INTO project_repositories(repository_key,project_id) VALUES (?,?)",
    [`${owner}/${repo}`.toLowerCase(), project.id],
  );
  sqlite.run(
    "INSERT INTO slopbot_installations(installation_id, account_id, account_login, account_type, created_at) VALUES (1,77,?,'Organization',?)",
    [owner, at],
  );
  const repositoryId = Number(project.authority.repositoryId);
  if (seedReview)
    sqlite.run(
      `INSERT INTO slopbot_reviews(review_key, installation_id, repository_id, item_kind, item_number, item_node_id, author_id, revision, content_digest, policy_digest, status, verdict, action, created_at, completed_at)
       VALUES ('rk', 1, ?, 'pull_request', 5, 'PR_ready', 42, ?, 'c', 'p', 'completed', ?, ?, ?, ?)`,
      [
        repositoryId,
        HEAD,
        JSON.stringify(seedReview.verdict),
        seedReview.action,
        at,
        at,
      ],
    );
  sqlite.run(
    "INSERT INTO slopbot_item_comments(item_node_id, repository_id, comment_id) VALUES ('PR_ready', ?, 900)",
    [repositoryId],
  );
  const requests: string[] = [];
  let pullReads = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const path = url.pathname;
      if (path.endsWith("/access_tokens"))
        return Response.json({ token: "local-ready-token" });
      requests.push(`${request.method} ${path}`);
      if (path.endsWith("/pulls/5") && request.method === "GET") {
        pullReads++;
        const head =
          pullReads > 1 && state.headAfterFirstRead
            ? state.headAfterFirstRead
            : state.head;
        return Response.json({
          node_id: "PR_ready",
          number: 5,
          state: "open",
          draft: false,
          merged: false,
          mergeable: state.mergeableState !== "dirty",
          mergeable_state: state.mergeableState,
          head: { sha: head },
          user: { id: 42, type: "User" },
          labels: state.labels.map((name) => ({ name })),
          additions: state.files.reduce((n, f) => n + f.additions, 0),
          deletions: state.files.reduce((n, f) => n + f.deletions, 0),
          changed_files: state.files.length,
        });
      }
      if (path.endsWith("/pulls/5/files")) return Response.json(state.files);
      if (path.endsWith("/pulls/5/reviews"))
        return Response.json(state.reviews);
      const permission = /\/collaborators\/([^/]+)\/permission$/u.exec(path);
      if (permission) {
        const login = decodeURIComponent(permission[1]);
        const id = state.reviews.find((r) => r.user.login === login)?.user.id;
        return Response.json({
          permission: state.permissions[login] ?? "read",
          user: { id },
        });
      }
      if (path.endsWith("/issues/comments/900")) {
        if (request.method === "PATCH") {
          state.comment = ((await request.json()) as { body: string }).body;
          return Response.json({ id: 900 });
        }
        return Response.json({
          id: 900,
          body: state.comment,
          user: { id: 999 },
        });
      }
      if (path.endsWith("/issues/5/labels") && request.method === "POST") {
        const { labels } = (await request.json()) as { labels: string[] };
        state.labels.push(...labels);
        return Response.json(state.labels.map((name) => ({ name })));
      }
      if (
        path.endsWith(`/issues/5/labels/${encodeURIComponent(READY_LABEL)}`) &&
        request.method === "DELETE"
      ) {
        state.labels = state.labels.filter((label) => label !== READY_LABEL);
        return Response.json([]);
      }
      return new Response(null, { status: 404 });
    },
  });
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = ((
    url: Parameters<typeof fetch>[0],
    init: Parameters<typeof fetch>[1],
  ) => {
    const u = new URL(url instanceof Request ? url.url : String(url));
    if (u.origin === server.url.origin) return nativeFetch(url, init);
    if (u.hostname !== "api.github.com")
      throw new Error(`unexpected network request to ${u.hostname}`);
    return nativeFetch(new URL(u.pathname + u.search, server.url), init);
  }) as typeof fetch;
  const job = readyJob({
    deliveryId: "ready-test",
    installationId: 1,
    repositoryId,
    owner,
    repo,
    number: 5,
  });
  try {
    await run({ db: db as unknown as D1Database, sqlite, job, requests });
  } finally {
    globalThis.fetch = nativeFetch;
    server.stop(true);
    sqlite.close();
  }
}

function env(db: D1Database) {
  return {
    SLOPBOT_DB: db,
    SLOPBOT_APP_ID: "1",
    SLOPBOT_APP_PRIVATE_KEY: privateKey,
    SLOPBOT_APP_USER_ID: "999",
  };
}

function row(sqlite: Database) {
  return sqlite
    .query(
      "SELECT state, head_sha, reason, next_check_at FROM slopbot_ready_labels WHERE pull_number = 5",
    )
    .get() as {
    state: string;
    head_sha: string;
    reason: string;
    next_check_at: string | null;
  } | null;
}

const writes = (requests: string[]) =>
  requests.filter((r) => !r.startsWith("GET "));

test("a ready pull request gets the label and one comment line; Slopbot never merges", async () => {
  const state = world();
  await withGitHub(SETTINGS, state, async ({ db, sqlite, job, requests }) => {
    expect(await refreshReadyLabel(env(db), job)).toBe("ready label added");
    expect(state.labels).toEqual([READY_LABEL]);
    const lines = state.comment
      .split("\n")
      .filter((line) => line.startsWith(READY_LINE_MARKER));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Checked:");
    expect(lines[0]).toContain("Not checked:");
    expect(lines[0]).toContain("Slopbot never merges");
    expect(row(sqlite)?.state).toBe("ready");
    // Only the label and the comment are written: no merge, review or close.
    for (const write of writes(requests))
      expect(write.endsWith("/labels") || write.endsWith("/comments/900")).toBe(
        true,
      );
    expect(requests.some((r) => r.includes("/merge"))).toBe(false);
  });
});

test("approvals from accounts without write access are ignored", async () => {
  const state = world({ permissions: { maint: "read" } });
  await withGitHub(SETTINGS, state, async ({ db, sqlite, job }) => {
    expect(await refreshReadyLabel(env(db), job)).toContain("not ready");
    expect(state.labels).toEqual([]);
    expect(row(sqlite)?.reason).toBe(
      "0 of 1 required approvals at this commit from accounts with write access",
    );
  });
});

test("the author's own approval, a bot and an approval of an older commit do not count", async () => {
  const state = world({
    reviews: [
      {
        user: { id: 42, login: "author", type: "User" },
        state: "APPROVED",
        commit_id: HEAD,
      },
      {
        user: { id: 8, login: "helper[bot]", type: "Bot" },
        state: "APPROVED",
        commit_id: HEAD,
      },
      {
        user: { id: 7, login: "maint", type: "User" },
        state: "APPROVED",
        commit_id: "e".repeat(40),
      },
    ],
    permissions: { author: "admin", "helper[bot]": "write", maint: "write" },
  });
  await withGitHub(SETTINGS, state, async ({ db, job }) => {
    expect(await refreshReadyLabel(env(db), job)).toContain("0 of 1");
    expect(state.labels).toEqual([]);
  });
});

test("a new push removes the label and replaces the comment line", async () => {
  const state = world({ head: NEW_HEAD, labels: [READY_LABEL] });
  state.comment = withReadyLine(
    COMMENT,
    `${READY_LINE_MARKER} **Labelled \`slopbot:ready\`** at \`bbbbbbb\`.`,
  );
  await withGitHub(SETTINGS, state, async ({ db, sqlite, job }) => {
    // The review of the new head has not finished, so there is no verdict.
    const outcome = await refreshReadyLabel(env(db), job);
    expect(outcome).toBe(
      "ready label removed: Slopbot has not reviewed this commit",
    );
    expect(state.labels).toEqual([]);
    expect(state.comment).toContain(
      "**Not labelled `slopbot:ready`** at `ddddddd`",
    );
    expect(state.comment).not.toContain("**Labelled");
    expect(row(sqlite)).toMatchObject({
      state: "not-ready",
      head_sha: NEW_HEAD,
    });
  });
});

test("a push between the reads and the write adds nothing", async () => {
  const state = world({ headAfterFirstRead: NEW_HEAD });
  await withGitHub(SETTINGS, state, async ({ db, sqlite, job }) => {
    expect(await refreshReadyLabel(env(db), job)).toBe(
      "head moved during the ready check",
    );
    expect(state.labels).toEqual([]);
    expect(row(sqlite)?.head_sha).toBe(NEW_HEAD);
  });
});

test("a protected path is refused even with approvals and green checks", async () => {
  const state = world({
    files: [{ ...FILE, filename: ".github/workflows/release.yml" }],
  });
  await withGitHub(SETTINGS, state, async ({ db, job }) => {
    expect(await refreshReadyLabel(env(db), job)).toBe(
      "not ready: it touches CI or GitHub settings (.github/workflows/release.yml)",
    );
    expect(state.labels).toEqual([]);
  });
  const owner = world({ files: [{ ...FILE, filename: "db/schema.sql" }] });
  await withGitHub(
    { ...SETTINGS, protectedPaths: ["*.sql"] },
    owner,
    async ({ db, job }) => {
      expect(await refreshReadyLabel(env(db), job)).toContain(
        "a path this project protects",
      );
      expect(owner.labels).toEqual([]);
    },
  );
});

test("a finding on the head commit is not ready", async () => {
  const state = world();
  await withGitHub(
    SETTINGS,
    state,
    async ({ db, job }) => {
      expect(await refreshReadyLabel(env(db), job)).toBe(
        "not ready: Slopbot's review of this commit has a finding",
      );
      expect(state.labels).toEqual([]);
    },
    {
      verdict: { category: "spam", confidence: 0.95, limitations: [] },
      action: "label",
    },
  );
});

test("pending checks are checked again later; a labelled pull request loses the label when a check fails", async () => {
  const pending = world({ mergeableState: "unstable" });
  const now = new Date("2026-11-16T12:00:00.000Z");
  await withGitHub(SETTINGS, pending, async ({ db, sqlite, job }) => {
    await refreshReadyLabel(env(db), job, now);
    expect(row(sqlite)?.next_check_at).toBe(
      new Date(now.getTime() + PENDING_RECHECK_MS).toISOString(),
    );
    const sent: Job[] = [];
    const later = new Date(now.getTime() + PENDING_RECHECK_MS);
    expect(
      await dispatchReadyChecks(
        db as unknown as D1Database<D1QueryStatement>,
        { send: async (body) => void sent.push(body) },
        later,
      ),
    ).toBe(1);
    expect(sent).toEqual([
      {
        ...job,
        deliveryId: `ready:${job.repositoryId}:5:${later.toISOString()}`,
      },
    ]);
    // The claim moves the time forward, so an overlapping run sends nothing.
    expect(
      await dispatchReadyChecks(
        db as unknown as D1Database<D1QueryStatement>,
        { send: async (body) => void sent.push(body) },
        later,
      ),
    ).toBe(0);
  });
  const failed = world({ labels: [READY_LABEL], mergeableState: "unstable" });
  await withGitHub(SETTINGS, failed, async ({ db, job }) => {
    expect(await refreshReadyLabel(env(db), job)).toContain(
      "ready label removed",
    );
    expect(failed.labels).toEqual([]);
  });
});

test("off by default: a project without the setting makes no GitHub request", async () => {
  const state = world();
  await withGitHub(undefined, state, async ({ db, sqlite, job, requests }) => {
    expect(await readyLabelWanted(db, job)).toBe(false);
    expect(await refreshReadyLabel(env(db), job)).toBe(
      "ready label is off for this project",
    );
    expect(requests).toEqual([]);
    expect(state.labels).toEqual([]);
    expect(row(sqlite)).toBeNull();
  });
});

test("turning the setting off removes a label Slopbot added", async () => {
  const state = world({ labels: [READY_LABEL] });
  await withGitHub(undefined, state, async ({ db, sqlite, job }) => {
    sqlite.run(
      "INSERT INTO slopbot_ready_labels(repository_id, pull_number, installation_id, owner, repo, head_sha, state, reason, first_seen_at, updated_at) VALUES (?, 5, 1, ?, ?, ?, 'ready', 'all conditions hold', ?, ?)",
      [
        job.repositoryId,
        job.owner,
        job.repo,
        HEAD,
        "2026-11-16T00:00:00.000Z",
        "2026-11-16T00:00:00.000Z",
      ],
    );
    expect(await readyLabelWanted(db, job)).toBe(true);
    expect(await refreshReadyLabel(env(db), job)).toBe(
      "ready label removed: setting off",
    );
    expect(state.labels).toEqual([]);
    expect(row(sqlite)?.state).toBe("off");
  });
});
