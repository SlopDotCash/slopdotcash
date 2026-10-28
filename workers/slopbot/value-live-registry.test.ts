/** PRD sections 4, 5 and 7: registration must not wait for a site release.
 * Exercise durable intake and the real consumer with local D1 and GitHub HTTP
 * responses. These cases stop before inference; no model verdict is simulated.
 */
import { expect, setSystemTime, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { readdirSync } from "node:fs";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { findRegisteredRepositoryById } from "../../src/lib/repositories.mjs";
import { REWARD_ASSET_NETWORKS } from "../../src/lib/reward-asset.mjs";
import { applicationManifest } from "../../tests/project-application-manifest";
import { sqliteD1 } from "../../tests/sqlite-d1";
import worker from "./index";
import { recordDelivery } from "./persistence";
import { consumeValueRequest, type ValueConsumerEnv } from "./value-consumer";
import { recordValueRequest } from "./value-requests";

const repository = "fresh-registration/toolkit";
const job = {
  deliveryId: "new-registration-delivery",
  installationId: 1,
  repositoryId: 123456789,
  owner: "fresh-registration",
  repo: "toolkit",
  number: 1,
};
const at = "2026-10-24T00:00:00.000Z";
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

/** One active project registered only in D1, with its App installation. */
function liveRegistration() {
  const { db, sqlite } = sqliteD1(
    readdirSync(new URL("../../migrations/", import.meta.url))
      .filter((path) => path.endsWith(".sql"))
      .sort(),
  );
  const project = assertProjectDefinition(
    applicationManifest("fresh-registration", repository, {
      status: "active",
      rewardAsset: {
        network: "ethereum",
        kind: "stablecoin",
        ...REWARD_ASSET_NETWORKS.ethereum.stablecoin,
        chainId: REWARD_ASSET_NETWORKS.ethereum.chainId,
        cluster: null,
        verifiedAt: at,
      },
    }),
  );
  const manifest = JSON.stringify(project);
  const digest = createHash("sha256").update(manifest).digest("hex");
  sqlite.run(
    "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,1,?,?,?,?)",
    [project.id, manifest, digest, "registration workflow", at],
  );
  sqlite.run(
    "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES (?,'active',1,?,?,?,?)",
    [project.id, manifest, digest, at, at],
  );
  sqlite.run(
    "INSERT INTO project_repositories(repository_key,project_id) VALUES (?,?)",
    [repository, project.id],
  );
  sqlite.run(
    "INSERT INTO slopbot_installations(installation_id,account_id,account_login,account_type,created_at) VALUES (1,77,'fresh-registration','Organization',?)",
    [at],
  );
  return { db, sqlite, project, digest };
}

for (const change of [
  "none",
  "removed",
  "paused",
  "restricted",
  "identity",
  "deselected",
  "september",
  "october",
  "early-api-override",
  "notice-failed",
] as const) {
  test(`live registration reaches the consumer; ${change} authority`, async () => {
    const { db, sqlite, project, digest } = liveRegistration();
    expect(findRegisteredRepositoryById(repository)).toBeNull();
    await recordDelivery(db, job.deliveryId, "pull_request");
    await recordValueRequest(db, job);
    if (change === "removed")
      sqlite.run("DELETE FROM project_repositories WHERE project_id=?", [
        project.id,
      ]);
    if (change === "paused") {
      const paused = JSON.stringify({ ...project, status: "paused" });
      const pausedDigest = createHash("sha256").update(paused).digest("hex");
      sqlite.run(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,2,?,?,?,?)",
        [project.id, paused, pausedDigest, "pause after intake", at],
      );
      sqlite.run(
        "UPDATE projects SET status='paused',revision=2,manifest=?,manifest_sha256=?,updated_at=? WHERE id=?",
        [paused, pausedDigest, at, project.id],
      );
    }
    if (change === "restricted")
      sqlite.run(
        `INSERT INTO project_enforcements
      (id,project_id,sequence,action,state_after,appeal_after,reason,evidence_reference,repository_github_id,repository_keys,actor_github_id,actor_github_login,actor_role,decision_source,before_revision,before_manifest_sha256,result,created_at)
      VALUES ('enf_registry_test',?,1,'quarantine','quarantined','none','Review pending','local-workflow',?,?,'77','moderator','project-moderator','admin-panel',1,?,'revision_pending',?)`,
        [
          project.id,
          project.authority.repositoryId,
          JSON.stringify([repository]),
          digest,
          at,
        ],
      );
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      calls.push(url.pathname);
      if (url.origin !== "https://api.github.com")
        throw new Error("No provider call is authorized in this test");
      if (url.pathname === "/app/installations/1/access_tokens")
        return Response.json({ token: "local-installation" });
      const identity = {
        id: change === "identity" ? 987 : job.repositoryId,
        node_id: "R_example",
        private: false,
      };
      if (url.pathname === `/repos/${repository}`)
        return Response.json(identity);
      if (url.pathname === "/installation/repositories")
        return Response.json({
          repositories: change === "deselected" ? [] : [identity],
        });
      if (url.pathname === `/repos/${repository}/pulls/1`)
        return Response.json({
          state:
            change === "september" || change === "october" ? "closed" : "open",
          merged_at:
            change === "september"
              ? "2026-09-30T23:59:59Z"
              : change === "october"
                ? "2026-10-31T23:59:59Z"
                : null,
          closed_at: null,
        });
      throw new Error("Unexpected GitHub request");
    }) as typeof fetch;
    try {
      const env: ValueConsumerEnv = {
        SLOPBOT_DB: db,
        SLOPBOT_APP_ID: "1",
        SLOPBOT_APP_PRIVATE_KEY: privateKey,
        SLOPBOT_APP_USER_ID: "2",
        SURPLUS_API_KEY: "not-used-before-inference",
        SLOPBOT_PRODUCER_REVISION: "a".repeat(40),
        SLOPBOT_VALUE_MONTHLY_BUDGET_MICRO_USD: "alerts-only",
        ...(change === "early-api-override"
          ? { SLOPBOT_VALUE_START_AT: at }
          : {}),
      };
      let outcome: string;
      if (change === "notice-failed") {
        sqlite.run(
          `INSERT INTO slopbot_costs(review_key,installation_id,call_kind,route_step,provider,requested_model,outcome,input_tokens,cache_write_tokens,cache_read_tokens,output_tokens,price_version,cost_micro_usd,billed_micro_usdc,reconciliation,created_at) VALUES ('notice',1,'triage',1,'surplus','claude-opus-5.5','failed',0,0,0,0,'local',0,0,'estimated','2026-11-01T00:00:00.000Z')`,
        );
        const scheduledEnv = {
          ...env,
          SLOPBOT_DB: db,
          SLOPBOT_WEBHOOK_SECRET: "unused",
          SLOPBOT_QUEUE: { send: async () => {} },
          SLOP_NOTIFY: {
            fetch: async () => {
              throw new Error("mail unavailable");
            },
          },
        };
        await expect(worker.scheduled({}, scheduledEnv)).rejects.toThrow(
          "needs attention",
        );
        expect(
          sqlite
            .query("SELECT outcome FROM slopbot_provider_failure_receipts")
            .get(),
        ).toEqual({ outcome: "ambiguous" });
        await worker.scheduled({}, scheduledEnv);
        outcome = "open";
      } else outcome = await consumeValueRequest(env, job);
      expect(outcome).toBe(
        change === "none" || change === "notice-failed"
          ? "open"
          : change === "september" || change === "october"
            ? "historical"
            : change === "early-api-override"
              ? "budget"
              : change === "deselected"
                ? "retry"
                : change === "identity"
                  ? "authority"
                  : // A paused, restricted or removed project parks it.
                    "parked",
      );
      expect(
        sqlite
          .query("SELECT state,outcome FROM slopbot_value_processing")
          .get(),
      ).toEqual({
        state: ["open", "historical"].includes(outcome)
          ? "completed"
          : "waiting",
        outcome,
      });
      if (
        change === "removed" ||
        change === "paused" ||
        change === "restricted"
      )
        expect(calls).toEqual([]);
      if (change === "none")
        expect(calls).toContain(`/repos/${repository}/pulls/1`);
      expect(
        sqlite
          .query("SELECT count(*) AS count FROM slopbot_value_journal")
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      globalThis.fetch = original;
      sqlite.close();
    }
  });
}

/** Production on 27 October 2026 had 3,707 requests: 16 pre-November closed-PR
 * requests waited as `authority` and were retried hourly, oldest first, and
 * 3,689 later requests had never been read. Replay that shape from the first
 * November schedule: 30 deliveries for 12 PRs merged in October, 15 November
 * PRs whose source stays unavailable, and then a new November request. Just
 * before it, the same PR has a delivery under an App installation that was
 * removed (an uninstall and reinstall), and one under its old repository name.
 * Neither failed delivery may hold back the valid one.
 */
test("old and failing requests cannot starve new valuation requests", async () => {
  const { db, sqlite } = liveRegistration();
  sqlite.run(
    "INSERT INTO slopbot_installations(installation_id,account_id,account_login,account_type,created_at,removed_at) VALUES (3,77,'fresh-registration','Organization',?,?)",
    [at, "2026-11-01T03:00:00.000Z"],
  );
  const env = {
    SLOPBOT_DB: db,
    SLOPBOT_APP_ID: "1",
    SLOPBOT_APP_PRIVATE_KEY: privateKey,
    SLOPBOT_APP_USER_ID: "2",
    SURPLUS_API_KEY: "not-used-before-inference",
    SLOPBOT_PRODUCER_REVISION: "a".repeat(40),
    SLOPBOT_VALUE_MONTHLY_BUDGET_MICRO_USD: "alerts-only",
    SLOPBOT_WEBHOOK_SECRET: "unused",
    SLOPBOT_QUEUE: { send: async () => {} },
  };
  const deliveries = [
    ...Array.from({ length: 30 }, (_, i) => ({
      at: Date.parse("2026-10-24T05:25:00Z") + i * 10_000,
      number: 101 + (i % 12),
    })),
    ...Array.from({ length: 15 }, (_, i) => ({
      at: Date.parse("2026-11-01T00:10:00Z") + i * 60_000,
      number: 201 + i,
    })),
    { at: Date.parse("2026-11-01T03:01:00Z"), number: 300, installationId: 3 },
    {
      at: Date.parse("2026-11-01T03:01:30Z"),
      number: 300,
      previousName: true,
    },
    { at: Date.parse("2026-11-01T03:02:00Z"), number: 300 },
  ].map((delivery, i) => ({
    installationId: job.installationId,
    previousName: false,
    ...delivery,
    deliveryId: `delivery-${i}`,
  }));
  const reads = new Map<number, number[]>();
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== "https://api.github.com")
      throw new Error("No provider call is authorized in this test");
    const identity = {
      id: job.repositoryId,
      node_id: "R_example",
      private: false,
    };
    if (url.pathname === "/app/installations/1/access_tokens")
      return Response.json({ token: "local-installation" });
    if (url.pathname === `/repos/${repository}`) return Response.json(identity);
    if (url.pathname === "/installation/repositories")
      return Response.json({ repositories: [identity] });
    const number = Number(url.pathname.split(`/repos/${repository}/pulls/`)[1]);
    reads.set(number, [...(reads.get(number) ?? []), Date.now()]);
    if (number <= 112)
      return Response.json({
        state: "closed",
        merged_at: "2026-10-20T12:00:00Z",
        closed_at: "2026-10-20T12:00:00Z",
      });
    if (number === 300)
      return Response.json({ state: "open", merged_at: null, closed_at: null });
    // A November PR that GitHub reports as absent from a readable repository.
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  try {
    let pending = 0;
    for (
      let tick = Date.parse("2026-11-01T00:00:00Z");
      tick <= Date.parse("2026-11-01T06:00:00Z");
      tick += 5 * 60_000
    ) {
      for (
        ;
        pending < deliveries.length && deliveries[pending].at <= tick;
        pending++
      ) {
        const { at: received, ...delivery } = deliveries[pending];
        setSystemTime(new Date(received));
        await recordDelivery(db, delivery.deliveryId, "issue_comment");
        // The request was admitted before the repository was renamed.
        if (delivery.previousName)
          sqlite.run(
            `INSERT INTO slopbot_value_requests
             (delivery_id,installation_id,repository_id,owner,repo,pull_request_number,received_at)
             VALUES (?,?,?,?,'previous-name',?,?)`,
            [
              delivery.deliveryId,
              job.installationId,
              job.repositoryId,
              job.owner,
              delivery.number,
              new Date(received).toISOString(),
            ],
          );
        else await recordValueRequest(db, { ...job, ...delivery });
      }
      setSystemTime(new Date(tick));
      await worker.scheduled({}, env);
    }
    const state = (number: number) =>
      sqlite
        .query(
          `SELECT p.state,p.outcome,count(*) AS deliveries
           FROM slopbot_value_requests r
           LEFT JOIN slopbot_value_processing p ON p.delivery_id=r.delivery_id
           WHERE r.pull_request_number=? GROUP BY p.state,p.outcome`,
        )
        .all(number);
    // The new request is read by the first schedule after it arrives. The
    // removed-installation and old-name deliveries retry on their own.
    expect(reads.get(300)).toEqual([Date.parse("2026-11-01T03:05:00Z")]);
    expect(state(300)).toEqual([
      { state: "completed", outcome: "open", deliveries: 1 },
      { state: "waiting", outcome: "parked", deliveries: 1 },
      { state: "waiting", outcome: "retry", deliveries: 1 },
    ]);
    // One read settles every waiting delivery for a PR closed before the start.
    for (let number = 101; number <= 112; number++) {
      expect(reads.get(number)?.length).toBe(1);
      expect(state(number)).toEqual([
        {
          state: "completed",
          outcome: "historical",
          deliveries: number <= 106 ? 3 : 2,
        },
      ]);
    }
    // A November PR that GitHub reports absent ends as a recorded `missing`
    // outcome after one read, never a zero and never an hourly retry.
    for (let number = 201; number <= 215; number++) {
      expect(reads.get(number)?.length).toBe(1);
      expect(state(number)).toEqual([
        { state: "completed", outcome: "missing", deliveries: 1 },
      ]);
    }
  } finally {
    globalThis.fetch = original;
    setSystemTime();
    sqlite.close();
  }
});

/** A retry-dispatch outage must not prevent an independent appeal deadline. */
test("scheduler preserves appeal progress when retry dispatch is unavailable", async () => {
  const { db, sqlite } = liveRegistration();
  const appeal = {
    kind: "appeal_due" as const,
    appealKey: "appeal-independent-dispatch",
    deliveryId: "appeal-independent-dispatch",
    installationId: job.installationId,
    repositoryId: job.repositoryId,
    owner: job.owner,
    repo: job.repo,
    itemKind: "pull_request" as const,
    number: job.number,
  };
  sqlite.run(
    `INSERT INTO slopbot_appeals
      (appeal_key,repository_id,item_node_id,appellant_github_id,job_json,opened_at,due_at)
      VALUES (?,?,?,?,?,?,?)`,
    [
      appeal.appealKey,
      appeal.repositoryId,
      "PR_independent_dispatch",
      "3",
      JSON.stringify(appeal),
      "2000-01-01T00:00:00.000Z",
      "2000-01-08T00:00:00.000Z",
    ],
  );
  // Exercise a real database failure in one dispatcher, not a model result.
  sqlite.run("DROP TABLE slopbot_budget_dispatches");
  const queued: unknown[] = [];
  const env = {
    SLOPBOT_DB: db,
    SLOPBOT_WEBHOOK_SECRET: "unused",
    SLOPBOT_APP_ID: "unused",
    SLOPBOT_APP_PRIVATE_KEY: "unused",
    SLOPBOT_APP_USER_ID: "unused",
    SLOPBOT_QUEUE: {
      async send(value: unknown) {
        queued.push(value);
      },
    },
  };
  try {
    await expect(worker.scheduled({}, env)).rejects.toThrow("needs attention");
    expect(queued).toEqual([appeal]);
    expect(
      sqlite
        .query("SELECT queued_at IS NOT NULL AS queued FROM slopbot_appeals")
        .get(),
    ).toEqual({ queued: 1 });
    // The durable checkpoint still prevents immediate duplicate dispatch.
    await expect(worker.scheduled({}, env)).rejects.toThrow("needs attention");
    expect(queued).toEqual([appeal]);
  } finally {
    sqlite.close();
  }
});

/** README "Work accepted through another integration": the single-PR evaluator
 * refuses a closed PR accepted through an integration commit, so the consumer
 * must use the joint route even when no other PR references it. Synthetic Git
 * objects only; the spent allowance stops the route before any provider call.
 */
test("a lone indirectly accepted PR reaches joint assessment", async () => {
  setSystemTime(new Date("2026-11-04T00:00:00.000Z"));
  const { db, sqlite } = liveRegistration();
  const [base, head, integration] = ["a", "b", "d"].map((c) => c.repeat(40));
  const root = `/repos/${repository}`;
  const sha1 = (...parts: (string | Uint8Array)[]) => {
    const hash = createHash("sha1");
    for (const part of parts) hash.update(part);
    return hash.digest("hex");
  };
  const text = "export const fixed = true;\n";
  const blob = sha1(`blob ${text.length}\0`, text);
  const entry = Buffer.concat([
    Buffer.from("100644 fix.ts\0"),
    Buffer.from(blob, "hex"),
  ]);
  const tree = sha1(`tree ${entry.length}\0`, entry);
  const contributor = { node_id: "U_contributor", login: "dev", type: "User" };
  const file = {
    filename: "fix.ts",
    status: "added",
    additions: 1,
    deletions: 0,
    patch: "@@ -0,0 +1 @@\n+export const fixed = true;",
    blob_url: `https://github.com/${repository}/blob/${head}/fix.ts`,
  };
  const commit = (sha: string, parents: string[]) => ({
    sha,
    html_url: `https://github.com/${repository}/commit/${sha}`,
    parents: parents.map((parent) => ({ sha: parent })),
    stats: { additions: 1, deletions: 0, total: 1 },
    files: [file],
  });
  const ancestors: Record<string, string[]> = {
    [base]: [],
    [head]: [base],
    [integration]: [base, head],
  };
  const policy = "Fix reproduced defects with a failing test.";
  const identity = {
    id: job.repositoryId,
    node_id: "R_example",
    private: false,
  };
  const runs = `${root}/actions/runs?head_sha=${integration}&event=push&branch=main&per_page=100&page=1`;
  const routes: Record<string, unknown> = {
    [root]: identity,
    [`${root}/pulls/1`]: {
      node_id: "PR_indirect",
      number: 1,
      html_url: `https://github.com/${repository}/pull/1`,
      title: "Fix the toolkit export",
      body: null,
      user: contributor,
      merged_by: null,
      state: "closed",
      merged_at: null,
      closed_at: "2026-11-03T12:00:00Z",
      merge_commit_sha: null,
      updated_at: "2026-11-03T12:00:00Z",
      head: { sha: head },
      base: { sha: base, ref: "main" },
      changed_files: 1,
      comments: 1,
      review_comments: 0,
      commits: 1,
    },
    [`${root}/pulls/1/files?per_page=100&page=1`]: [file],
    [`${root}/pulls/1/commits?per_page=100&page=1`]: [
      {
        ...commit(head, [base]),
        author: contributor,
        committer: contributor,
        commit: {
          message: "Fix the toolkit export",
          author: { date: "2026-11-02T10:00:00Z" },
          committer: { date: "2026-11-02T10:00:00Z" },
        },
      },
    ],
    [`${root}/pulls/1/reviews?per_page=100&page=1`]: [],
    [`${root}/pulls/1/comments?per_page=100&page=1`]: [],
    [`${root}/issues/1/comments?per_page=100&page=1`]: [
      {
        node_id: "IC_merged",
        html_url: `https://github.com/${repository}/pull/1#issuecomment-1`,
        body: `Merged into main as ${integration}. Thank you.`,
        user: { node_id: "U_maintainer", login: "owner", type: "User" },
        created_at: "2026-11-03T12:00:00Z",
        updated_at: "2026-11-03T12:00:00Z",
      },
    ],
    [`${root}/commits/${head}?per_page=100&page=1`]: commit(head, [base]),
    [`${root}/commits/${integration}?per_page=100&page=1`]: commit(
      integration,
      [base, head],
    ),
    [`${root}/branches/main`]: { name: "main", commit: { sha: integration } },
    [runs]: {
      total_count: 1,
      workflow_runs: [
        {
          id: 5001,
          html_url: `https://github.com/${repository}/actions/runs/5001`,
          event: "push",
          head_branch: "main",
          head_sha: integration,
          created_at: "2026-11-03T11:00:00Z",
          repository: { node_id: "R_example" },
        },
      ],
    },
    [`${root}/git/trees/${tree}?recursive=1`]: {
      sha: tree,
      truncated: false,
      tree: [{ path: "fix.ts", mode: "100644", type: "blob", sha: blob }],
    },
    [`${root}/contents/CONTRIBUTING.md?ref=${base}`]: {
      type: "file",
      encoding: "base64",
      content: Buffer.from(policy).toString("base64"),
      size: policy.length,
      sha: sha1(`blob ${policy.length}\0`, policy),
    },
  };
  for (const ref of [head, integration]) {
    routes[`${root}/git/commits/${ref}`] = { sha: ref, tree: { sha: tree } };
    routes[`${root}/contents/fix.ts?ref=${ref}`] = {
      type: "file",
      encoding: "base64",
      content: Buffer.from(text).toString("base64"),
      size: text.length,
      sha: blob,
    };
  }
  const requests: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== "https://api.github.com")
      throw new Error("No provider call is authorized in this test");
    const path = `${url.pathname}${url.search}`;
    requests.push(path);
    if (url.pathname === "/app/installations/1/access_tokens")
      return Response.json({ token: "local-installation" });
    if (url.pathname === "/installation/repositories")
      return Response.json({ repositories: [identity] });
    if (url.pathname === "/graphql")
      return Response.json({
        data: {
          repository: {
            pullRequest: {
              id: "PR_indirect",
              timelineItems: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      });
    const range = /\/compare\/([a-f0-9]{40})\.\.\.([a-f0-9]{40})$/u.exec(
      url.pathname,
    );
    if (range) {
      const [, from, to] = range;
      const status =
        from === to
          ? "identical"
          : ancestors[to].includes(from)
            ? "ahead"
            : "behind";
      return Response.json({
        status,
        merge_base_commit: { sha: status === "behind" ? to : from },
        files: [],
      });
    }
    if (path in routes) return Response.json(routes[path]);
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  // The capped allowance is spent, so admission refuses before a provider call.
  sqlite.run(
    `INSERT INTO slopbot_costs(review_key,installation_id,call_kind,route_step,provider,requested_model,outcome,input_tokens,cache_write_tokens,cache_read_tokens,output_tokens,price_version,cost_micro_usd,billed_micro_usdc,reconciliation,created_at) VALUES ('spent',1,'triage',1,'surplus','claude-opus-5.5','ok',0,0,0,0,'local',1000000,0,'reconciled',?)`,
    [new Date().toISOString()],
  );
  try {
    await recordDelivery(db, job.deliveryId, "pull_request");
    await recordValueRequest(db, job);
    const outcome = await consumeValueRequest(
      {
        SLOPBOT_DB: db,
        SLOPBOT_APP_ID: "1",
        SLOPBOT_APP_PRIVATE_KEY: privateKey,
        SLOPBOT_APP_USER_ID: "2",
        SURPLUS_API_KEY: "not-used-before-inference",
        SLOPBOT_PRODUCER_REVISION: "a".repeat(40),
        SLOPBOT_VALUE_MONTHLY_BUDGET_MICRO_USD: "1000000",
        SLOPBOT_VALUE_ATTEMPT_RESERVE_MICRO_USD: "1000000",
        SLOPBOT_VALUE_START_AT: "2026-11-01T00:00:00.000Z",
      },
      job,
    );
    // The integration is proved from GitHub, not from the comment text.
    expect(requests).toContain(runs);
    // Before the fix the single-PR evaluator threw: an hourly `retry` forever.
    expect(outcome).toBe("budget");
    expect(
      sqlite
        .query("SELECT state,outcome,attempts FROM slopbot_value_processing")
        .get(),
    ).toEqual({ state: "waiting", outcome: "budget", attempts: 1 });
  } finally {
    globalThis.fetch = original;
    setSystemTime();
    sqlite.close();
  }
});
