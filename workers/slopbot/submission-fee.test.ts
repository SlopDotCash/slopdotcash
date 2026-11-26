// The refundable submission fee (operator decision, 18 November 2026; PRD
// section 5). While a project's setting is on and the switch is live, an
// outside contributor's pull request gets one comment, one label and no
// review until a deposit is seen. Local HTTP fixtures exercise the control
// only; synthetic verdicts do not qualify any model, and no chain is read.

import { afterEach, expect, setSystemTime, test } from "bun:test";
import { createHash, createHmac, generateKeyPairSync } from "node:crypto";
import { findProject } from "../../src/lib/projects.mjs";
import {
  STANDING_DEPOSIT_COVERED_LABEL,
  standingDepositItem,
} from "../../src/lib/standing-deposit.mjs";
import {
  SUBMISSION_FEE_CONTRACTS,
  SUBMISSION_FEE_DEFAULT_MINOR,
  SUBMISSION_FEE_KEEP_LABEL,
  SUBMISSION_FEE_KEPT_TO,
  SUBMISSION_FEE_TOKENS,
  submissionDepositCounts,
  submissionFeeItem,
  submissionResolveAction,
} from "../../src/lib/submission-fee.mjs";
import { MIGRATIONS, sqliteD1 } from "../../tests/sqlite-d1";
import {
  D1FeeStore,
  type SubmissionFeeD1Database,
} from "../submission-fee/store";
import { openAppeal, resolveAppeal } from "./appeals";
import type { Job } from "./contracts";
import worker from "./index";
import { type D1Database, recordAction } from "./persistence";
import {
  READY_LABEL,
  type ReadyFacts,
  readyDecision,
  readyJob,
  refreshReadyLabel,
} from "./ready-label";
import { type ReviewEnv, reviewItem } from "./review";
import {
  FREE_REVIEWS_PER_REPO_PER_MONTH,
  monthlyReviewOpen,
  reviewMonth,
} from "./review-cap";
import {
  checkStandingDeposits,
  STANDING_DEPOSIT_BATCH,
} from "./standing-deposit";
import {
  dispatchFeeChecks,
  FEE_MARKER,
  FEE_NEEDED_LABEL,
  FEE_NEEDED_REASON,
  FEE_PAID_LABEL,
  feeCheckWanted,
  feeContracts,
  feeJob,
  feeMode,
  feeNeededComment,
  feeOutcome,
  feeSettingSince,
  feeUnpaid,
  feeWays,
  refreshSubmissionFee,
  reopenKeptFee,
  wantedAtOpen,
} from "./submission-fee";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const BASE_CONTRACT = "0x1111111111111111111111111111111111111111";
const ROBINHOOD_CONTRACT = "0x2222222222222222222222222222222222222222";
const DEPLOYED = {
  "base-mainnet": BASE_CONTRACT,
  "robinhood-mainnet": ROBINHOOD_CONTRACT,
};
const UNPUBLISHED = { "base-mainnet": null, "robinhood-mainnet": null };
const SETTING_ON_AT = "2026-11-01T00:00:00.000Z";
const OPENED_AFTER = "2026-11-10T00:00:00Z";
const APP_USER_ID = "999";
const DAY = 24 * 60 * 60_000;
const NOW_ISO = "2026-11-18T12:00:00.000Z";
const RATE = { effectiveAt: SETTING_ON_AT, slopPerUsd: "75.4717" };
/** Before the pull request opened, so its cover window starts at opening. */
const STANDING_PAID_AT = "2026-11-05T00:00:00.000Z";

afterEach(() => {
  feeContracts.current = SUBMISSION_FEE_CONTRACTS;
  setSystemTime();
});

type Comment = {
  id: number;
  body: string;
  user: { id: number; type: string };
};

type WorldOptions = {
  mode?: string;
  /** The project setting; null leaves `slopbot` out of the project. */
  fee?: {
    enabled: boolean;
    amountMinor?: string;
    standingDeposits?: false;
  } | null;
  contracts?: typeof DEPLOYED | typeof UNPUBLISHED;
  permission?: "read" | "write";
  author?: { id: number; type: string };
  draft?: boolean;
  openedAt?: string;
  readyLabel?: boolean;
  /** Whole SLOP per 1.00 of stablecoin; null publishes no rate. */
  rate?: string | null;
  slopbotCloses?: boolean;
};

/** One registered repository with pull request #5 and a local GitHub. */
function world(options: WorldOptions = {}) {
  feeContracts.current = options.contracts ?? DEPLOYED;
  const { db, sqlite } = sqliteD1(MIGRATIONS);
  const fixture = findProject("asi");
  if (!fixture) throw new Error("fixture project missing");
  const fee = options.fee === undefined ? { enabled: true } : options.fee;
  const manifestOf = (
    setting: WorldOptions["fee"],
    extra: Record<string, unknown> = {},
  ) =>
    JSON.stringify({
      ...fixture,
      status: "active",
      ...(setting || options.readyLabel
        ? {
            slopbot: {
              automaticClosure: false,
              ...(setting ? { submissionFee: setting } : {}),
              ...(options.readyLabel
                ? {
                    readyLabel: {
                      enabled: true,
                      approvals: 1,
                      maxChangedLines: 400,
                      maxChangedFiles: 20,
                      protectedPaths: [],
                    },
                  }
                : {}),
            },
          }
        : {}),
      ...extra,
    });
  let revision = 0;
  /** Publish the next immutable revision of the project. */
  const publish = (setting: WorldOptions["fee"], at: string) => {
    const manifest = manifestOf(setting);
    const digest = createHash("sha256").update(manifest).digest("hex");
    revision += 1;
    sqlite.run(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,?,?,?,?,?)",
      [fixture.id, revision, manifest, digest, "local fixture", at],
    );
    if (revision === 1)
      sqlite.run(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES (?,'active',1,?,?,?,?)",
        [fixture.id, manifest, digest, at, at],
      );
    else
      sqlite.run(
        "UPDATE projects SET revision = ?, manifest = ?, manifest_sha256 = ?, updated_at = ? WHERE id = ?",
        [revision, manifest, digest, at, fixture.id],
      );
  };
  publish(fee, SETTING_ON_AT);
  // The submission-fee Worker's rate table (its migration 0140).
  sqlite.run(
    `CREATE TABLE IF NOT EXISTS submission_fee_rates (
       effective_at TEXT PRIMARY KEY, slop_per_usd TEXT NOT NULL,
       source TEXT NOT NULL, created_at TEXT NOT NULL)`,
  );
  if (options.rate !== null)
    sqlite.run(
      "INSERT INTO submission_fee_rates (effective_at, slop_per_usd, source, created_at) VALUES (?, ?, 'local fixture', ?)",
      [SETTING_ON_AT, options.rate ?? "75.4717", SETTING_ON_AT],
    );
  const [owner, repo] = new URL(fixture.repositories[0].githubUrl).pathname
    .slice(1)
    .split("/");
  sqlite.run(
    "INSERT INTO project_repositories(repository_key,project_id) VALUES (?,?)",
    [`${owner}/${repo}`.toLowerCase(), fixture.id],
  );
  sqlite.run(
    "INSERT INTO slopbot_installations(installation_id, account_id, account_login, account_type, created_at) VALUES (1,77,?,'Organization',?)",
    [owner, SETTING_ON_AT],
  );
  const repositoryId = Number(fixture.authority.repositoryId);
  const slopbotCloses = options.slopbotCloses ?? true;

  // The local GitHub's mutable state.
  const github = {
    state: "open" as "open" | "closed",
    merged: false,
    closedAt: null as string | null,
    /**
     * Label events of the issue the pull request closes, or null when it
     * closes none. `graphqlDown` makes the linked-issue read fail.
     */
    wantedEvents: null as { type: string; at: string; label: string }[] | null,
    graphqlDown: false,
    repoLabels: [] as string[],
    draft: options.draft ?? false,
    head: "b".repeat(40),
    labels: [] as string[],
    /** Runs when Slopbot removes a label, before GitHub answers. */
    onLabelRemoved: null as (() => void) | null,
    comments: [] as Comment[],
    permission: options.permission ?? ("read" as "read" | "write"),
    /** How many of the next comment or label additions answer 502. */
    failures: { comment: 0, label: 0 },
    /** The search's merged pull request count; null answers 502. */
    mergedOnProject: 1 as number | null,
    /** Every search query Slopbot sent. */
    searches: [] as string[],
    /** While true, reading the pull request answers 502. */
    pullDown: false,
    /** Reads of the pull request. */
    pullReads: 0,
  };
  const writes: string[] = [];
  const prompts: string[] = [];
  const queued: Job[] = [];
  let nextCommentId = 900;
  const author = { login: "author", id: 42, type: "User", ...options.author };
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = decodeURIComponent(new URL(request.url).pathname);
      const method = request.method;
      if (method !== "GET") writes.push(`${method} ${path}`);
      if (path === "/v1/messages") {
        const body = (await request.json()) as {
          messages: { content: { text: string }[] }[];
        };
        prompts.push(body.messages[0].content[1].text);
        return Response.json({
          id: "local-submission-fee",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5.5",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                category: "none",
                confidence: 0.6,
                rule_refs: [],
                evidence: [],
                summary: "Synthetic submission-fee verdict.",
                limitations: [],
                objective_defect: null,
              }),
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      }
      if (path.endsWith("/access_tokens"))
        return Response.json({ token: "local-synthetic-token" });
      if (path === `/repos/${owner}/${repo}`)
        return Response.json({
          id: repositoryId,
          private: false,
          default_branch: "main",
          owner: { login: owner, id: 77, type: "Organization" },
        });
      if (path.endsWith("/issues/5") && method === "GET")
        return Response.json({
          node_id: "PR_local",
          number: 5,
          state: github.state,
          closed_at: github.closedAt,
          title: "small change",
          body: "Made via @slopdotcash",
          user: author,
          assignees: [],
          labels: github.labels.map((name) => ({ name })),
          pull_request: {},
        });
      if (path === "/search/issues" && method === "GET") {
        github.searches.push(new URL(request.url).searchParams.get("q") ?? "");
        return github.mergedOnProject === null
          ? new Response(null, { status: 502 })
          : Response.json({
              total_count: github.mergedOnProject,
              items: [],
            });
      }
      if (path.endsWith("/pulls/5") && method === "GET") {
        github.pullReads += 1;
        if (github.pullDown) return new Response(null, { status: 502 });
      }
      if (path.endsWith("/pulls/5") && method === "GET")
        return Response.json({
          node_id: "PR_local",
          number: 5,
          state: github.state,
          draft: github.draft,
          merged: github.merged,
          mergeable: true,
          mergeable_state: "clean",
          closed_at: github.closedAt,
          created_at: options.openedAt ?? OPENED_AFTER,
          user: author,
          labels: github.labels.map((name) => ({ name })),
          head: { sha: github.head },
          base: {
            sha: "a".repeat(40),
            ref: "development",
            repo: { id: repositoryId },
          },
          additions: 1,
          deletions: 0,
          changed_files: 1,
        });
      if (path.endsWith("/pulls/5/files"))
        return Response.json([
          {
            filename: "current-0.ts",
            status: "modified",
            additions: 1,
            deletions: 0,
            patch: "+actual current change",
          },
        ]);
      if (path.endsWith("/pulls/5/reviews"))
        return Response.json([
          {
            user: { id: 7, login: "maintainer", type: "User" },
            state: "APPROVED",
            commit_id: github.head,
          },
        ]);
      if (
        path.endsWith("/branches/main") ||
        path.endsWith("/branches/development")
      )
        return Response.json({ commit: { sha: "c".repeat(40) } });
      if (path.includes("/compare/"))
        return Response.json({
          base_commit: { sha: "c".repeat(40) },
          merge_base_commit: { sha: "c".repeat(40) },
          files: [
            {
              filename: "current-0.ts",
              status: "modified",
              patch: "+actual current change",
            },
          ],
        });
      if (path.endsWith("/collaborators/maintainer/permission"))
        return Response.json({ permission: "write", user: { id: 7 } });
      if (path.endsWith("/permission"))
        return Response.json({ permission: github.permission });
      if (path.endsWith("/issues/5/comments") && method === "GET")
        return Response.json(github.comments);
      if (path.endsWith("/issues/5/comments") && method === "POST") {
        if (github.failures.comment > 0) {
          github.failures.comment -= 1;
          return new Response(null, { status: 502 });
        }
        const comment = {
          id: nextCommentId++,
          body: ((await request.json()) as { body: string }).body,
          user: { id: Number(APP_USER_ID), type: "Bot" },
        };
        github.comments.push(comment);
        return Response.json(comment, { status: 201 });
      }
      const commentPath = /\/issues\/comments\/(\d+)$/u.exec(path);
      if (commentPath) {
        const comment = github.comments.find(
          (entry) => entry.id === Number(commentPath[1]),
        );
        if (!comment) return new Response(null, { status: 404 });
        if (method === "PATCH")
          comment.body = ((await request.json()) as { body: string }).body;
        return Response.json(comment);
      }
      if (path === "/graphql" && method === "POST") {
        if (github.graphqlDown) return new Response(null, { status: 502 });
        return Response.json({
          data: {
            repository: {
              pullRequest: {
                createdAt: options.openedAt ?? OPENED_AFTER,
                closingIssuesReferences: {
                  nodes:
                    github.wantedEvents === null
                      ? []
                      : [
                          {
                            repository: { databaseId: repositoryId },
                            timelineItems: {
                              nodes: github.wantedEvents.map((event) => ({
                                __typename: event.type,
                                createdAt: event.at,
                                label: { name: event.label },
                              })),
                            },
                          },
                        ],
                },
              },
            },
          },
        });
      }
      const repoLabel = new RegExp(
        `^/repos/${owner}/${repo}/labels(?:/(.+))?$`,
        "u",
      ).exec(path);
      if (repoLabel && method === "GET")
        return github.repoLabels.includes(
          decodeURIComponent(repoLabel[1] ?? ""),
        )
          ? Response.json({ name: repoLabel[1] })
          : new Response(null, { status: 404 });
      if (repoLabel && method === "POST") {
        const { name } = (await request.json()) as { name: string };
        github.repoLabels.push(name);
        return Response.json({ name }, { status: 201 });
      }
      if (path.endsWith("/issues/5/labels") && method === "POST") {
        if (github.failures.label > 0) {
          github.failures.label -= 1;
          return new Response(null, { status: 502 });
        }
        const { labels } = (await request.json()) as { labels: string[] };
        for (const label of labels)
          if (!github.labels.includes(label)) github.labels.push(label);
        return Response.json(github.labels.map((name) => ({ name })));
      }
      const labelPath = /\/issues\/5\/labels\/(.+)$/u.exec(path);
      if (labelPath && method === "DELETE") {
        github.onLabelRemoved?.();
        if (!github.labels.includes(labelPath[1]))
          return new Response(null, { status: 404 });
        github.labels = github.labels.filter((name) => name !== labelPath[1]);
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
  const env = {
    SLOPBOT_DB: db as unknown as D1Database,
    SLOPBOT_APP_ID: "1",
    SLOPBOT_APP_PRIVATE_KEY: privateKey,
    SLOPBOT_APP_USER_ID: APP_USER_ID,
    SURPLUS_API_KEY: "local-submission-fee",
    SURPLUS_BASE_URL: server.url.origin,
    SLOPBOT_WEBHOOK_SECRET: "local-only",
    SLOPBOT_QUEUE: { send: async (job: Job) => void queued.push(job) },
    ...(options.mode === undefined
      ? { SUBMISSION_FEE_MODE: "live" }
      : options.mode === "absent"
        ? {}
        : { SUBMISSION_FEE_MODE: options.mode }),
  } as unknown as ReviewEnv;
  const base = {
    installationId: 1,
    repositoryId,
    owner,
    repo,
    number: 5,
  };
  const reviewJob = (deliveryId: string): Extract<Job, { kind: "review" }> => ({
    kind: "review",
    deliveryId,
    itemKind: "pull_request",
    ...base,
  });
  let deliveries = 0;
  return {
    sqlite,
    env,
    github,
    repositoryId,
    projectId: fixture.id,
    owner,
    repo,
    prompts,
    queued,
    publish,
    /** Non-GET requests to GitHub since the last call, tokens left out. */
    takeWrites() {
      const taken = writes.filter(
        (write) =>
          !write.endsWith("/access_tokens") && write !== "POST /v1/messages",
      );
      writes.length = 0;
      return taken;
    },
    review: () => reviewItem(env, reviewJob(`delivery-${++deliveries}`)),
    check: (now?: Date) =>
      refreshSubmissionFee(
        env,
        feeJob({ deliveryId: `fee-${++deliveries}`, ...base }),
        now,
      ),
    dispatch: (now?: Date) =>
      dispatchFeeChecks(
        env as never,
        { send: async (job) => void queued.push(job) },
        now,
      ),
    ready: () =>
      refreshReadyLabel(
        env,
        readyJob({ deliveryId: `ready-${++deliveries}`, ...base }),
      ),
    item: () =>
      sqlite
        .query(
          "SELECT project_id, item, stable_minor, paid_at, outcome FROM submission_fee_items WHERE repository_id = ? AND pull_number = 5",
        )
        .get(repositoryId) as {
        project_id: string;
        item: string;
        stable_minor: string;
        paid_at: string | null;
        outcome: string | null;
      } | null,
    gate: () =>
      sqlite
        .query(
          "SELECT state, reason, comment_id, next_check_at FROM slopbot_fee_gates WHERE repository_id = ? AND pull_number = 5",
        )
        .get(repositoryId) as {
        state: string;
        reason: string;
        comment_id: number | null;
        next_check_at: string | null;
      } | null,
    reviewRow: () =>
      sqlite
        .query(
          "SELECT status, skip_reason FROM slopbot_reviews WHERE item_node_id = 'PR_local' ORDER BY created_at DESC LIMIT 1",
        )
        .get() as { status: string; skip_reason: string | null } | null,
    /**
     * The author's standing deposit, as the website and the submission-fee
     * Worker write it. Paid unless `paidAt` is null.
     */
    standingDeposit(
      options: {
        paidAt?: string | null;
        withdrawRequestedAt?: string | null;
        outcome?: string | null;
        round?: number;
      } = {},
    ) {
      const round = options.round ?? 1;
      const paidAt =
        options.paidAt === undefined ? STANDING_PAID_AT : options.paidAt;
      const id = `sd_localtest_${round}`;
      sqlite.run(
        `INSERT INTO standing_deposits (id, github_id, round, item, slop_amount, slop_per_usd, asked_at,
           paid_at, paid_network, paid_deposit_id, withdraw_requested_at, outcome, outcome_reason, outcome_at)
         VALUES (?, 42, ?, ?, '755000000000000000000', '75.4717', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          round,
          standingDepositItem(42, round),
          "2026-11-01T00:00:00.000Z",
          paidAt,
          paidAt === null ? null : "robinhood-standing",
          paidAt === null ? null : round,
          options.withdrawRequestedAt ?? null,
          options.outcome ?? null,
          options.outcome ? "withdrawn" : null,
          options.outcome ? paidAt : null,
        ],
      );
      return id;
    },
    deposit: (id = "sd_localtest_1") =>
      sqlite
        .query(
          "SELECT outcome, outcome_reason, strike_repository_id, strike_pull_number FROM standing_deposits WHERE id = ?",
        )
        .get(id) as {
        outcome: string | null;
        outcome_reason: string | null;
        strike_repository_id: number | null;
        strike_pull_number: number | null;
      },
    cover: () =>
      sqlite
        .query(
          "SELECT deposit_id, opened_at, window_start, state, pr_open, strike_seen_at, next_check_at FROM standing_deposit_covers WHERE repository_id = ? AND pull_number = 5",
        )
        .get(repositoryId) as {
        deposit_id: string;
        opened_at: string;
        window_start: string;
        state: string;
        pr_open: number;
        strike_seen_at: string | null;
        next_check_at: string | null;
      } | null,
    /** Make the cover due for the next scheduled read. */
    coverDue() {
      sqlite.run(
        "UPDATE standing_deposit_covers SET next_check_at = NULL WHERE repository_id = ? AND pull_number = 5",
        [repositoryId],
      );
    },
    standing: (now: Date) => checkStandingDeposits(env as never, now),
    /** What the submission-fee Worker writes when it accepts a deposit. */
    pay(at: string) {
      sqlite.run(
        "UPDATE submission_fee_items SET paid_at = ?, paid_network = 'base-mainnet', paid_deposit_id = 12 WHERE repository_id = ? AND pull_number = 5",
        [at, repositoryId],
      );
    },
    /**
     * Run queued jobs through the Worker's own consumer, oldest first. With
     * `redeliver`, a job the consumer retries is delivered again, as the
     * queue does a minute later.
     */
    async drain(redeliver = false) {
      const kinds: string[] = [];
      while (queued.length > 0) {
        if (kinds.length > 20) throw new Error("the queue never settles");
        const body = queued.shift() as Job;
        kinds.push(body.kind);
        let retried = false;
        await worker.queue(
          {
            messages: [
              {
                body,
                ack() {},
                retry() {
                  retried = true;
                },
              },
            ],
          },
          env as never,
        );
        if (retried && !redeliver)
          throw new Error(`job ${body.kind} was retried`);
        if (retried) {
          kinds.push("retry");
          queued.push(body);
        }
      }
      return kinds;
    },
    /** A signed pull_request webhook delivered to the Worker. */
    async webhook(action: string, sender = 7) {
      const body = JSON.stringify({
        action,
        installation: { id: 1 },
        repository: {
          id: repositoryId,
          name: repo,
          private: false,
          owner: { login: owner },
        },
        sender: { id: sender, type: "User" },
        pull_request: { number: 5 },
      });
      const response = await worker.fetch(
        new Request("https://slopbot.example/github/webhook", {
          method: "POST",
          body,
          headers: {
            "x-github-event": "pull_request",
            "x-github-delivery": `hook-${++deliveries}`,
            "x-hub-signature-256": `sha256=${createHmac("sha256", "local-only").update(body).digest("hex")}`,
          },
        }),
        env as never,
      );
      return response.status;
    },
    async slopbotClosesAndAuthorAppeals(closedAt: Date, appealedAt: Date) {
      setSystemTime(appealedAt);
      github.state = "closed";
      github.closedAt = closedAt.toISOString();
      if (slopbotCloses)
        await recordAction(
          env.SLOPBOT_DB,
          `review:PR_local:${github.head}`,
          repositoryId,
          "PR_local",
          "close",
          "missing_evidence",
        );
      const appeal = await openAppeal(env.SLOPBOT_DB, {
        appealKey: `appeal:PR_local:${github.head}`,
        job: {
          kind: "appeal",
          deliveryId: `appeal-${++deliveries}`,
          senderId: author.id,
          itemKind: "pull_request",
          ...base,
        },
        itemNodeId: "PR_local",
        appellantId: author.id,
      });
      return (resolution: "upheld" | "denied", at: Date) => {
        setSystemTime(at);
        return resolveAppeal(
          env.SLOPBOT_DB,
          appeal.appeal_key,
          resolution,
          "moderator",
        );
      };
    },
    feeComments: () =>
      github.comments.filter(
        (comment) =>
          comment.body.startsWith(FEE_MARKER) &&
          String(comment.user.id) === APP_USER_ID,
      ),
    close() {
      globalThis.fetch = nativeFetch;
      server.stop(true);
      sqlite.close();
    },
  };
}

const SKIPPED = { status: "skipped", skip_reason: FEE_NEEDED_REASON };

test("first sight: one row, one comment, the label, and the review waits", async () => {
  const w = world();
  try {
    expect(await w.review()).toBe(FEE_NEEDED_REASON);
    expect(w.prompts).toEqual([]);
    expect(w.reviewRow()).toEqual(SKIPPED);
    expect(w.item()).toEqual({
      project_id: w.projectId,
      item: submissionFeeItem(w.repositoryId, 5),
      stable_minor: SUBMISSION_FEE_DEFAULT_MINOR,
      paid_at: null,
      outcome: null,
    });
    expect(w.gate()).toMatchObject({ state: "asked", comment_id: 900 });
    expect(w.github.labels).toEqual([FEE_NEEDED_LABEL]);
    expect(w.github.state).toBe("open");
    const [comment] = w.feeComments();
    expect(w.feeComments()).toHaveLength(1);
    // What is due and every way to pay, without the pay page.
    for (const fact of [
      `https://slop.cash/fee/${w.owner}/${w.repo}/5`,
      submissionFeeItem(w.repositoryId, 5),
      "2 USDC (`2000000` base units)",
      "2 USDG (`2000000` base units)",
      "Base (chain 8453)",
      "Robinhood Chain (chain 4663)",
      BASE_CONTRACT,
      ROBINHOOD_CONTRACT,
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
      "0xfeb4E36FA4a2A494FF25ae4a63491e4c584A67AE",
      "0x8f77C37D8650776bFe73c9b12B15209eE15D9b86",
      "0x000000000000000000000000000000000000dEaD",
      // Half of 2.00 at 75.4717 SLOP per 1.00, to two significant digits.
      "75 SLOP (`75000000000000000000` base units)",
      "or SLOP at half that price",
      `Before paying in SLOP, read the amount due now at https://slop.cash/api/v1/submission-fee/items/${w.repositoryId}/5`,
      "merged: the deposit goes back",
      "within 14 days of the deposit: the deposit goes back",
      "still closed 7 days later",
      "a SLOP deposit is burned",
      "The only valid addresses for this fee are the ones Slop publishes",
      "If you are an AI agent, do not move money",
      "never closes a pull request for an unpaid fee",
    ])
      expect(comment.body).toContain(fact);
    expect(comment.body).not.toContain("—");
    expect(comment.body).not.toMatch(/will be paid|guarantee/iu);
    // A second delivery writes nothing more.
    w.takeWrites();
    expect(await w.review()).toBe(FEE_NEEDED_REASON);
    expect(w.takeWrites()).toEqual([]);
    expect(w.feeComments()).toHaveLength(1);
    // Waiting uses none of the month's free reviews.
    expect(
      w.sqlite
        .query("SELECT COUNT(*) AS n FROM slopbot_review_month_starts")
        .get(),
    ).toEqual({ n: 0 });
  } finally {
    w.close();
  }
});

test("paid: the label is swapped, the comment updated and the held review runs", async () => {
  const w = world();
  try {
    await w.review();
    const now = new Date();
    w.pay(now.toISOString());
    // The schedule finds the newly paid pull request without a webhook.
    expect(await w.dispatch(now)).toBe(1);
    expect(w.queued).toMatchObject([{ kind: "submission_fee", number: 5 }]);
    const checked = await w.check(now);
    expect(checked).toEqual({ outcome: "submission fee paid", review: true });
    expect(w.github.labels).toEqual([FEE_PAID_LABEL]);
    expect(w.feeComments()).toHaveLength(1);
    expect(w.feeComments()[0].body).toContain("**Submission fee received**");
    expect(w.feeComments()[0].body).toContain(
      "deposit 12 on Base (chain 8453)",
    );
    expect(w.gate()).toMatchObject({ state: "paid", comment_id: 900 });
    expect(w.item()).toMatchObject({ outcome: null });
    // The review that was skipped now reaches the model and completes.
    expect(await w.review()).not.toBe(FEE_NEEDED_REASON);
    expect(w.prompts.length).toBeGreaterThan(0);
    expect(w.reviewRow()).toMatchObject({ status: "completed" });
    expect(w.github.state).toBe("open");
  } finally {
    w.close();
  }
});

test("merged: a paid fee is due back, once", async () => {
  const w = world();
  try {
    await w.review();
    const now = new Date();
    w.pay(now.toISOString());
    await w.check(now);
    w.github.state = "closed";
    w.github.merged = true;
    w.github.closedAt = now.toISOString();
    // A merge event queues the check.
    expect(
      await feeCheckWanted(w.env, { repositoryId: w.repositoryId, number: 5 }),
    ).toBe(true);
    expect((await w.check(now)).outcome).toBe(
      "submission fee: refund_due: merged",
    );
    expect(w.item()).toMatchObject({ outcome: "refund_due" });
    expect(w.feeComments()[0].body).toContain(
      "**Refund due.** This pull request was merged",
    );
    expect(w.gate()).toMatchObject({ state: "paid", next_check_at: null });
    // Decided: no later event or schedule touches it again.
    expect(
      await feeCheckWanted(w.env, { repositoryId: w.repositoryId, number: 5 }),
    ).toBe(false);
    expect(await w.dispatch(new Date(now.getTime() + 30 * DAY))).toBe(0);
    w.takeWrites();
    await w.check(new Date(now.getTime() + 30 * DAY));
    expect(w.takeWrites()).toEqual([]);
    expect(w.item()).toMatchObject({ outcome: "refund_due" });
  } finally {
    w.close();
  }
});

test("an unpaid pull request that is merged has nothing due", async () => {
  const w = world();
  try {
    await w.review();
    w.github.state = "closed";
    w.github.merged = true;
    expect(
      await feeCheckWanted(w.env, { repositoryId: w.repositoryId, number: 5 }),
    ).toBe(false);
    expect((await w.check()).outcome).toBe("submission fee not paid");
    expect(w.item()).toMatchObject({ paid_at: null, outcome: null });
  } finally {
    w.close();
  }
});

test("undecided: still open 14 days after payment, the fee is due back", async () => {
  const w = world();
  try {
    await w.review();
    const paid = new Date("2026-11-12T00:00:00.000Z");
    w.pay(paid.toISOString());
    const day13 = new Date(paid.getTime() + 13 * DAY);
    await w.check(day13);
    expect(w.item()).toMatchObject({ outcome: null });
    // Read again within a day, and no later than the 14-day mark.
    expect(w.gate()?.next_check_at).toBe(
      new Date(paid.getTime() + 14 * DAY).toISOString(),
    );
    const day14 = new Date(paid.getTime() + 14 * DAY);
    expect(await w.dispatch(day14)).toBe(1);
    expect((await w.check(day14)).outcome).toBe(
      "submission fee: refund_due: undecided",
    );
    expect(w.item()).toMatchObject({ outcome: "refund_due" });
    expect(w.feeComments()[0].body).toContain(
      "No maintainer merged or closed this pull request within 14 days",
    );
    expect(w.github.state).toBe("open");
  } finally {
    w.close();
  }
});

test("closed: a paid fee is kept only after 7 days still closed", async () => {
  const w = world();
  try {
    await w.review();
    const paid = new Date("2026-11-12T00:00:00.000Z");
    w.pay(paid.toISOString());
    await w.check(paid);
    const closed = new Date(paid.getTime() + 2 * DAY);
    w.github.state = "closed";
    w.github.closedAt = closed.toISOString();
    await w.check(new Date(closed.getTime() + 6 * DAY));
    expect(w.item()).toMatchObject({ outcome: null });
    expect(w.gate()?.next_check_at).toBe(
      new Date(closed.getTime() + 7 * DAY).toISOString(),
    );
    const due = new Date(closed.getTime() + 7 * DAY);
    expect(await w.dispatch(due)).toBe(1);
    expect((await w.check(due)).outcome).toBe(
      "submission fee: kept_due: closed",
    );
    expect(w.item()).toMatchObject({ outcome: "kept_due" });
    expect(w.feeComments()[0].body).toContain("**Fee kept.**");
  } finally {
    w.close();
  }
});

test("closed for a wanted issue: refunded unless a maintainer adds the keep label", async () => {
  for (const marked of [false, true]) {
    const w = world();
    try {
      await w.review();
      const paid = new Date("2026-11-12T00:00:00.000Z");
      w.pay(paid.toISOString());
      await w.check(paid);
      w.github.wantedEvents = [
        {
          type: "LabeledEvent",
          at: "2026-11-01T00:00:00Z",
          label: "slop-wanted",
        },
      ];
      const closed = new Date(paid.getTime() + 2 * DAY);
      w.github.state = "closed";
      w.github.closedAt = closed.toISOString();
      await w.check(new Date(closed.getTime() + DAY));
      // The label exists for the maintainer to pick.
      expect(w.github.repoLabels).toEqual([SUBMISSION_FEE_KEEP_LABEL]);
      if (marked) w.github.labels.push(SUBMISSION_FEE_KEEP_LABEL);
      const due = new Date(closed.getTime() + 7 * DAY);
      expect((await w.check(due)).outcome).toBe(
        marked
          ? "submission fee: kept_due: marked"
          : "submission fee: refund_due: wanted",
      );
      expect(w.item()).toMatchObject({
        outcome: marked ? "kept_due" : "refund_due",
      });
      expect(w.feeComments()[0].body).toContain(
        marked ? "**Fee kept.**" : "**Refund due.**",
      );
    } finally {
      w.close();
    }
  }
});

test("closed for a wanted issue: an unreadable link decides nothing", async () => {
  const w = world();
  try {
    await w.review();
    const paid = new Date("2026-11-12T00:00:00.000Z");
    w.pay(paid.toISOString());
    await w.check(paid);
    w.github.wantedEvents = [
      {
        type: "LabeledEvent",
        at: "2026-11-01T00:00:00Z",
        label: "slop-wanted",
      },
    ];
    w.github.graphqlDown = true;
    w.github.state = "closed";
    const closed = new Date(paid.getTime() + DAY);
    w.github.closedAt = closed.toISOString();
    await w.check(new Date(closed.getTime() + 8 * DAY));
    expect(w.item()).toMatchObject({ outcome: null });
    w.github.graphqlDown = false;
    expect((await w.check(new Date(closed.getTime() + 9 * DAY))).outcome).toBe(
      "submission fee: refund_due: wanted",
    );
  } finally {
    w.close();
  }
});

test("reopened before the 7 days: nothing is kept, and a later merge refunds", async () => {
  const w = world();
  try {
    await w.review();
    const paid = new Date("2026-11-12T00:00:00.000Z");
    w.pay(paid.toISOString());
    await w.check(paid);
    w.github.state = "closed";
    w.github.closedAt = new Date(paid.getTime() + DAY).toISOString();
    await w.check(new Date(paid.getTime() + 2 * DAY));
    w.github.state = "open";
    w.github.closedAt = null;
    // Well past seven days from the close, but it was reopened.
    await w.check(new Date(paid.getTime() + 10 * DAY));
    expect(w.item()).toMatchObject({ outcome: null });
    w.github.state = "closed";
    w.github.merged = true;
    await w.check(new Date(paid.getTime() + 11 * DAY));
    expect(w.item()).toMatchObject({ outcome: "refund_due" });
  } finally {
    w.close();
  }
});

test("an appeal of Slopbot's own close holds the kept fee until a moderator decides it", async () => {
  const w = world();
  try {
    await w.review();
    const paid = new Date("2026-11-12T00:00:00.000Z");
    const closed = new Date(paid.getTime() + DAY);
    w.pay(paid.toISOString());
    await w.check(paid);
    const decide = await w.slopbotClosesAndAuthorAppeals(
      closed,
      new Date(closed.getTime() + DAY),
    );
    const day7 = new Date(closed.getTime() + 7 * DAY);
    expect((await w.check(day7)).outcome).toBe("submission fee: fee-paid");
    expect(w.item()).toMatchObject({ outcome: null });
    expect(w.gate()?.next_check_at).toBe(
      new Date(day7.getTime() + DAY).toISOString(),
    );
    const day8 = new Date(closed.getTime() + 8 * DAY);
    expect(await w.dispatch(day8)).toBe(1);
    await w.check(day8);
    expect(w.item()).toMatchObject({ outcome: null });
    expect(await decide("upheld", day8)).toBe(true);
    await w.check(new Date(closed.getTime() + 8.5 * DAY));
    expect(w.item()).toMatchObject({ outcome: null });
    w.github.state = "open";
    w.github.closedAt = null;
    await w.check(new Date(closed.getTime() + 9 * DAY));
    expect(w.item()).toMatchObject({ outcome: null });
    w.github.state = "closed";
    w.github.merged = true;
    w.github.closedAt = new Date(closed.getTime() + 10 * DAY).toISOString();
    expect((await w.check(new Date(closed.getTime() + 10 * DAY))).outcome).toBe(
      "submission fee: refund_due: merged",
    );
    expect(w.item()).toMatchObject({ outcome: "refund_due" });
  } finally {
    w.close();
  }
});

test("a denied appeal of Slopbot's close keeps the fee at the next check", async () => {
  const w = world();
  try {
    await w.review();
    const paid = new Date("2026-11-12T00:00:00.000Z");
    const closed = new Date(paid.getTime() + DAY);
    w.pay(paid.toISOString());
    await w.check(paid);
    const decide = await w.slopbotClosesAndAuthorAppeals(
      closed,
      new Date(closed.getTime() + DAY),
    );
    await w.check(new Date(closed.getTime() + 7 * DAY));
    expect(w.item()).toMatchObject({ outcome: null });
    await openAppeal(w.env.SLOPBOT_DB, {
      appealKey: `value-appeal:single:${"e".repeat(64)}:42:${w.repositoryId}:5`,
      job: {
        kind: "appeal",
        deliveryId: "value-dispute",
        senderId: 42,
        itemKind: "pull_request",
        subject: "value",
        installationId: 1,
        repositoryId: w.repositoryId,
        owner: w.owner,
        repo: w.repo,
        number: 5,
      },
      itemNodeId: "PR_local",
      appellantId: 42,
    });
    expect(await decide("denied", new Date(closed.getTime() + 8 * DAY))).toBe(
      true,
    );
    expect((await w.check(new Date(closed.getTime() + 8 * DAY))).outcome).toBe(
      "submission fee: kept_due: closed",
    );
    expect(w.item()).toMatchObject({ outcome: "kept_due" });
  } finally {
    w.close();
  }
});

test("an appeal does not hold the fee of a pull request a maintainer closed", async () => {
  const w = world({ slopbotCloses: false });
  try {
    await w.review();
    const paid = new Date("2026-11-12T00:00:00.000Z");
    const closed = new Date(paid.getTime() + DAY);
    w.pay(paid.toISOString());
    await w.check(paid);
    await w.slopbotClosesAndAuthorAppeals(
      closed,
      new Date(closed.getTime() + DAY),
    );
    expect((await w.check(new Date(closed.getTime() + 7 * DAY))).outcome).toBe(
      "submission fee: kept_due: closed",
    );
  } finally {
    w.close();
  }
});

const BASE = "base-mainnet";
const GAS = { perTransactionWei: "1000", perDayWei: "2500" };

async function keptBeforeAnyAppeal(w: ReturnType<typeof world>) {
  await w.review();
  const paid = new Date("2026-11-12T00:00:00.000Z");
  const closed = new Date(paid.getTime() + DAY);
  w.pay(paid.toISOString());
  await w.check(paid);
  w.github.state = "closed";
  w.github.closedAt = closed.toISOString();
  expect((await w.check(new Date(closed.getTime() + 7 * DAY))).outcome).toBe(
    "submission fee: kept_due: closed",
  );
  w.sqlite.run(
    `INSERT INTO submission_fee_deposits (network, deposit_id, item, repository_id, pull_number,
       payer, token, amount, kept_to, tx_hash, block_number, block_time, finalized_at, accepted, state)
     VALUES (?, 12, ?, ?, 5, ?, ?, ?, ?, ?, 1, ?, ?, 1, 'kept_due')`,
    [
      BASE,
      submissionFeeItem(w.repositoryId, 5),
      w.repositoryId,
      `0x${"4".repeat(40)}`,
      SUBMISSION_FEE_TOKENS[BASE].usdc as string,
      SUBMISSION_FEE_DEFAULT_MINOR,
      SUBMISSION_FEE_KEPT_TO[BASE],
      `0x${"5".repeat(64)}`,
      paid.toISOString(),
      paid.toISOString(),
    ],
  );
  const store = new D1FeeStore(
    w.env.SLOPBOT_DB as unknown as SubmissionFeeD1Database,
  );
  const action = async () => {
    const [entry] = await store.resolvable(BASE);
    return entry
      ? submissionResolveAction(BASE, entry.deposit, entry.item)
      : null;
  };
  const send = (id: string, mode: "live" | "dry_run") =>
    store.insertSend(
      {
        id: `sfs_${id.padEnd(8, "0")}`,
        network: BASE,
        mode,
        contract: BASE_CONTRACT,
        deposits: [{ id: 12, refund: false }],
        resolver: mode === "live" ? `0x${"6".repeat(40)}` : null,
        txId: mode === "live" ? `0x${id.padEnd(64, "7")}` : null,
        rawTx: mode === "live" ? "0x02signedbytes" : null,
        evmNonce: mode === "live" ? 1 : null,
        maximumNativeWei: mode === "live" ? "100" : null,
        state: mode === "live" ? "submitted" : "recorded",
        reason: null,
        blockNumber: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        finalizedAt: null,
      },
      GAS,
    );
  return {
    closed,
    store,
    action,
    send,
    key: `appeal:PR_local:${w.github.head}`,
  };
}

test("an appeal opened after the fee is due but before the Worker sends puts the outcome back", async () => {
  const w = world();
  try {
    const { closed, action, key } = await keptBeforeAnyAppeal(w);
    expect(await action()).toBe("keep");
    const day9 = new Date(closed.getTime() + 9 * DAY);
    const decide = await w.slopbotClosesAndAuthorAppeals(closed, day9);
    expect(await reopenKeptFee(w.env.SLOPBOT_DB, key, day9)).toBe(true);
    expect(w.item()).toMatchObject({ outcome: null });
    expect(w.gate()?.next_check_at).toBe(day9.toISOString());
    expect(await action()).toBeNull();
    expect(await w.dispatch(day9)).toBe(1);
    await w.check(day9);
    expect(w.item()).toMatchObject({ outcome: null });
    expect(w.feeComments()[0].body).not.toContain("**Fee kept.**");
    expect(await decide("upheld", new Date(closed.getTime() + 10 * DAY))).toBe(
      true,
    );
    expect(await reopenKeptFee(w.env.SLOPBOT_DB, key)).toBe(false);
    w.github.state = "open";
    w.github.closedAt = null;
    await w.check(new Date(closed.getTime() + 10 * DAY));
    w.github.state = "closed";
    w.github.merged = true;
    w.github.closedAt = new Date(closed.getTime() + 11 * DAY).toISOString();
    expect((await w.check(new Date(closed.getTime() + 11 * DAY))).outcome).toBe(
      "submission fee: refund_due: merged",
    );
    expect(await action()).toBe("refund");
  } finally {
    w.close();
  }
});

test("an appeal opened after the Worker recorded its send leaves the kept fee alone", async () => {
  const w = world();
  try {
    const { closed, action, send, key } = await keptBeforeAnyAppeal(w);
    await send("drydry", "dry_run");
    await send("live01", "live");
    const day9 = new Date(closed.getTime() + 9 * DAY);
    await w.slopbotClosesAndAuthorAppeals(closed, day9);
    const before = { item: w.item(), gate: w.gate() };
    expect(await reopenKeptFee(w.env.SLOPBOT_DB, key, day9)).toBe(false);
    expect({ item: w.item(), gate: w.gate() }).toEqual(before);
    expect(w.item()).toMatchObject({ outcome: "kept_due" });
    expect(await action()).toBe("keep");
  } finally {
    w.close();
  }
});

test("a dry-run record or a failed send does not stop the outcome going back", async () => {
  const w = world();
  try {
    const { closed, store, send, key } = await keptBeforeAnyAppeal(w);
    await send("drydry", "dry_run");
    await send("live01", "live");
    await store.updateSend("sfs_live0100", {
      state: "failed",
      reason: "reverted",
      updatedAt: new Date().toISOString(),
    });
    const day9 = new Date(closed.getTime() + 9 * DAY);
    await w.slopbotClosesAndAuthorAppeals(closed, day9);
    expect(await reopenKeptFee(w.env.SLOPBOT_DB, key, day9)).toBe(true);
    expect(w.item()).toMatchObject({ outcome: null });
  } finally {
    w.close();
  }
});

test("only an appeal of Slopbot's own close puts a kept fee back", async () => {
  const w = world({ slopbotCloses: false });
  try {
    const { closed, key } = await keptBeforeAnyAppeal(w);
    await w.slopbotClosesAndAuthorAppeals(
      closed,
      new Date(closed.getTime() + 9 * DAY),
    );
    expect(await reopenKeptFee(w.env.SLOPBOT_DB, key)).toBe(false);
    expect(w.item()).toMatchObject({ outcome: "kept_due" });
  } finally {
    w.close();
  }
});

test("a replayed appeal that was already denied does not put a kept fee back", async () => {
  const w = world();
  try {
    const { closed, key } = await keptBeforeAnyAppeal(w);
    const decide = await w.slopbotClosesAndAuthorAppeals(
      closed,
      new Date(closed.getTime() + 9 * DAY),
    );
    await decide("denied", new Date(closed.getTime() + 10 * DAY));
    expect(await reopenKeptFee(w.env.SLOPBOT_DB, key)).toBe(false);
    expect(w.item()).toMatchObject({ outcome: "kept_due" });
  } finally {
    w.close();
  }
});

test("a Worker that read the kept fee before the clear still sends it, and the chain's record wins", async () => {
  const w = world();
  try {
    const { closed, store, action, send, key } = await keptBeforeAnyAppeal(w);
    expect(await action()).toBe("keep");
    const day9 = new Date(closed.getTime() + 9 * DAY);
    await w.slopbotClosesAndAuthorAppeals(closed, day9);
    expect(await reopenKeptFee(w.env.SLOPBOT_DB, key, day9)).toBe(true);
    await send("live01", "live");
    expect(w.item()).toMatchObject({ outcome: null });
    await store.writeFinalizedPage({
      network: BASE,
      from: 2,
      to: 3,
      deposits: [],
      resolutions: [
        {
          depositId: 12,
          state: "kept",
          txHash: `0x${"8".repeat(64)}`,
          at: day9.toISOString(),
        },
      ],
      finalizedAt: day9.toISOString(),
    });
    expect(w.item()).toMatchObject({ outcome: "kept" });
  } finally {
    w.close();
  }
});

test("reopenKeptFee leaves a standing-deposit-covered pull request untouched", async () => {
  const w = world();
  try {
    const depositId = w.standingDeposit({ outcome: "kept_due" });
    await w.review();
    const closed = new Date("2026-11-13T00:00:00.000Z");
    const day9 = new Date(closed.getTime() + 9 * DAY);
    await w.slopbotClosesAndAuthorAppeals(closed, day9);
    expect(
      await reopenKeptFee(
        w.env.SLOPBOT_DB,
        `appeal:PR_local:${w.github.head}`,
        day9,
      ),
    ).toBe(false);
    expect(w.deposit(depositId).outcome).toBe("kept_due");
  } finally {
    w.close();
  }
});

test("an author with write access is never asked", async () => {
  const w = world({ permission: "write" });
  try {
    expect(await w.review()).not.toBe(FEE_NEEDED_REASON);
    expect(w.item()).toBeNull();
    expect(w.gate()).toBeNull();
    expect(w.github.labels).toEqual([]);
    expect(w.feeComments()).toEqual([]);
  } finally {
    w.close();
  }
});

test("a bot's pull request and a draft are never asked", async () => {
  for (const options of [
    { author: { id: 43, type: "Bot" } },
    { draft: true },
  ] satisfies WorldOptions[]) {
    const w = world(options);
    try {
      expect(await w.review()).not.toBe(FEE_NEEDED_REASON);
      expect(w.item()).toBeNull();
      expect(w.takeWrites()).toEqual([]);
    } finally {
      w.close();
    }
  }
});

test("a pull request opened before the setting was turned on is reviewed free", async () => {
  const w = world({ openedAt: "2026-10-20T00:00:00Z" });
  try {
    expect(await w.review()).not.toBe(FEE_NEEDED_REASON);
    expect(w.prompts.length).toBeGreaterThan(0);
    expect(w.item()).toBeNull();
    expect(w.github.labels).toEqual([]);
  } finally {
    w.close();
  }
});

test("the setting counts from when it was last turned on", async () => {
  const w = world({ fee: null });
  try {
    const since = () =>
      feeSettingSince(w.env.SLOPBOT_DB as D1Database, w.projectId);
    expect(await since()).toBeNull();
    w.publish({ enabled: true }, "2026-11-03T00:00:00.000Z");
    expect(await since()).toBe("2026-11-03T00:00:00.000Z");
    // An amount change keeps the time; off and on again moves it.
    w.publish(
      { enabled: true, amountMinor: "5000000" },
      "2026-11-04T00:00:00.000Z",
    );
    expect(await since()).toBe("2026-11-03T00:00:00.000Z");
    w.publish(
      { enabled: false, amountMinor: "5000000" },
      "2026-11-05T00:00:00.000Z",
    );
    expect(await since()).toBeNull();
    w.publish(
      { enabled: true, amountMinor: "5000000" },
      "2026-11-12T00:00:00.000Z",
    );
    expect(await since()).toBe("2026-11-12T00:00:00.000Z");
    // Opened on 10 November, before the setting came back on.
    expect(await w.review()).not.toBe(FEE_NEEDED_REASON);
    expect(w.item()).toBeNull();
  } finally {
    w.close();
  }
});

test("a project with the setting off or absent is reviewed as before", async () => {
  for (const fee of [
    null,
    { enabled: false },
  ] satisfies WorldOptions["fee"][]) {
    const w = world({ fee });
    try {
      expect(await w.review()).not.toBe(FEE_NEEDED_REASON);
      expect(w.prompts.length).toBeGreaterThan(0);
      expect(w.item()).toBeNull();
      expect(w.gate()).toBeNull();
      expect(w.github.labels).toEqual([]);
    } finally {
      w.close();
    }
  }
});

test("the amount is fixed when the pull request is first asked", async () => {
  const w = world({ fee: { enabled: true, amountMinor: "3500000" } });
  try {
    await w.review();
    expect(w.item()).toMatchObject({ stable_minor: "3500000" });
    expect(w.feeComments()[0].body).toContain(
      "3.5 USDC (`3500000` base units)",
    );
    w.publish(
      { enabled: true, amountMinor: "9000000" },
      "2026-11-15T00:00:00.000Z",
    );
    w.takeWrites();
    expect(await w.review()).toBe(FEE_NEEDED_REASON);
    expect(w.item()).toMatchObject({ stable_minor: "3500000" });
    expect(w.takeWrites()).toEqual([]);
  } finally {
    w.close();
  }
});

test("the owner turns the setting off: an unpaid ask is taken back and the review runs", async () => {
  const w = world();
  try {
    await w.review();
    w.publish({ enabled: false }, "2026-11-15T00:00:00.000Z");
    expect(await w.dispatch()).toBe(1);
    expect(await w.check()).toEqual({
      outcome: "submission fee released: setting off",
      review: true,
    });
    expect(w.github.labels).toEqual([]);
    expect(w.feeComments()).toHaveLength(1);
    expect(w.feeComments()[0].body).toContain(
      "No submission fee is needed for this pull request",
    );
    expect(w.gate()).toMatchObject({ state: "released" });
    expect(await w.dispatch()).toBe(0);
    expect(await w.review()).not.toBe(FEE_NEEDED_REASON);
    expect(w.reviewRow()).toMatchObject({ status: "completed" });
  } finally {
    w.close();
  }
});

test("an author who gains write access is released by the next review", async () => {
  const w = world();
  try {
    await w.review();
    w.github.permission = "write";
    expect(await w.review()).not.toBe(FEE_NEEDED_REASON);
    expect(w.github.labels).toEqual([]);
    expect(w.gate()).toMatchObject({
      state: "released",
      reason: "author-exempt",
    });
    expect(w.feeComments()[0].body).toContain("now has write access");
  } finally {
    w.close();
  }
});

test.each([
  ["setting-off", "the owner turns the setting off"],
  ["author-exempt", "the author gains write access"],
] as const)("an ask taken back (%s) pays for no later deposit", async (why) => {
  const w = world();
  try {
    await w.review();
    const item = w.item()?.item ?? "";
    if (why === "setting-off") {
      w.publish({ enabled: false }, "2026-11-15T00:00:00.000Z");
      await w.dispatch();
      await w.check();
    } else {
      w.github.permission = "write";
      await w.review();
    }
    expect(w.gate()).toMatchObject({ state: "released", reason: why });
    expect(w.feeComments()[0].body).toContain(
      "one sent now does not count and goes back",
    );
    // The deposit as the submission-fee Worker's `judge` reads and decides it.
    const store = new D1FeeStore(
      w.env.SLOPBOT_DB as unknown as SubmissionFeeD1Database,
    );
    const verdict = submissionDepositCounts(
      "base-mainnet",
      {
        depositId: 12,
        token: SUBMISSION_FEE_TOKENS["base-mainnet"].usdc as string,
        amount: SUBMISSION_FEE_DEFAULT_MINOR,
        keptTo: SUBMISSION_FEE_KEPT_TO["base-mainnet"],
        blockTime: "2026-11-16T00:00:00.000Z",
      },
      await store.itemByHash(item),
      [],
    );
    expect(verdict).toEqual({ accepted: false, reason: "unknown_item" });
    expect(w.item()).toBeNull();
    if (why === "author-exempt") {
      // Asked again later: the row is written again for the same item.
      w.github.permission = "read";
      expect(await w.review()).toBe(FEE_NEEDED_REASON);
      expect(w.item()).toMatchObject({ item, paid_at: null });
    }
  } finally {
    w.close();
  }
});

test("a deposit accepted while the ask is taken back keeps its paid row", async () => {
  const w = world();
  try {
    await w.review();
    // The submission-fee Worker marks the row paid after Slopbot read it as
    // unpaid and while it takes the ask back.
    w.github.onLabelRemoved = () => w.pay("2026-11-15T00:00:00.000Z");
    w.github.permission = "write";
    await w.review();
    expect(w.gate()).toMatchObject({
      state: "released",
      reason: "author-exempt",
    });
    expect(w.item()).toMatchObject({ paid_at: "2026-11-15T00:00:00.000Z" });
  } finally {
    w.close();
  }
});

test("mode off, absent or unknown: nothing at all", async () => {
  expect(feeMode(undefined)).toBe("off");
  expect(feeMode("on")).toBe("off");
  expect(feeMode("LIVE")).toBe("off");
  expect(feeMode("dry_run")).toBe("dry_run");
  expect(feeMode("live")).toBe("live");
  for (const mode of ["off", "absent", "true"]) {
    const w = world({ mode });
    try {
      expect(await w.review()).not.toBe(FEE_NEEDED_REASON);
      expect(w.prompts.length).toBeGreaterThan(0);
      expect(w.item()).toBeNull();
      expect(w.gate()).toBeNull();
      expect(w.github.labels).toEqual([]);
      expect(w.feeComments()).toEqual([]);
      expect(await w.dispatch()).toBe(0);
      expect((await w.check()).outcome).toBe("submission fee is not live");
    } finally {
      w.close();
    }
  }
});

test("dry run: records what it would ask, writes nothing to GitHub and reviews as today", async () => {
  const w = world({ mode: "dry_run" });
  try {
    expect(await w.review()).not.toBe(FEE_NEEDED_REASON);
    expect(w.prompts.length).toBeGreaterThan(0);
    expect(w.reviewRow()).toMatchObject({ status: "completed" });
    // Nobody was asked, so there is no fee row: only Slopbot's own record.
    expect(w.item()).toBeNull();
    expect(w.gate()).toMatchObject({
      state: "recorded",
      reason: `${FEE_NEEDED_REASON}: record only, review ran`,
      comment_id: null,
    });
    expect(w.github.labels).toEqual([]);
    expect(w.feeComments()).toEqual([]);
    expect(await w.dispatch()).toBe(0);
    // A second review of the same pull request records nothing more.
    w.github.head = "d".repeat(40);
    await w.review();
    expect(w.item()).toBeNull();
    expect(w.gate()).toMatchObject({ state: "recorded" });
  } finally {
    w.close();
  }
});

test("a deposit naming a pull request that was only recorded pays for nothing", async () => {
  const w = world({ mode: "dry_run" });
  try {
    await w.review();
    expect(w.gate()).toMatchObject({ state: "recorded" });
    // The deposit as the submission-fee Worker's `judge` reads and decides it:
    // sent straight to the contract for a pull request nobody was asked about.
    const store = new D1FeeStore(
      w.env.SLOPBOT_DB as unknown as SubmissionFeeD1Database,
    );
    const item = submissionFeeItem(w.repositoryId, 5);
    const verdict = submissionDepositCounts(
      "base-mainnet",
      {
        depositId: 12,
        token: SUBMISSION_FEE_TOKENS["base-mainnet"].usdc as string,
        amount: SUBMISSION_FEE_DEFAULT_MINOR,
        keptTo: SUBMISSION_FEE_KEPT_TO["base-mainnet"],
        blockTime: "2026-11-16T00:00:00.000Z",
      },
      await store.itemByHash(item),
      [],
    );
    expect(verdict).toEqual({ accepted: false, reason: "unknown_item" });
    // Once the switch is live the same pull request is asked for real, and
    // only then does a row exist for a deposit to pay.
    (w.env as { SUBMISSION_FEE_MODE: string }).SUBMISSION_FEE_MODE = "live";
    w.github.head = "d".repeat(40);
    expect(await w.review()).toBe(FEE_NEEDED_REASON);
    expect(w.item()).toMatchObject({
      item,
      stable_minor: SUBMISSION_FEE_DEFAULT_MINOR,
      paid_at: null,
    });
  } finally {
    w.close();
  }
});

test("a pull request only recorded in a dry run is asked once the switch is live", async () => {
  const w = world({ mode: "dry_run" });
  try {
    await w.review();
    (w.env as { SUBMISSION_FEE_MODE: string }).SUBMISSION_FEE_MODE = "live";
    w.github.head = "d".repeat(40);
    expect(await w.review()).toBe(FEE_NEEDED_REASON);
    expect(w.gate()).toMatchObject({ state: "asked" });
    expect(w.github.labels).toEqual([FEE_NEEDED_LABEL]);
    expect(w.feeComments()).toHaveLength(1);
  } finally {
    w.close();
  }
});

test("while no deposit contract is published the fee does nothing at all", async () => {
  expect(feeWays("2000000", [], NOW_ISO, UNPUBLISHED)).toEqual([]);
  for (const mode of ["live", "dry_run"]) {
    const w = world({ mode, contracts: UNPUBLISHED });
    try {
      expect(await w.review()).not.toBe(FEE_NEEDED_REASON);
      expect(w.prompts.length).toBeGreaterThan(0);
      expect(w.item()).toBeNull();
      expect(w.gate()).toBeNull();
      expect(w.github.labels).toEqual([]);
      expect(await w.dispatch()).toBe(0);
    } finally {
      w.close();
    }
  }
});

test("only a network with a published contract is offered", () => {
  const baseOnly = { "base-mainnet": BASE_CONTRACT, "robinhood-mainnet": null };
  const ways = feeWays("2000000", [RATE], NOW_ISO, baseOnly);
  expect(ways.map((way) => way.symbol)).toEqual(["USDC"]);
  const body = feeNeededComment({
    owner: "o",
    repo: "r",
    number: 5,
    repositoryId: 9,
    item: submissionFeeItem(9, 5),
    stableMinor: "2000000",
    ways,
  });
  expect(body).toContain("**2 USDC**. Slopbot's review is free");
  expect(body).toContain("a USDC deposit is kept by Slop.");
  expect(body).not.toContain("SLOP");
  expect(body).not.toContain("USDG");
  expect(
    feeWays("2000000", [RATE], NOW_ISO, {
      "base-mainnet": "0x12",
      "robinhood-mainnet": null,
    }),
  ).toEqual([]);
});

test("SLOP is offered only while a rate is in force, at the Worker's own amount", async () => {
  // 10.00 at 75.4717 is 377.36 SLOP for half: 380 at two significant digits.
  expect(
    feeWays("10000000", [RATE], NOW_ISO, DEPLOYED).map((way) => [
      way.symbol,
      way.amount,
    ]),
  ).toEqual([
    ["USDC", "10000000"],
    ["USDG", "10000000"],
    ["SLOP", "380000000000000000000"],
  ]);
  // A rate that is not in force yet, or none at all: stablecoins only.
  expect(
    feeWays(
      "2000000",
      [{ effectiveAt: "2027-01-01T00:00:00.000Z", slopPerUsd: "75" }],
      NOW_ISO,
      DEPLOYED,
    ).map((way) => way.symbol),
  ).toEqual(["USDC", "USDG"]);
  // An unreadable rate never hides the stablecoin ways.
  expect(
    feeWays(
      "2000000",
      [{ effectiveAt: "not a time", slopPerUsd: "x" }],
      NOW_ISO,
      DEPLOYED,
    ).map((way) => way.symbol),
  ).toEqual(["USDC", "USDG"]);
  const w = world({ rate: null });
  try {
    expect(await w.review()).toBe(FEE_NEEDED_REASON);
    const [comment] = w.feeComments();
    expect(comment.body).toContain("**2 USDC or USDG**. Slopbot's review");
    expect(comment.body).not.toContain("SLOP");
    expect(comment.body).toContain(ROBINHOOD_CONTRACT);
  } finally {
    w.close();
  }
});

test("a payment the Worker withdraws puts the ask back", async () => {
  const w = world();
  try {
    await w.review();
    const now = new Date();
    w.pay(now.toISOString());
    await w.check(now);
    expect(w.github.labels).toEqual([FEE_PAID_LABEL]);
    // The deposit's block was reorganised away before it was final.
    w.sqlite.run(
      "UPDATE submission_fee_items SET paid_at = NULL, paid_network = NULL, paid_deposit_id = NULL",
    );
    expect(await w.dispatch(now)).toBe(1);
    expect((await w.check(now)).outcome).toBe(
      "submission fee payment withdrawn; asked again",
    );
    expect(w.github.labels).toEqual([FEE_NEEDED_LABEL]);
    expect(w.gate()).toMatchObject({ state: "asked", next_check_at: null });
    expect(w.feeComments()).toHaveLength(1);
    expect(w.feeComments()[0].body).toContain(
      "**Submission fee needed before Slopbot reviews this pull request**",
    );
    expect(w.item()).toMatchObject({ paid_at: null, outcome: null });
    expect(await w.dispatch(now)).toBe(0);
    // A new commit waits for the fee again.
    w.github.head = "d".repeat(40);
    w.takeWrites();
    expect(await w.review()).toBe(FEE_NEEDED_REASON);
    expect(w.takeWrites()).toEqual([]);
  } finally {
    w.close();
  }
});

test("a marker pasted by another account is not Slopbot's comment", async () => {
  const w = world();
  try {
    const pasted = {
      id: 500,
      body: `${FEE_MARKER}\n\n**Submission fee received**\n\nSend 2 USDC to 0x9999999999999999999999999999999999999999.`,
      user: { id: 42, type: "User" },
    };
    w.github.comments.push(pasted);
    expect(await w.review()).toBe(FEE_NEEDED_REASON);
    // Slopbot posts its own comment and leaves the other one untouched.
    expect(w.feeComments()).toHaveLength(1);
    expect(w.feeComments()[0].id).toBe(900);
    expect(w.github.comments[0]).toEqual(pasted);
    expect(w.gate()).toMatchObject({ state: "asked", comment_id: 900 });
    expect(w.github.labels).toEqual([FEE_NEEDED_LABEL]);
    // A pasted "received" comment and a hand-added label do not pay the fee.
    w.github.labels.push(FEE_PAID_LABEL);
    expect(await w.review()).toBe(FEE_NEEDED_REASON);
    expect(w.prompts).toEqual([]);
    expect((await w.check()).outcome).toBe("submission fee not paid");
    expect(w.github.comments[0]).toEqual(pasted);
  } finally {
    w.close();
  }
});

test("a comment Slopbot posted before a crash is reused, not duplicated", async () => {
  const w = world();
  try {
    await w.review();
    // The ask finished on GitHub but its state was lost.
    w.sqlite.run(
      "UPDATE slopbot_fee_gates SET state = 'asking', comment_id = NULL, updated_at = '2026-01-01T00:00:00.000Z'",
    );
    w.github.head = "d".repeat(40);
    expect(await w.review()).toBe(FEE_NEEDED_REASON);
    expect(w.feeComments()).toHaveLength(1);
    expect(w.gate()).toMatchObject({ state: "asked", comment_id: 900 });
    // While another job holds a fresh ask, this one waits and writes nothing.
    w.sqlite.run(
      "UPDATE slopbot_fee_gates SET state = 'asking', updated_at = ?",
      [new Date().toISOString()],
    );
    w.github.head = "e".repeat(40);
    w.takeWrites();
    expect(await w.review()).toBe(FEE_NEEDED_REASON);
    expect(w.takeWrites()).toEqual([]);
  } finally {
    w.close();
  }
});

test.each(["comment", "label"] as const)(
  "a first ask whose %s GitHub refuses once is made by the queue's retry",
  async (write) => {
    const w = world();
    try {
      w.github.failures[write] = 1;
      expect(await w.webhook("opened", 42)).toBe(202);
      // The retry comes a minute later in production, well inside the
      // ten-minute lease the failed job took.
      expect(await w.drain(true)).toEqual(["review", "retry", "review"]);
      expect(w.feeComments()).toHaveLength(1);
      expect(w.github.labels).toEqual([FEE_NEEDED_LABEL]);
      expect(w.gate()).toMatchObject({ state: "asked", comment_id: 900 });
      expect(w.reviewRow()).toEqual(SKIPPED);
    } finally {
      w.close();
    }
  },
);

test("nobody is asked for a review the monthly cap would refuse", async () => {
  const w = world();
  try {
    const month = reviewMonth(new Date());
    const insert = w.sqlite.prepare(
      "INSERT INTO slopbot_review_month_starts (repository_id, month, item_kind, item_number, started_at) VALUES (?, ?, 'issue', ?, ?)",
    );
    w.sqlite.transaction(() => {
      for (let n = 1; n <= FREE_REVIEWS_PER_REPO_PER_MONTH; n++)
        insert.run(w.repositoryId, month, 10_000 + n, SETTING_ON_AT);
    })();
    expect(
      await monthlyReviewOpen(
        w.env.SLOPBOT_DB as D1Database,
        w.repositoryId,
        "pull_request",
        5,
      ),
    ).toBe(false);
    expect(await w.review()).toBe("monthly-review-cap");
    expect(w.item()).toBeNull();
    expect(w.github.labels).toEqual([]);
    expect(w.feeComments()).toEqual([]);
  } finally {
    w.close();
  }
});

test("a dry run records no ask for a review the monthly cap would refuse", async () => {
  const w = world({ mode: "dry_run" });
  try {
    const month = reviewMonth(new Date());
    const insert = w.sqlite.prepare(
      "INSERT INTO slopbot_review_month_starts (repository_id, month, item_kind, item_number, started_at) VALUES (?, ?, 'issue', ?, ?)",
    );
    w.sqlite.transaction(() => {
      for (let n = 1; n <= FREE_REVIEWS_PER_REPO_PER_MONTH; n++)
        insert.run(w.repositoryId, month, 10_000 + n, SETTING_ON_AT);
    })();
    // Live asks nothing here, so the record of what it would ask is empty.
    expect(await w.review()).toBe("monthly-review-cap");
    expect(w.item()).toBeNull();
    expect(w.gate()).toBeNull();
    expect(w.github.labels).toEqual([]);
    expect(w.feeComments()).toEqual([]);
  } finally {
    w.close();
  }
});

test("an unpaid pull request never gets the ready label", async () => {
  const w = world({ readyLabel: true });
  try {
    await w.review();
    expect(
      await feeUnpaid(w.env.SLOPBOT_DB as D1Database, w.repositoryId, 5),
    ).toBe(true);
    expect(await w.ready()).toBe(
      "not ready: its submission fee has not been paid",
    );
    expect(w.github.labels).toEqual([FEE_NEEDED_LABEL]);
    // Paid, the same pull request is labelled ready.
    const now = new Date();
    w.pay(now.toISOString());
    await w.check(now);
    await w.review();
    expect(w.reviewRow()).toMatchObject({ status: "completed" });
    expect(await w.ready()).toBe("ready label added");
    expect(w.github.labels).toContain(READY_LABEL);
  } finally {
    w.close();
  }
});

test("the ready decision refuses an unpaid pull request before every other condition", () => {
  const facts: ReadyFacts = {
    open: true,
    draft: false,
    mergeable: true,
    mergeableState: "clean",
    verdict: "none",
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    files: [
      {
        filename: "a.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        patch: "+a",
      },
    ],
    approvals: 1,
    changesRequested: false,
  };
  const settings = {
    enabled: true,
    approvals: 1,
    maxChangedLines: 400,
    maxChangedFiles: 20,
    protectedPaths: [],
  };
  expect(readyDecision(facts, settings).ready).toBe(true);
  expect(readyDecision({ ...facts, feeUnpaid: true }, settings)).toEqual({
    ready: false,
    reason: "its submission fee has not been paid",
    pending: false,
  });
});

test("the outcome rule", () => {
  const paidAt = "2026-11-12T00:00:00.000Z";
  const paid = Date.parse(paidAt);
  const at = (days: number) => new Date(paid + days * DAY);
  const open = {
    paidAt,
    merged: false,
    closed: false,
    closedAt: null,
    appealOpen: false,
    appealUpheldAt: null,
    wanted: false,
    keepMarked: false,
  };
  expect(feeOutcome({ ...open, merged: true }, at(0))).toEqual({
    outcome: "refund_due",
    why: "merged",
    nextCheckAt: null,
  });
  // Open: read again within a day, due back at 14 days.
  expect(feeOutcome(open, at(1))).toEqual({
    outcome: null,
    why: null,
    nextCheckAt: at(2).toISOString(),
  });
  expect(feeOutcome(open, at(13.5)).nextCheckAt).toBe(at(14).toISOString());
  expect(feeOutcome(open, at(14)).outcome).toBe("refund_due");
  // Closed: kept 7 days after the close, never before.
  const closed = { ...open, closed: true, closedAt: at(3).toISOString() };
  expect(feeOutcome(closed, at(9.9))).toEqual({
    outcome: null,
    why: null,
    nextCheckAt: at(10).toISOString(),
  });
  expect(feeOutcome(closed, at(10))).toEqual({
    outcome: "kept_due",
    why: "closed",
    nextCheckAt: null,
  });
  expect(feeOutcome({ ...closed, appealOpen: true }, at(30))).toEqual({
    outcome: null,
    why: null,
    nextCheckAt: at(31).toISOString(),
  });
  const upheld = { ...closed, appealUpheldAt: at(12).toISOString() };
  expect(feeOutcome(upheld, at(18.9)).nextCheckAt).toBe(at(19).toISOString());
  expect(feeOutcome(upheld, at(19)).outcome).toBe("kept_due");
  // A deposit made after the close gets the full 7 days from the deposit.
  const closedBefore = {
    ...open,
    closed: true,
    closedAt: at(-30).toISOString(),
  };
  expect(feeOutcome(closedBefore, at(6)).outcome).toBeNull();
  expect(feeOutcome(closedBefore, at(7)).outcome).toBe("kept_due");
  // A closed pull request is not refunded as undecided at 14 days.
  expect(
    feeOutcome(
      { ...open, closed: true, closedAt: at(13).toISOString() },
      at(15),
    ).outcome,
  ).toBeNull();
  // Without a close time nothing is kept on a guess.
  expect(
    feeOutcome({ ...open, closed: true, closedAt: null }, at(40)).outcome,
  ).toBeNull();
  // Invited work: a closed pull request for a wanted issue goes back unless
  // a maintainer marked it, and an unreadable link waits a day.
  expect(feeOutcome({ ...closed, wanted: true }, at(10))).toEqual({
    outcome: "refund_due",
    why: "wanted",
    nextCheckAt: null,
  });
  expect(
    feeOutcome({ ...closed, wanted: true, keepMarked: true }, at(10)),
  ).toEqual({ outcome: "kept_due", why: "marked", nextCheckAt: null });
  expect(feeOutcome({ ...closed, wanted: true }, at(9.9)).outcome).toBeNull();
  expect(feeOutcome({ ...closed, wanted: null }, at(10))).toEqual({
    outcome: null,
    why: null,
    nextCheckAt: at(11).toISOString(),
  });
  // The keep label on ordinary work changes nothing.
  expect(feeOutcome({ ...closed, keepMarked: true }, at(10)).why).toBe(
    "closed",
  );
});

test("the wanted label counts only if it was on the issue when the pull request opened", () => {
  const answer = (events: [string, string][]) => ({
    repository: {
      pullRequest: {
        createdAt: "2026-11-20T00:00:00Z",
        closingIssuesReferences: {
          nodes: [
            {
              repository: { databaseId: 9 },
              timelineItems: {
                nodes: events.map(([type, at]) => ({
                  __typename: type,
                  createdAt: at,
                  label: { name: "slop-wanted" },
                })),
              },
            },
          ],
        },
      },
    },
  });
  expect(
    wantedAtOpen(answer([["LabeledEvent", "2026-11-19T00:00:00Z"]]), 9),
  ).toBe(true);
  // Labelled after the pull request was opened: not invited.
  expect(
    wantedAtOpen(answer([["LabeledEvent", "2026-11-21T00:00:00Z"]]), 9),
  ).toBe(false);
  // Removed before it was opened.
  expect(
    wantedAtOpen(
      answer([
        ["LabeledEvent", "2026-11-18T00:00:00Z"],
        ["UnlabeledEvent", "2026-11-19T00:00:00Z"],
      ]),
      9,
    ),
  ).toBe(false);
  // Removed after it was opened still counts.
  expect(
    wantedAtOpen(
      answer([
        ["LabeledEvent", "2026-11-18T00:00:00Z"],
        ["UnlabeledEvent", "2026-11-25T00:00:00Z"],
      ]),
      9,
    ),
  ).toBe(true);
  // An issue in another repository does not count.
  expect(
    wantedAtOpen(answer([["LabeledEvent", "2026-11-19T00:00:00Z"]]), 8),
  ).toBe(false);
});

test("through the Worker: a deposit releases the review, and a merge event sets the refund", async () => {
  const w = world();
  try {
    // Opened: the webhook queues the review, which asks and waits.
    expect(await w.webhook("opened", 42)).toBe(202);
    expect(await w.drain()).toEqual(["review"]);
    expect(w.github.labels).toEqual([FEE_NEEDED_LABEL]);
    expect(w.prompts).toEqual([]);
    // A close of an unpaid pull request queues no fee check.
    w.github.state = "closed";
    w.github.closedAt = new Date().toISOString();
    expect(await w.webhook("closed")).toBe(202);
    expect(w.queued.filter((job) => job.kind === "submission_fee")).toEqual([]);
    w.queued.length = 0;
    w.github.state = "open";
    w.github.closedAt = null;
    // Paid: the scheduled check swaps the label and queues the held review.
    const now = new Date();
    w.pay(now.toISOString());
    expect(await w.dispatch(now)).toBe(1);
    expect(await w.drain()).toEqual(["submission_fee", "review"]);
    expect(w.github.labels).toEqual([FEE_PAID_LABEL]);
    expect(w.prompts.length).toBeGreaterThan(0);
    expect(w.reviewRow()).toMatchObject({ status: "completed" });
    // Merged: the close event queues the check that sets the refund.
    w.github.state = "closed";
    w.github.merged = true;
    w.github.closedAt = new Date().toISOString();
    expect(await w.webhook("closed")).toBe(202);
    expect(w.queued.map((job) => job.kind)).toContain("submission_fee");
    await w.drain();
    expect(w.item()).toMatchObject({ outcome: "refund_due" });
    expect(w.github.state).toBe("closed");
  } finally {
    w.close();
  }
});

test("a review that finds a fresh deposit queues the label swap at once", async () => {
  const w = world();
  try {
    await w.webhook("opened", 42);
    await w.drain();
    w.pay(new Date().toISOString());
    // A push arrives before the schedule runs.
    w.github.head = "d".repeat(40);
    await w.webhook("synchronize", 42);
    // The check queues the held review; it is already done at this commit.
    expect(await w.drain()).toEqual(["review", "submission_fee", "review"]);
    expect(w.github.labels).toEqual([FEE_PAID_LABEL]);
    expect(w.reviewRow()).toMatchObject({ status: "completed" });
    expect(w.feeComments()).toHaveLength(1);
  } finally {
    w.close();
  }
});

// ---------------------------------------------------------------------------
// The standing deposit (operator decision, 23 November 2026; PRD section 5).

const HOUR = 60 * 60_000;
/** Window of the cover: opened 10 November, so it ends 1 December. */
const WINDOW_ENDS = Date.parse(OPENED_AFTER) + 21 * DAY;
const COVERED = { status: "completed" };

test("standing deposit: covered at first sight, one comment and label, and the review runs", async () => {
  const w = world();
  try {
    w.standingDeposit();
    expect(await w.review()).not.toBe(FEE_NEEDED_REASON);
    expect(w.prompts.length).toBeGreaterThan(0);
    expect(w.reviewRow()).toMatchObject(COVERED);
    expect(w.item()).toBeNull();
    expect(w.gate()).toMatchObject({
      state: "released",
      reason: "standing-deposit",
      comment_id: 900,
    });
    expect(w.github.labels).toEqual([STANDING_DEPOSIT_COVERED_LABEL]);
    expect(w.cover()).toMatchObject({
      deposit_id: "sd_localtest_1",
      opened_at: new Date(OPENED_AFTER).toISOString(),
      // The later of opening and payment.
      window_start: new Date(OPENED_AFTER).toISOString(),
      state: "watch",
      pr_open: 1,
      strike_seen_at: null,
    });
    expect(w.github.searches).toEqual([
      `is:pr is:merged author:author repo:${w.owner}/${w.repo}`,
    ]);
    const [comment] = w.feeComments();
    expect(w.feeComments()).toHaveLength(1);
    for (const fact of [
      "**Covered by your standing deposit**",
      "https://slop.cash/deposit",
      "`slop-keep-fee` within 21 days",
      "48 hours later",
      "the whole standing deposit is kept and burned",
      "An ordinary close costs nothing.",
    ])
      expect(comment.body).toContain(fact);
    expect(comment.body).not.toContain("—");
    expect(comment.body).not.toMatch(/faster|priority|earned|owed|stake/iu);
    // A later delivery writes nothing more and spends no search.
    w.takeWrites();
    await w.review();
    expect(w.takeWrites()).toEqual([]);
    expect(w.github.searches).toHaveLength(1);
  } finally {
    w.close();
  }
});

test("standing deposit: the merged answer is kept for a day, a paid deposit covering a pull request opened before payment starts the window at payment", async () => {
  const w = world();
  try {
    w.standingDeposit({ paidAt: "2026-11-12T00:00:00.000Z" });
    w.sqlite.run(
      "INSERT INTO standing_deposit_merged_authors (project_id, github_id, checked_at) VALUES (?, 42, ?)",
      [w.projectId, new Date().toISOString()],
    );
    await w.review();
    expect(w.github.searches).toEqual([]);
    expect(w.cover()).toMatchObject({
      window_start: "2026-11-12T00:00:00.000Z",
    });
  } finally {
    w.close();
  }
});

test("standing deposit: no merged pull request on the project, or a failed search, is asked the fee", async () => {
  for (const merged of [0, null]) {
    const w = world();
    try {
      w.standingDeposit();
      w.github.mergedOnProject = merged;
      expect(await w.review()).toBe(FEE_NEEDED_REASON);
      expect(w.cover()).toBeNull();
      expect(w.github.labels).toEqual([FEE_NEEDED_LABEL]);
      expect(w.github.searches).toHaveLength(1);
      // Neither answer is remembered.
      expect(
        w.sqlite
          .query("SELECT COUNT(*) AS n FROM standing_deposit_merged_authors")
          .get(),
      ).toEqual({ n: 0 });
    } finally {
      w.close();
    }
  }
});

test("standing deposit: a project whose owner refused it asks the fee, and no search is spent", async () => {
  const w = world({ fee: { enabled: true, standingDeposits: false } });
  try {
    w.standingDeposit();
    expect(await w.review()).toBe(FEE_NEEDED_REASON);
    expect(w.cover()).toBeNull();
    expect(w.github.searches).toEqual([]);
  } finally {
    w.close();
  }
});

test("standing deposit: ten covered pull requests open at once, the eleventh is asked", async () => {
  const w = world();
  try {
    const id = w.standingDeposit();
    for (let number = 100; number < 110; number++)
      w.sqlite.run(
        `INSERT INTO standing_deposit_covers (repository_id, pull_number, deposit_id, github_id, project_id,
           installation_id, owner, repo, opened_at, window_start, covered_at, state, pr_open, updated_at)
         VALUES (?, ?, ?, 42, ?, 1, ?, ?, ?, ?, ?, 'watch', 1, ?)`,
        [
          w.repositoryId,
          number,
          id,
          w.projectId,
          w.owner,
          w.repo,
          OPENED_AFTER,
          OPENED_AFTER,
          OPENED_AFTER,
          OPENED_AFTER,
        ],
      );
    expect(await w.review()).toBe(FEE_NEEDED_REASON);
    expect(w.cover()).toBeNull();
  } finally {
    w.close();
  }
});

test("standing deposit: unpaid, withdrawn, expired or decided deposits cover nothing", async () => {
  const cases = [
    { paidAt: null },
    // The withdrawal was asked before this pull request opened.
    { withdrawRequestedAt: "2026-11-08T00:00:00.000Z" },
    // Paid 341 days before this pull request opened.
    { paidAt: new Date(Date.parse(OPENED_AFTER) - 341 * DAY).toISOString() },
    { outcome: "refund_due" },
  ];
  for (const options of cases) {
    const w = world();
    try {
      w.standingDeposit(options);
      expect(await w.review()).toBe(FEE_NEEDED_REASON);
      expect(w.cover()).toBeNull();
      expect(w.github.labels).toEqual([FEE_NEEDED_LABEL]);
    } finally {
      w.close();
    }
  }
});

test("standing deposit: an unpaid per pull request ask is taken back and covered", async () => {
  const w = world();
  try {
    expect(await w.review()).toBe(FEE_NEEDED_REASON);
    expect(w.item()).not.toBeNull();
    w.standingDeposit();
    expect(await w.review()).not.toBe(FEE_NEEDED_REASON);
    expect(w.reviewRow()).toMatchObject(COVERED);
    expect(w.item()).toBeNull();
    expect(w.gate()).toMatchObject({
      state: "released",
      reason: "standing-deposit",
      comment_id: 900,
    });
    expect(w.github.labels).toEqual([STANDING_DEPOSIT_COVERED_LABEL]);
    expect(w.feeComments()).toHaveLength(1);
    expect(w.feeComments()[0].body).toContain(
      "**Covered by your standing deposit**",
    );
    expect(w.cover()).toMatchObject({ state: "watch", pr_open: 1 });
  } finally {
    w.close();
  }
});

test("standing deposit: a paid per pull request fee is never released", async () => {
  const w = world();
  try {
    await w.review();
    w.pay(new Date().toISOString());
    w.standingDeposit();
    expect(await w.review()).not.toBe(FEE_NEEDED_REASON);
    expect(w.cover()).toBeNull();
    expect(w.github.searches).toEqual([]);
    expect(w.item()).toMatchObject({ outcome: null });
    expect(w.item()?.paid_at).not.toBeNull();
    expect(w.github.labels).not.toContain(STANDING_DEPOSIT_COVERED_LABEL);
  } finally {
    w.close();
  }
});

/** A covered pull request, closed without a merge on 20 November. */
async function coveredAndClosed(labelled: boolean) {
  const w = world();
  w.standingDeposit();
  await w.review();
  w.github.state = "closed";
  w.github.closedAt = "2026-11-20T00:00:00.000Z";
  if (labelled) w.github.labels.push(SUBMISSION_FEE_KEEP_LABEL);
  w.coverDue();
  return w;
}

test("standing deposit: a close and the keep label standing 48 hours keep the whole deposit", async () => {
  const w = await coveredAndClosed(true);
  try {
    const seen = new Date("2026-11-21T00:00:00.000Z");
    expect(await w.standing(seen)).toEqual({ read: 1, decided: 0 });
    expect(w.cover()).toMatchObject({
      state: "pending",
      pr_open: 0,
      strike_seen_at: seen.toISOString(),
      next_check_at: new Date(seen.getTime() + 48 * HOUR).toISOString(),
    });
    // Not read again before the grace period ends.
    expect(await w.standing(new Date(seen.getTime() + 47 * HOUR))).toEqual({
      read: 0,
      decided: 0,
    });
    expect(w.deposit()).toMatchObject({ outcome: null });
    expect(await w.standing(new Date(seen.getTime() + 48 * HOUR))).toEqual({
      read: 1,
      decided: 1,
    });
    expect(w.cover()).toMatchObject({ state: "strike", next_check_at: null });
    expect(w.deposit()).toEqual({
      outcome: "kept_due",
      outcome_reason: "strike",
      strike_repository_id: w.repositoryId,
      strike_pull_number: 5,
    });
    // A strike is final: never read again, and the outcome is written once.
    const reads = w.github.pullReads;
    expect(await w.standing(new Date(seen.getTime() + 30 * DAY))).toEqual({
      read: 0,
      decided: 0,
    });
    expect(w.github.pullReads).toBe(reads);
  } finally {
    w.close();
  }
});

test("standing deposit: the keep label removed before 48 hours clears the strike", async () => {
  const w = await coveredAndClosed(true);
  try {
    const seen = new Date("2026-11-21T00:00:00.000Z");
    await w.standing(seen);
    w.github.labels = w.github.labels.filter(
      (name) => name !== SUBMISSION_FEE_KEEP_LABEL,
    );
    await w.standing(new Date(seen.getTime() + 48 * HOUR));
    expect(w.cover()).toMatchObject({ state: "watch", strike_seen_at: null });
    expect(w.deposit()).toMatchObject({ outcome: null });
    // Past the window it is clear and can never cost the deposit.
    const after = new Date(WINDOW_ENDS + 2 * DAY);
    w.coverDue();
    await w.standing(after);
    expect(w.cover()).toMatchObject({ state: "clear", next_check_at: null });
    expect(w.deposit()).toMatchObject({ outcome: null });
  } finally {
    w.close();
  }
});

test("standing deposit: an ordinary close never strikes", async () => {
  const w = await coveredAndClosed(false);
  try {
    await w.standing(new Date("2026-11-21T00:00:00.000Z"));
    expect(w.cover()).toMatchObject({
      state: "watch",
      pr_open: 0,
      strike_seen_at: null,
    });
    // Read once just after the window ends, and found clear.
    const next = Date.parse(w.cover()?.next_check_at ?? "");
    expect(next).toBeLessThanOrEqual(WINDOW_ENDS + 60_000 + DAY);
    w.coverDue();
    await w.standing(new Date(WINDOW_ENDS + 60_000));
    expect(w.cover()).toMatchObject({ state: "clear" });
    expect(w.deposit()).toMatchObject({ outcome: null });
  } finally {
    w.close();
  }
});

test("standing deposit: a withdrawal is due back 21 days later, held while a cover is not clear", async () => {
  const w = await coveredAndClosed(true);
  try {
    const asked = "2026-11-21T00:00:00.000Z";
    w.sqlite.run(
      "UPDATE standing_deposits SET withdraw_requested_at = ? WHERE id = 'sd_localtest_1'",
      [asked],
    );
    const due = Date.parse(asked) + 21 * DAY;
    // Closed and labelled inside the window: seen, pending.
    const seen = new Date(due - 24 * HOUR);
    await w.standing(seen);
    expect(w.cover()).toMatchObject({ state: "pending" });
    // The wait has passed, but a pending cover holds the deposit.
    expect(await w.standing(new Date(due + HOUR))).toEqual({
      read: 0,
      decided: 0,
    });
    expect(w.deposit()).toMatchObject({ outcome: null });
    // The maintainer takes the label off: read again, past the window, clear.
    w.github.labels = [];
    expect(await w.standing(new Date(seen.getTime() + 48 * HOUR))).toEqual({
      read: 1,
      decided: 1,
    });
    expect(w.cover()).toMatchObject({ state: "clear" });
    expect(w.deposit()).toEqual({
      outcome: "refund_due",
      outcome_reason: "withdrawn",
      strike_repository_id: null,
      strike_pull_number: null,
    });
  } finally {
    w.close();
  }
});

test("standing deposit: a withdrawal with no cover is due back after 21 days, not before", async () => {
  const w = world();
  try {
    w.standingDeposit({ withdrawRequestedAt: "2026-11-21T00:00:00.000Z" });
    const due = Date.parse("2026-11-21T00:00:00.000Z") + 21 * DAY;
    await w.standing(new Date(due - HOUR));
    expect(w.deposit()).toMatchObject({ outcome: null });
    await w.standing(new Date(due));
    expect(w.deposit()).toMatchObject({
      outcome: "refund_due",
      outcome_reason: "withdrawn",
    });
  } finally {
    w.close();
  }
});

test("standing deposit: 340 days after payment it counts as withdrawn, reason expired", async () => {
  const w = world();
  try {
    w.standingDeposit();
    const due = Date.parse(STANDING_PAID_AT) + (340 + 21) * DAY;
    await w.standing(new Date(due - HOUR));
    expect(w.deposit()).toMatchObject({ outcome: null });
    await w.standing(new Date(due));
    expect(w.deposit()).toMatchObject({
      outcome: "refund_due",
      outcome_reason: "expired",
    });
  } finally {
    w.close();
  }
});

test("standing deposit: a failed GitHub read decides nothing", async () => {
  const w = await coveredAndClosed(true);
  try {
    w.sqlite.run(
      "UPDATE standing_deposits SET withdraw_requested_at = ? WHERE id = 'sd_localtest_1'",
      ["2026-11-11T00:00:00.000Z"],
    );
    w.github.pullDown = true;
    // Long past the withdrawal wait and the window, and long past 48 hours.
    const later = new Date(WINDOW_ENDS + 30 * DAY);
    for (const at of [later, new Date(later.getTime() + 3 * DAY)]) {
      expect(await w.standing(at)).toEqual({ read: 0, decided: 0 });
      expect(w.cover()).toMatchObject({
        state: "watch",
        strike_seen_at: null,
      });
      expect(w.deposit()).toMatchObject({ outcome: null });
    }
    // Read again once GitHub answers: the close was inside the window and
    // labelled, so the grace period starts now; nothing is sent back.
    w.github.pullDown = false;
    await w.standing(new Date(later.getTime() + 4 * DAY));
    expect(w.cover()).toMatchObject({ state: "pending" });
    expect(w.deposit()).toMatchObject({ outcome: null });
  } finally {
    w.close();
  }
});

test("standing deposit: a payment the Worker withdraws covers nothing new and decides nothing", async () => {
  const w = world();
  try {
    w.standingDeposit({ withdrawRequestedAt: "2026-11-11T00:00:00.000Z" });
    await w.review();
    expect(w.cover()).toMatchObject({ state: "watch" });
    // A reorganisation removed the deposit before finality.
    w.sqlite.run(
      "UPDATE standing_deposits SET paid_at = NULL, paid_network = NULL, paid_deposit_id = NULL WHERE id = 'sd_localtest_1'",
    );
    // The cover already written stays and is still read; nothing is decided.
    w.coverDue();
    expect(await w.standing(new Date(WINDOW_ENDS + 30 * DAY))).toEqual({
      read: 1,
      decided: 0,
    });
    expect(w.cover()).toMatchObject({ state: "clear" });
    expect(w.deposit()).toMatchObject({ outcome: null });
    // A new pull request is not covered: with no paid deposit it is asked.
    w.sqlite.run("DELETE FROM standing_deposit_covers");
    w.sqlite.run("DELETE FROM slopbot_fee_gates");
    w.sqlite.run("DELETE FROM slopbot_reviews");
    w.github.labels = [];
    expect(await w.review()).toBe(FEE_NEEDED_REASON);
    expect(w.cover()).toBeNull();
  } finally {
    w.close();
  }
});

test("standing deposit: active deposits beyond one batch never starve a due withdrawal or strike", async () => {
  const w = world();
  try {
    // Fill a full batch with earlier, healthy active deposits that are neither
    // withdrawn, expired nor struck.
    for (let i = 1; i <= STANDING_DEPOSIT_BATCH; i += 1) {
      const githubId = 1000 + i;
      w.sqlite.run(
        `INSERT INTO standing_deposits (id, github_id, round, item, slop_amount, slop_per_usd, asked_at,
           paid_at, paid_network, paid_deposit_id)
         VALUES (?, ?, 1, ?, '755000000000000000000', '75.4717', '2026-11-01T00:00:00.000Z',
           '2026-11-01T00:00:00.000Z', 'robinhood-standing', ?)`,
        [
          `sd_active_${String(i).padStart(4, "0")}`,
          githubId,
          standingDepositItem(githubId, 1),
          i,
        ],
      );
    }
    // Deposit #201: later paid_at, withdrawn with 21-day wait complete (no covers).
    const withdrawnId = "sd_due_withdrawn";
    w.sqlite.run(
      `INSERT INTO standing_deposits (id, github_id, round, item, slop_amount, slop_per_usd, asked_at,
         paid_at, paid_network, paid_deposit_id, withdraw_requested_at)
       VALUES (?, 9001, 1, ?, '755000000000000000000', '75.4717', '2026-11-05T00:00:00.000Z',
         '2026-11-05T00:00:00.000Z', 'robinhood-standing', 9001, '2026-11-06T00:00:00.000Z')`,
      [withdrawnId, standingDepositItem(9001, 1)],
    );
    // Deposit #202: later paid_at, with a confirmed strike cover.
    const struckId = "sd_due_struck";
    w.sqlite.run(
      `INSERT INTO standing_deposits (id, github_id, round, item, slop_amount, slop_per_usd, asked_at,
         paid_at, paid_network, paid_deposit_id)
       VALUES (?, 9002, 1, ?, '755000000000000000000', '75.4717', '2026-11-05T00:00:00.000Z',
         '2026-11-05T00:00:00.000Z', 'robinhood-standing', 9002)`,
      [struckId, standingDepositItem(9002, 1)],
    );
    const repoId = 1332593244;
    w.sqlite.run(
      `INSERT INTO standing_deposit_covers (repository_id, pull_number, deposit_id, github_id, project_id,
         installation_id, owner, repo, opened_at, window_start, covered_at, state, pr_open, strike_seen_at,
         next_check_at, updated_at)
       VALUES (?, 99, ?, 9002, 'asi', 77, 'SlopDotCash', 'asi', '2026-11-06T00:00:00.000Z',
         '2026-11-06T00:00:00.000Z', '2026-11-06T00:00:00.000Z', 'strike', 0, '2026-11-08T00:00:00.000Z',
         NULL, '2026-11-10T00:00:00.000Z')`,
      [repoId, struckId],
    );
    const now = new Date("2026-11-27T00:00:00.000Z");
    expect(await w.standing(now)).toEqual({ read: 0, decided: 2 });
    expect(w.deposit(withdrawnId)).toEqual({
      outcome: "refund_due",
      outcome_reason: "withdrawn",
      strike_repository_id: null,
      strike_pull_number: null,
    });
    expect(w.deposit(struckId)).toEqual({
      outcome: "kept_due",
      outcome_reason: "strike",
      strike_repository_id: repoId,
      strike_pull_number: 99,
    });
  } finally {
    w.close();
  }
});
