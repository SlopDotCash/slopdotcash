// Owner decisions D6, D7 and D8: closure of a verified Slop-skill member, the
// published penalty table, and Slopbot-first appeal triage with moderator
// escalation. The real worker runs against the real migrations, a local
// synthetic GitHub server and a local synthetic model endpoint; nothing
// leaves this process.
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { readdirSync } from "node:fs";
import { handleNotificationsApi } from "../../backend/notifications/handler";
import {
  fetchProjectPenalties,
  fetchProjectPenaltyHistory,
  fetchProjectPenaltyState,
} from "../../scripts/value-ingestion";
import {
  assertLeaderboardSnapshot,
  createLeaderboardSnapshot,
  type LeaderboardSnapshot,
} from "../../src/lib/leaderboard";
import { parseNotificationsResponse } from "../../src/lib/notifications";
import {
  applyPointsSnapshot,
  emptyPointsJournal,
  pointMembers,
} from "../../src/lib/points";
import { createProjectView } from "../../src/lib/project-view";
import { findProject } from "../../src/lib/projects.mjs";
import { seedParticipationBan } from "../../tests/participation-ban.fixture";
import {
  AFTER_NOVEMBER,
  GENERATED_AT,
  PENALIZED_AUTHOR,
  penaltyScoreInput,
} from "../../tests/penalty-score-fixture";
import { enqueueReopen } from "../../tests/slopbot-reopen-fixture";
import { sqliteD1 } from "../../tests/sqlite-d1";
import {
  activityMailEligibility,
  dispatchActivityMail,
} from "../notify/activity";
import type { Category, Job } from "./contracts";
import worker from "./index";
import type { D1TransactionalDatabase } from "./persistence";
import { type ReviewEnv, reviewItem } from "./review";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

// Each harness stubs fetch. Resetting it after every test, and restoring only
// a harness's own stub, keeps a timed-out test from leaking its stub into the
// next harness.
const realFetch = globalThis.fetch;
afterEach(() => {
  setSystemTime();
  globalThis.fetch = realFetch;
});

const AUTHOR = 42;
const MAINTAINER = 43;
const OUTSIDER = 44;
const MODERATOR = 50;
const BODY = "Buy cheap followers today at our shop.";
/** When Slopbot closes the fixture pull request; GitHub's closedAt agrees. */
const CLOSED_AT = "2026-11-10T00:00:00.000Z";

type ModelReply = {
  category: Category;
  confidence: number;
  evidence?: string[];
  limitations?: string[];
  servedModel?: string;
  status?: number;
};

type Run = {
  inbox(actor: number, moderators?: string, path?: string): Promise<Response>;
  enableMail(): Promise<void>;
  mail(moderators?: string): Promise<string[]>;
  ban: () => void;
  review: () => Promise<string>;
  deliver: (job: Job) => Promise<string>;
  tick: () => Promise<Job[]>;
  model: (category: Category, confidence: number) => void;
  modelSequence: (replies: ModelReply[]) => void;
  modelInputs: { effort: string; item: string }[];
  onModelCall: (callback: (count: number) => void) => void;
  onReviewComment: (callback: () => void) => void;
  emptyComparison: (reportedFiles?: number) => void;
  nonemptyComparison: () => void;
  seedDuplicate: () => void;
  changeDuplicate: (
    change:
      | "closed"
      | "author"
      | "body"
      | "node"
      | "head"
      | "unavailable"
      | "kind",
  ) => void;
  consent: (value: boolean | null) => void;
  /** Appends a retired revision (owner decision D12: no review). */
  retire: () => void;
  /** GitHub's reported close time; null omits it from the close response. */
  closeTime: (value: string | null) => void;
  revokeOnConfirmation: () => void;
  repositoryConfig: (value: string | null, truncated?: boolean) => void;
  policyResponse: (status: number, body?: unknown) => void;
  closureEnabled: (value: boolean) => void;
  pauseNextReopen: () => { entered: Promise<void>; release: () => void };
  pauseNextClose: (options?: {
    loseResponse?: boolean;
    afterWrite?: () => void;
  }) => { entered: Promise<void>; release: () => void };
  beforeAppealResolution: (callback: () => void) => void;
  beforePenaltyInsert: (callback: () => Promise<void>) => void;
  currentState: () => string;
  closerEvidence: (available: boolean) => void;
  merged: (value: boolean) => void;
  pauseNextFindingLabel: (loseResponse?: boolean) => {
    entered: Promise<void>;
    release: () => void;
  };
  loseNextReopenResponse: () => void;
  failNextCommentUpdate: () => void;
  loseNextAppealCommentResponse: (accepted?: boolean) => void;
  rejectNextAppealComment: (status: number) => void;
  pauseNextAppealComment: () => { entered: Promise<void>; release: () => void };
  appealHistory: (
    mode: "normal" | "unavailable" | "copied",
    prefix?: number,
  ) => void;
  closeByMaintainer: () => void;
  reopen: (senderId?: number, occurredAt?: string) => Promise<Job>;
  head: (sha: string) => void;
  loseNextLabelDelete: () => void;
  maintainerPermission: (value: boolean | "unavailable") => void;
  writes: string[];
  comments: string[];
  labels: string[];
  sql: (q: string) => unknown;
  suspendInstallation: (value: boolean) => void;
  unregisterRepository: () => void;
  /** The worker's public HTTP routes, served in process. */
  feed: typeof fetch;
  job: (kind: string, extra: Record<string, unknown>) => Job;
};

async function closedItem(cb: (run: Run) => Promise<void>) {
  const { db, sqlite } = sqliteD1(
    readdirSync(new URL("../../migrations/", import.meta.url))
      .filter((p) => p.endsWith(".sql"))
      .sort(),
  );
  let beforeAppealResolution: (() => void) | null = null;
  let beforePenaltyInsert: (() => Promise<void>) | null = null;
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const statement = prepare(sql);
    if (sql.startsWith("UPDATE slopbot_appeals SET resolved_at")) {
      const wrapResolution = (inner: typeof statement): typeof statement => ({
        ...inner,
        bind: (...values) => wrapResolution(inner.bind(...values)),
        run: async () => {
          const callback = beforeAppealResolution;
          beforeAppealResolution = null;
          callback?.();
          return inner.run();
        },
      });
      return wrapResolution(statement);
    }
    if (!sql.startsWith("INSERT OR IGNORE INTO slopbot_penalties"))
      return statement;
    const wrap = (inner: typeof statement): typeof statement => ({
      ...inner,
      bind: (...values) => wrap(inner.bind(...values)),
      run: async () => {
        const callback = beforePenaltyInsert;
        beforePenaltyInsert = null;
        await callback?.();
        return inner.run();
      },
    });
    return wrap(statement);
  };
  const project = findProject("asi");
  if (!project) throw new Error("fixture project missing");
  const manifest = JSON.stringify({
    ...project,
    status: "active",
    slopbot: { automaticClosure: true },
  });
  const digest = createHash("sha256").update(manifest).digest("hex");
  const at = "2026-01-01T00:00:00.000Z";
  sqlite.run(
    "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,1,?,?,?,?)",
    [project.id, manifest, digest, "local regression fixture", at],
  );
  sqlite.run(
    "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES (?,?,1,?,?,?,?)",
    [project.id, "active", manifest, digest, at, at],
  );
  const [owner, repo] = new URL(project.repositories[0].githubUrl).pathname
    .slice(1)
    .split("/");
  sqlite.run(
    "INSERT INTO project_repositories(repository_key,project_id) VALUES (?,?)",
    [`${owner}/${repo}`.toLowerCase(), project.id],
  );
  // Installation age and review counts do not grant closure authority.
  sqlite.run(
    "INSERT INTO slopbot_installations(installation_id, account_id, account_login, account_type, created_at) VALUES (1,77,?,'Organization',?)",
    [owner, new Date().toISOString()],
  );
  const repositoryId = Number(project.authority.repositoryId);
  // The verified Slop-skill member (D6): a member record and the author's own
  // authenticated run, whose pull_request_opened event names this node ID.
  sqlite.run(
    "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES ('actor-42','42','author',?,0)",
    [at],
  );
  sqlite.run(
    `INSERT INTO trace_runs(id,client_run_id,github_user_id,github_login,project_id,repository,
      project_policy_revision,provider,model,client,client_version,state,created_at,create_idempotency_key)
     VALUES ('run-1','client-1','42','author',?,?,?,
      'surplus','claude-opus-5.5','claude-code','1.0.0','awaiting_trace',?,'idem-1')`,
    [project.id, `${owner}/${repo}`, "a".repeat(40), at],
  );
  sqlite.run(
    `INSERT INTO run_progress_events(id,run_id,github_user_id,kind,occurred_at,source,github_object_id,
      github_url,head_sha,created_at,idempotency_key)
     VALUES ('event-1','run-1','42','pull_request_opened',?,'agent','PR_local',NULL,NULL,?,'idem-event-1')`,
    [at, at],
  );

  const writes: string[] = [];
  const comments: string[] = [];
  const labels: string[] = [];
  let state = "open";
  let closedBy: number | null = null;
  let closedAt: string | null = null;
  // undefined: GitHub reports the current time; null: no close time.
  let githubCloseTime: string | null | undefined;
  let closerEvidence = true;
  let merged = false;
  let pauseClose: (() => Promise<void>) | null = null;
  let closeOptions: { loseResponse?: boolean; afterWrite?: () => void } = {};
  let head = "b".repeat(40);
  let loseLabelDelete = false;
  let maintainerPermission: boolean | "unavailable" = true;
  let pauseReopen: (() => Promise<void>) | null = null;
  let pauseFindingLabel: (() => Promise<void>) | null = null;
  let loseFindingLabelResponse = false;
  let loseReopenResponse = false;
  let failCommentUpdate = false;
  let appealResponse: "accepted" | "unknown" | null = null;
  let appealRejection: number | null = null;
  let pauseAppeal: (() => Promise<void>) | null = null;
  let appealHistoryMode = "normal";
  let historyPrefix = 0;
  let verdict: ModelReply = { category: "spam", confidence: 0.97 };
  let config: string | null = null;
  let configTruncated = false;
  let policyResponse: { status: number; body?: unknown } | null = null;
  let revokeOnConfirmation = false;
  let modelCalls = 0;
  let replies: ModelReply[] = [];
  const modelInputs: Run["modelInputs"] = [];
  let onModelCall: ((count: number) => void) | null = null;
  let onReviewComment: (() => void) | null = null;
  let emptyComparison = false;
  let reportedFiles = 1;
  let duplicate = false;
  let duplicateChange: Parameters<Run["changeDuplicate"]>[0] | null = null;
  const consent = (value: boolean | null) => {
    const row = sqlite
      .query("SELECT revision, manifest FROM projects WHERE id = ?")
      .get(project.id) as { revision: number; manifest: string };
    const current = JSON.parse(row.manifest);
    if (value === null) delete current.slopbot;
    else current.slopbot = { automaticClosure: value };
    // Fixture only: append the state that the actual self-service route
    // separately proves. Keep the production D1 revision triggers intact.
    const text = JSON.stringify(current);
    const sha = createHash("sha256").update(text).digest("hex");
    const at = new Date().toISOString();
    sqlite.transaction(() => {
      sqlite.run(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,?,?,?,?,?)",
        [
          project.id,
          row.revision + 1,
          text,
          sha,
          "Synthetic owner consent change",
          at,
        ],
      );
      sqlite.run(
        "UPDATE projects SET revision = ?, manifest = ?, manifest_sha256 = ?, updated_at = ? WHERE id = ?",
        [row.revision + 1, text, sha, at, project.id],
      );
    })();
  };
  const login = (id: number) =>
    ({
      [AUTHOR]: "author",
      [MAINTAINER]: "maintainer",
      [OUTSIDER]: "outsider",
      [MODERATOR]: "moderator",
    })[id];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const path = url.pathname;
      if (request.method !== "GET" && !path.endsWith("/access_tokens"))
        writes.push(`${request.method} ${path}`);
      if (path === "/v1/messages") {
        if (++modelCalls === 2 && revokeOnConfirmation) consent(false);
        const input = (await request.json()) as {
          model: string;
          output_config: { effort: string };
          messages: { content: { text: string }[] }[];
        };
        modelInputs.push({
          effort: input.output_config.effort,
          item: input.messages[0].content[1].text,
        });
        const reply = replies.shift() ?? verdict;
        onModelCall?.(modelCalls);
        if (reply.status !== undefined)
          return Response.json(
            { error: "synthetic provider failure" },
            { status: reply.status },
          );
        return Response.json({
          id: "msg_local",
          type: "message",
          role: "assistant",
          model: reply.servedModel ?? input.model,
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                category: reply.category,
                confidence: reply.confidence,
                rule_refs: [
                  { source: "universal", quote: "Buy cheap followers" },
                ],
                evidence: reply.evidence ?? [
                  reply.category === "empty"
                    ? "Comparison changed files: 0"
                    : reply.category === "duplicate" && duplicate
                      ? "Title, body and complete diff are byte-identical to this item."
                      : "Buy cheap followers",
                ],
                summary: "This pull request advertises a service.",
                limitations: reply.limitations ?? [],
                objective_defect: null,
              }),
            },
          ],
          usage: { input_tokens: 10, output_tokens: 10 },
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
      if (path.endsWith("/contents/.github/slopbot.json")) {
        if (policyResponse !== null) {
          const { status, body } = policyResponse;
          return body === undefined || typeof body === "string"
            ? new Response(body ?? null, { status })
            : Response.json(body, { status });
        }
        if (config === null) return new Response(null, { status: 404 });
        return Response.json({
          type: "file",
          size: configTruncated ? 20_000 : Buffer.byteLength(config),
          content: Buffer.from(
            configTruncated ? `${config}${" ".repeat(20_000)}` : config,
          ).toString("base64"),
          encoding: "base64",
        });
      }
      if (
        duplicate &&
        path.endsWith("/issues/4") &&
        duplicateChange === "unavailable"
      )
        return new Response(null, { status: 404 });
      if (
        (path.endsWith("/issues/5") ||
          (duplicate && path.endsWith("/issues/4"))) &&
        request.method === "GET"
      )
        return Response.json({
          node_id: path.endsWith("/issues/4")
            ? duplicateChange === "node"
              ? "PR_changed"
              : "PR_prior"
            : "PR_local",
          number: path.endsWith("/issues/4") ? 4 : 5,
          state: path.endsWith("/issues/4")
            ? duplicateChange === "closed"
              ? "closed"
              : "open"
            : state,
          closed_by:
            closerEvidence && closedBy !== null ? { id: closedBy } : null,
          title: "Followers",
          body:
            path.endsWith("/issues/4") && duplicateChange === "body"
              ? "Changed original content"
              : BODY,
          user: {
            login: "author",
            id:
              path.endsWith("/issues/4") && duplicateChange === "author"
                ? OUTSIDER
                : AUTHOR,
            type: "User",
          },
          assignees: [],
          labels: labels.map((name) => ({ name })),
          ...(path.endsWith("/issues/4") && duplicateChange === "kind"
            ? {}
            : { pull_request: {} }),
        });
      if (path.endsWith("/pulls/5") && request.method === "PATCH") {
        const next = ((await request.json()) as { state: string }).state;
        if (next === "open" && pauseReopen) {
          const pause = pauseReopen;
          pauseReopen = null;
          await pause();
        }
        if (next === "closed" && pauseClose) {
          const pause = pauseClose;
          pauseClose = null;
          await pause();
        }
        state = next;
        closedBy = next === "closed" ? 999 : null;
        // GitHub reports its own close time in the close response.
        closedAt =
          next === "closed"
            ? githubCloseTime === undefined
              ? new Date().toISOString()
              : githubCloseTime
            : null;
        if (next === "closed") {
          const options = closeOptions;
          closeOptions = {};
          options.afterWrite?.();
          if (options.loseResponse) return new Response(null, { status: 503 });
        }
        if (next === "open" && loseReopenResponse) {
          loseReopenResponse = false;
          return Response.json(
            { error: "synthetic lost response" },
            { status: 503 },
          );
        }
        return Response.json({ state, closed_at: closedAt });
      }
      if (path.endsWith("/pulls/5") || (duplicate && path.endsWith("/pulls/4")))
        return Response.json({
          draft: false,
          merged,
          head: {
            sha:
              path.endsWith("/pulls/4") && duplicateChange === "head"
                ? "d".repeat(40)
                : head,
          },
          base: {
            sha: "c".repeat(40),
            ref: "main",
            repo: { id: repositoryId },
          },
          additions: 1,
          deletions: 0,
          changed_files: reportedFiles,
        });
      if (path.endsWith("/branches/main"))
        return Response.json({ commit: { sha: "c".repeat(40) } });
      if (path.includes("/compare/"))
        return Response.json({
          base_commit: { sha: "c".repeat(40) },
          merge_base_commit: { sha: "c".repeat(40) },
          files:
            !emptyComparison &&
            (url.searchParams.get("page") === "1" ||
              !url.searchParams.has("page"))
              ? [
                  {
                    filename: "README.md",
                    status: "modified",
                    patch: `+${BODY}`,
                  },
                ]
              : [],
        });
      const user = path.match(/^\/user\/(\d+)$/u);
      if (user && login(Number(user[1])))
        return Response.json({
          login: login(Number(user[1])),
          id: Number(user[1]),
        });
      if (path.endsWith("/permission"))
        return maintainerPermission === "unavailable"
          ? new Response(null, { status: 503 })
          : Response.json({
              permission:
                path.includes("/maintainer/") && maintainerPermission
                  ? "write"
                  : "read",
            });
      if (path.endsWith("/issues/5/comments") && request.method === "GET") {
        if (appealHistoryMode === "unavailable")
          return new Response(null, { status: 503 });
        const history = [
          {
            id: 1,
            body: "/slopbot appeal This is my real project page, not an advert.",
            user: { id: AUTHOR, type: "User" },
          },
          ...Array.from({ length: historyPrefix }, (_, i) => ({
            id: 10000 + i,
            body: "Unrelated comment",
            user: { id: OUTSIDER, type: "User" },
          })),
          ...comments.map((body, i) => ({
            id: 901 + i,
            body,
            user: {
              id: appealHistoryMode === "copied" ? OUTSIDER : 999,
              type: "Bot",
            },
          })),
        ];
        const page = Number(url.searchParams.get("page") ?? 1);
        return Response.json(history.slice((page - 1) * 100, page * 100));
      }
      if (path.endsWith("/issues/5/comments")) {
        const body = ((await request.json()) as { body: string }).body;
        if (body.startsWith("<!-- slopbot:appeal:")) {
          if (appealRejection !== null) {
            const status = appealRejection;
            appealRejection = null;
            return new Response(null, { status });
          }
          if (pauseAppeal) {
            const pause = pauseAppeal;
            pauseAppeal = null;
            await pause();
          }
          if (appealResponse === "unknown") {
            appealResponse = null;
            return new Response(null, { status: 503 });
          }
          comments.push(body);
          if (appealResponse === "accepted") {
            appealResponse = null;
            return new Response(null, { status: 503 });
          }
        } else {
          onReviewComment?.();
          comments.push(body);
        }
        return Response.json({ id: 900 + comments.length }, { status: 201 });
      }
      if (/\/issues\/comments\/\d+$/u.test(path)) {
        if (failCommentUpdate) {
          failCommentUpdate = false;
          return new Response(null, { status: 502 });
        }
        comments.push(((await request.json()) as { body: string }).body);
        return Response.json({ id: Number(path.split("/").pop()) });
      }
      if (path.endsWith("/issues/5/labels")) {
        const body = (await request.json()) as { labels: string[] };
        if (pauseFindingLabel) {
          const pause = pauseFindingLabel;
          pauseFindingLabel = null;
          await pause();
        }
        for (const name of body.labels)
          if (!labels.includes(name)) labels.push(name);
        if (loseFindingLabelResponse) {
          loseFindingLabelResponse = false;
          return new Response(null, { status: 503 });
        }
        return Response.json(labels.map((name) => ({ name })));
      }
      const removed = path.match(/\/issues\/5\/labels\/(.+)$/u);
      if (removed && request.method === "DELETE") {
        const name = decodeURIComponent(removed[1]);
        const index = labels.indexOf(name);
        if (index !== -1) labels.splice(index, 1);
        if (loseLabelDelete) {
          loseLabelDelete = false;
          return new Response(null, { status: 503 });
        }
        return Response.json([], { status: index === -1 ? 404 : 200 });
      }
      return new Response(null, { status: 404 });
    },
  });
  const stub = ((
    url: Parameters<typeof fetch>[0],
    init: Parameters<typeof fetch>[1],
  ) => {
    const u = new URL(url instanceof Request ? url.url : String(url));
    // Every case stops its ephemeral server. A pooled connection can otherwise
    // reach a reused port after teardown, corrupting the next case's response.
    const headers = new Headers(init?.headers);
    headers.set("connection", "close");
    const localInit = { ...init, headers };
    if (u.origin === new URL(server.url).origin)
      return realFetch(url, localInit);
    if (u.hostname !== "api.github.com")
      throw new Error(`unexpected network request to ${u.hostname}`);
    return realFetch(new URL(u.pathname + u.search, server.url), localInit);
  }) as typeof fetch;
  globalThis.fetch = stub;
  const sent: Job[] = [];
  const env = {
    SLOPBOT_DB: db as unknown as D1TransactionalDatabase,
    SLOPBOT_WEBHOOK_SECRET: "local-synthetic-secret",
    SLOPBOT_APP_ID: "1",
    SLOPBOT_APP_PRIVATE_KEY: privateKey,
    SLOPBOT_APP_USER_ID: "999",
    SLOPBOT_CLOSURE_ENABLED: "true",
    PROJECT_MODERATOR_GITHUB_IDS: String(MODERATOR),
    SURPLUS_API_KEY: "local-synthetic-key",
    SURPLUS_BASE_URL: server.url.origin,
    SLOPBOT_QUEUE: { send: async (job: Job) => void sent.push(job) },
  };
  const base = {
    installationId: 1,
    repositoryId,
    owner,
    repo,
    itemKind: "pull_request" as const,
    number: 5,
  };
  type Worker = {
    scheduled(event: unknown, env: unknown): Promise<void>;
    queue(batch: unknown, env: unknown): Promise<void>;
  };
  const outcomes: string[] = [];
  const log = console.log;
  console.log = (line: string) => {
    try {
      outcomes.push(JSON.parse(line).outcome);
    } catch {
      log(line);
    }
  };
  const mailConfig = {
    inboxUrl: "https://slop.cash/inbox",
    recipients: {
      [String(MODERATOR)]: {
        email: "moderator@example.com",
        verifiedAt: at,
        evidenceReference: "local-fixture",
      },
    },
  };
  try {
    await cb({
      inbox: async (
        actor,
        moderators = String(MODERATOR),
        path = "/api/v1/notifications",
      ) => {
        const response = await handleNotificationsApi(
          new Request(`https://slop.cash${path}`),
          {
            db: db as never,
            sessionActor: async () => ({ githubId: String(actor) }),
            now: () => new Date(),
            moderatorGithubIds: new Set(moderators.split(",")),
          },
        );
        if (!response) throw new Error("Inbox route missing");
        return response;
      },
      enableMail: async () => {
        const eligibility = await activityMailEligibility(
          mailConfig,
          String(MODERATOR),
          new Date(),
        );
        if (!eligibility.available)
          throw new Error("Fixture email is unavailable");
        sqlite.run(
          "INSERT INTO notification_email_preferences(github_id,enabled,destination_version,updated_at) VALUES (?,1,?,?)",
          [
            String(MODERATOR),
            eligibility.destinationVersion,
            new Date().toISOString(),
          ],
        );
      },
      mail: async (moderators = String(MODERATOR)) => {
        const sent: string[] = [];
        await dispatchActivityMail({
          db,
          config: mailConfig,
          fromAddress: "notices@slop.cash",
          moderatorGithubIds: new Set(moderators.split(",")),
          now: () => new Date(),
          sendEmail: async (_from, to) => {
            sent.push(to);
          },
        });
        return sent;
      },
      currentState: () => state,
      closerEvidence: (available) => {
        closerEvidence = available;
      },
      merged: (value) => {
        merged = value;
      },
      beforePenaltyInsert: (callback) => {
        beforePenaltyInsert = callback;
      },
      pauseNextClose: (options = {}) => {
        let entered!: () => void;
        let release!: () => void;
        const arrival = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const resumed = new Promise<void>((resolve) => {
          release = resolve;
        });
        pauseClose = async () => {
          entered();
          await resumed;
        };
        closeOptions = options;
        return { entered: arrival, release };
      },
      head: (sha) => {
        head = sha;
      },
      loseNextLabelDelete: () => {
        loseLabelDelete = true;
      },
      maintainerPermission: (value) => {
        maintainerPermission = value;
      },
      reopen: async (
        senderId = MAINTAINER,
        occurredAt = new Date().toISOString(),
      ) => {
        state = "open";
        closedBy = null;
        const body = {
          kind: "human_reopen" as const,
          deliveryId: `webhook-reopen-${crypto.randomUUID()}`,
          ...base,
          senderId,
        };
        const response = await enqueueReopen(env as never, body, {
          node_id: "PR_local",
          updated_at: occurredAt,
          head: { sha: head },
        });
        expect(await response.text()).toBe("queued");
        return body;
      },
      closeByMaintainer: () => {
        state = "closed";
        closedBy = MAINTAINER;
      },
      loseNextReopenResponse: () => {
        loseReopenResponse = true;
      },
      failNextCommentUpdate: () => {
        failCommentUpdate = true;
      },
      rejectNextAppealComment: (status) => {
        appealRejection = status;
      },
      loseNextAppealCommentResponse: (accepted = true) => {
        appealResponse = accepted ? "accepted" : "unknown";
      },
      appealHistory: (mode, prefix = 0) => {
        appealHistoryMode = mode;
        historyPrefix = prefix;
      },
      pauseNextAppealComment: () => {
        let entered!: () => void;
        let release!: () => void;
        const arrival = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const resumed = new Promise<void>((resolve) => {
          release = resolve;
        });
        pauseAppeal = async () => {
          entered();
          await resumed;
        };
        return { entered: arrival, release };
      },
      pauseNextFindingLabel: (loseResponse = false) => {
        let entered!: () => void;
        let release!: () => void;
        const arrival = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const resumed = new Promise<void>((resolve) => {
          release = resolve;
        });
        pauseFindingLabel = async () => {
          entered();
          await resumed;
        };
        loseFindingLabelResponse = loseResponse;
        return { entered: arrival, release };
      },
      pauseNextReopen: () => {
        let entered!: () => void;
        let release!: () => void;
        const arrival = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const resumed = new Promise<void>((resolve) => {
          release = resolve;
        });
        pauseReopen = async () => {
          entered();
          await resumed;
        };
        return { entered: arrival, release };
      },
      writes,
      comments,
      labels,
      review: () =>
        reviewItem(env as unknown as ReviewEnv, {
          kind: "review",
          deliveryId: "close-review",
          ...base,
        }),
      job: (kind, extra) =>
        ({
          kind,
          deliveryId: `${kind}-${outcomes.length}`,
          ...base,
          ...extra,
        }) as Job,
      deliver: async (body) => {
        await (worker as unknown as Worker).queue(
          {
            messages: [
              {
                body,
                ack() {},
                retry() {
                  throw new Error("appeal job was retried");
                },
              },
            ],
          },
          env,
        );
        return outcomes.at(-1) ?? "";
      },
      tick: async () => {
        sent.length = 0;
        await (worker as unknown as Worker).scheduled({}, env);
        return [...sent];
      },
      model: (category, confidence) => {
        verdict = { category, confidence };
      },
      modelSequence: (sequence) => {
        replies = [...sequence];
      },
      modelInputs,
      onModelCall: (callback) => {
        onModelCall = callback;
      },
      onReviewComment: (callback) => {
        onReviewComment = callback;
      },
      emptyComparison: (reported = 0) => {
        emptyComparison = true;
        reportedFiles = reported;
      },
      nonemptyComparison: () => {
        emptyComparison = false;
        reportedFiles = 1;
      },
      seedDuplicate: () => {
        duplicate = true;
        const content = `Title: Followers\n\nBody:\n${BODY}\n\nDiff:\n--- README.md (modified)\n+${BODY}\n`;
        sqlite.run(
          `INSERT INTO slopbot_reviews
           (review_key,installation_id,repository_id,item_kind,item_number,item_node_id,
            author_id,revision,content_digest,policy_digest,status,created_at)
           VALUES ('prior-review',1,?,'pull_request',4,'PR_prior',?,? ,? ,?,'completed',?)`,
          [
            repositoryId,
            AUTHOR,
            head,
            createHash("sha256").update(content).digest("hex"),
            "a".repeat(64),
            at,
          ],
        );
      },
      changeDuplicate: (change) => {
        duplicateChange = change;
      },
      consent,
      retire: () => {
        const row = sqlite
          .query("SELECT revision, manifest FROM projects WHERE id = ?")
          .get(project.id) as { revision: number; manifest: string };
        const text = JSON.stringify({
          ...JSON.parse(row.manifest),
          status: "paused",
          listingTier: "retired",
        });
        const sha = createHash("sha256").update(text).digest("hex");
        const at = new Date().toISOString();
        sqlite.transaction(() => {
          sqlite.run(
            "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,?,?,?,?,?)",
            [
              project.id,
              row.revision + 1,
              text,
              sha,
              "Synthetic retirement",
              at,
            ],
          );
          sqlite.run(
            "UPDATE projects SET status = 'paused', revision = ?, manifest = ?, manifest_sha256 = ?, updated_at = ? WHERE id = ?",
            [row.revision + 1, text, sha, at, project.id],
          );
        })();
      },
      closeTime: (value) => {
        githubCloseTime = value;
      },
      revokeOnConfirmation: () => {
        revokeOnConfirmation = true;
      },
      repositoryConfig: (value, truncated = false) => {
        config = value;
        configTruncated = truncated;
      },
      policyResponse: (status, body) => {
        policyResponse = { status, body };
      },
      closureEnabled: (value) => {
        env.SLOPBOT_CLOSURE_ENABLED = String(value);
      },
      beforeAppealResolution: (callback) => {
        beforeAppealResolution = callback;
      },
      suspendInstallation: (value) =>
        sqlite.run(
          "UPDATE slopbot_installations SET suspended_at = ? WHERE installation_id = 1",
          [value ? new Date().toISOString() : null],
        ),
      unregisterRepository: () =>
        sqlite.run("DELETE FROM project_repositories"),
      ban: () =>
        seedParticipationBan(
          sqlite,
          { githubId: String(AUTHOR), githubLogin: "author" },
          { githubId: String(MODERATOR), githubLogin: "moderator" },
          new Date().toISOString(),
        ),
      sql: (q) => sqlite.query(q).all(),
      feed: ((url: Parameters<typeof fetch>[0]) =>
        worker.fetch(
          new Request(url instanceof Request ? url.url : String(url)),
          env as never,
        )) as typeof fetch,
    });
  } finally {
    console.log = log;
    if (globalThis.fetch === stub) globalThis.fetch = realFetch;
    server.stop(true);
    sqlite.close();
  }
}

const PENALTY =
  "SELECT category, debit_thirds, moderator_review, reversal FROM slopbot_penalties";
const APPEAL =
  "SELECT draft, escalation IS NOT NULL AS escalated, resolution, resolved_by FROM slopbot_appeals";
const day = 24 * 60 * 60 * 1000;

// Each real consent boundary owns its fixture and the unchanged test timeout.
for (const boundary of [
  "absent",
  "revoked",
  "during confirmation",
  "production off",
  "file off",
  "category off",
  "invalid file",
  "truncated file",
  "non-file",
  "unreadable file",
  "redirect",
  "empty success",
  "forbidden",
  "rate limited",
  "server failure",
  "malformed response",
]) {
  test(`project closure consent respects the ${boundary} boundary`, async () => {
    await closedItem(async (run) => {
      if (boundary === "absent") {
        run.consent(null);
        run.repositoryConfig(
          JSON.stringify({ version: 1, audience: "protection", closure: true }),
        );
      }
      if (boundary === "revoked") run.consent(false);
      if (boundary === "during confirmation") run.revokeOnConfirmation();
      if (boundary === "production off") run.closureEnabled(false);
      if (boundary === "file off")
        run.repositoryConfig(
          JSON.stringify({
            version: 1,
            audience: "protection",
            closure: false,
          }),
        );
      if (boundary === "category off")
        run.repositoryConfig(
          JSON.stringify({
            version: 1,
            audience: "protection",
            closure: true,
            categories: { spam: "off" },
          }),
        );
      if (boundary === "invalid file") run.repositoryConfig("invalid");
      if (boundary === "truncated file")
        run.repositoryConfig(
          JSON.stringify({ version: 1, audience: "protection", closure: true }),
          true,
        );
      if (boundary === "non-file") run.policyResponse(200, { type: "dir" });
      if (boundary === "unreadable file")
        run.policyResponse(200, {
          type: "file",
          size: 2_000_000,
          encoding: "none",
        });
      if (boundary === "redirect") run.policyResponse(302);
      if (boundary === "empty success") run.policyResponse(204);
      if (boundary === "forbidden") run.policyResponse(403);
      if (boundary === "rate limited") run.policyResponse(429);
      if (boundary === "server failure") run.policyResponse(503);
      if (boundary === "malformed response")
        run.policyResponse(200, "not JSON");
      if (
        [
          "forbidden",
          "rate limited",
          "server failure",
          "malformed response",
        ].includes(boundary)
      )
        await expect(run.review()).rejects.toThrow();
      else expect(await run.review(), boundary).not.toBe("closed (spam)");
      expect(run.writes.some((path) => path.startsWith("PATCH "))).toBe(false);
      expect(run.sql(PENALTY)).toEqual([]);
    });
  });
}

test("fresh project consent and confirmation permit closure without a repository file", async () => {
  // No file, no completed-review quota and a new installation: explicit
  // consent plus independent confirmation can reach the existing close path.
  await closedItem(async (run) => {
    expect(await run.review()).toBe("closed (spam)");
    expect(run.sql(PENALTY)).toHaveLength(1);
  });
});

for (const category of ["empty", "duplicate"] as const) {
  test(`${category} prefilter closure requires recorded medium and high model reviews`, async () => {
    await closedItem(async (run) => {
      if (category === "empty")
        run.emptyComparison(7); // Stale PR metadata is not the source count.
      else run.seedDuplicate();
      run.model(category, 0.97);
      expect(await run.review()).toBe(`closed (${category})`);
      expect(
        run.sql("SELECT call_kind, outcome FROM slopbot_costs ORDER BY id"),
      ).toEqual([
        { call_kind: "triage", outcome: "ok" },
        { call_kind: "confirm", outcome: "ok" },
      ]);
      expect(run.modelInputs.map((input) => input.effort)).toEqual([
        "medium",
        "high",
      ]);
      // Missing provider receipts stay unknown; two real call records are
      // still required and no model body ID becomes a billing receipt.
      expect(
        run.sql(
          "SELECT provider_cost_micro_usd, provider_request_id FROM slopbot_costs ORDER BY id",
        ),
      ).toEqual([
        { provider_cost_micro_usd: null, provider_request_id: null },
        { provider_cost_micro_usd: null, provider_request_id: null },
      ]);
      if (category === "empty") {
        expect(
          run.modelInputs.every((input) =>
            input.item.includes("Diff:\nComparison changed files: 0\n"),
          ),
        ).toBe(true);
      } else {
        expect(run.modelInputs[0].item).toContain('"nodeId":"PR_prior"');
        expect(run.modelInputs[0].item).toContain(
          '"authorId":42,"currentAuthorId":42',
        );
        expect(run.modelInputs[0].item).toBe(run.modelInputs[1].item);
        expect(
          run.sql(
            "SELECT content_digest FROM slopbot_reviews WHERE item_node_id = 'PR_local'",
          ),
        ).toEqual([
          {
            content_digest: createHash("sha256")
              .update(
                `Title: Followers\n\nBody:\n${BODY}\n\nDiff:\n--- README.md (modified)\n+${BODY}\n`,
              )
              .digest("hex"),
          },
        ]);
      }
    });
  });

  for (const guard of ["global off", "consent off", "label mode"] as const) {
    test(`${category} prefilter stays free when ${guard} prevents closure`, async () => {
      await closedItem(async (run) => {
        if (category === "empty") run.emptyComparison();
        else run.seedDuplicate();
        if (guard === "global off") run.closureEnabled(false);
        if (guard === "consent off") run.consent(false);
        if (guard === "label mode")
          run.repositoryConfig(
            JSON.stringify({
              version: 1,
              audience: "protection",
              closure: true,
              categories: { [category]: "label" },
            }),
          );
        expect(await run.review()).not.toStartWith("closed");
        expect(run.modelInputs).toEqual([]);
        expect(run.sql("SELECT call_kind FROM slopbot_costs")).toEqual([]);
        expect(run.writes.some((path) => path.startsWith("PATCH "))).toBe(
          false,
        );
      });
    });
  }
}

for (const change of [
  "closed",
  "author",
  "body",
  "node",
  "head",
  "unavailable",
  "kind",
] as const) {
  test(`duplicate confirmation refuses an original that becomes ${change}`, async () => {
    await closedItem(async (run) => {
      run.seedDuplicate();
      run.model("duplicate", 0.97);
      run.onModelCall((count) => {
        if (count === 2) run.changeDuplicate(change);
      });
      expect(await run.review()).not.toStartWith("closed");
      expect(run.modelInputs).toHaveLength(2);
      expect(run.writes.some((path) => path.startsWith("PATCH "))).toBe(false);
      expect(run.sql(PENALTY)).toEqual([]);
    });
  });
}

test("duplicate original is rechecked again after publication immediately before close", async () => {
  await closedItem(async (run) => {
    run.seedDuplicate();
    run.model("duplicate", 0.97);
    const barrier = run.pauseNextFindingLabel();
    const review = run.review();
    await barrier.entered;
    run.changeDuplicate("closed");
    barrier.release();
    expect(await review).not.toStartWith("closed");
    expect(run.writes).not.toContain("PATCH /repos/SlopDotCash/asi/pulls/5");
    expect(run.currentState()).toBe("open");
    expect(run.sql(PENALTY)).toEqual([]);
  });
});

for (const closureEnabled of [true, false]) {
  test(`a changed original after the review comment prevents a duplicate label (closure ${closureEnabled})`, async () => {
    await closedItem(async (run) => {
      run.seedDuplicate();
      run.closureEnabled(closureEnabled);
      run.model("duplicate", 0.97);
      run.onReviewComment(() => run.changeDuplicate("closed"));
      expect(await run.review()).toBe(
        "related original or review source changed before label",
      );
      expect(run.writes).not.toContain(
        "POST /repos/SlopDotCash/asi/issues/5/labels",
      );
      expect(run.writes).not.toContain("PATCH /repos/SlopDotCash/asi/pulls/5");
      expect(run.currentState()).toBe("open");
      expect(run.sql(PENALTY)).toEqual([]);
    });
  });
}

test("the queue retries a duplicate review whose original changed after its comment", async () => {
  await closedItem(async (run) => {
    run.seedDuplicate();
    run.closureEnabled(false);
    run.onReviewComment(() => run.changeDuplicate("closed"));
    const job = run.job("review", {});
    // The stale duplicate comment is published, then the label is refused.
    // The changed source must not acknowledge this unfinished review.
    await expect(run.deliver(job)).rejects.toThrow("appeal job was retried");
    expect(run.comments).toHaveLength(1);
    const staleComment = run.comments.at(-1);
    expect(run.labels).toEqual([]);
    // The retry reviews the current source and replaces the stale finding.
    expect(await run.deliver(job)).toBe("labeled (spam)");
    expect(run.comments.at(-1)).not.toBe(staleComment);
    expect(run.labels).toEqual(["slopbot: spam"]);
  });
});

test("a model's duplicate claim cannot close without a verified same-author open original", async () => {
  await closedItem(async (run) => {
    run.model("duplicate", 0.97);
    expect(await run.review()).not.toStartWith("closed");
    expect(run.modelInputs).toHaveLength(1);
    expect(run.writes.some((path) => path.startsWith("PATCH "))).toBe(false);
  });
});

for (const result of [
  "none",
  "disagree",
  "uncertain",
  "ungrounded",
  "limited",
  "failed triage",
  "unverified model",
  "failed confirmation",
] as const) {
  test(`empty prefilter cannot force closure after ${result} model review`, async () => {
    await closedItem(async (run) => {
      run.emptyComparison();
      const valid = { category: "empty" as const, confidence: 0.97 };
      run.model("empty", 0.97);
      if (result === "none")
        run.modelSequence([{ category: "none", confidence: 0.97 }]);
      if (result === "disagree")
        run.modelSequence([valid, { category: "spam", confidence: 0.97 }]);
      if (result === "uncertain")
        run.modelSequence([{ ...valid, confidence: 0.85 }]);
      if (result === "ungrounded")
        run.modelSequence([
          { ...valid, evidence: ["not present in the item"] },
        ]);
      if (result === "limited")
        run.modelSequence([
          {
            ...valid,
            limitations: ["Source interpretation remains unresolved."],
          },
          valid,
        ]);
      if (result === "failed triage")
        run.modelSequence([
          { ...valid, status: 503 },
          { ...valid, status: 503 },
        ]);
      if (result === "unverified model")
        run.modelSequence([
          { ...valid, servedModel: "unknown" },
          { ...valid, servedModel: "unknown" },
        ]);
      if (result === "failed confirmation")
        run.modelSequence([
          valid,
          { ...valid, status: 503 },
          { ...valid, status: 503 },
        ]);
      if (result === "failed triage" || result === "unverified model")
        await expect(run.review()).rejects.toThrow(
          "every model route step failed",
        );
      else {
        const outcome = await run.review();
        expect(outcome).not.toStartWith("closed");
        if (result === "none")
          expect(outcome).toBe("review published (no finding)");
      }
      expect(run.writes.some((path) => path.startsWith("PATCH "))).toBe(false);
      expect(run.currentState()).toBe("open");
      expect(run.sql(PENALTY)).toEqual([]);
      expect(run.modelInputs.length).toBeGreaterThan(0);
      if (result === "failed triage" || result === "unverified model") {
        expect(
          run.sql("SELECT outcome FROM slopbot_costs ORDER BY id"),
        ).toEqual([{ outcome: "failed" }, { outcome: "failed" }]);
      }
    });
  });
}

test("model triage replaces the prefilter category before category mode and penalty decisions", async () => {
  await closedItem(async (run) => {
    run.emptyComparison();
    run.repositoryConfig(
      JSON.stringify({
        version: 1,
        audience: "protection",
        closure: true,
        categories: { empty: "close", spam: "label" },
      }),
    );
    run.model("spam", 0.97);
    expect(await run.review()).toBe("labeled (spam)");
    expect(run.modelInputs).toHaveLength(1);
    expect(run.currentState()).toBe("open");
    expect(run.sql(PENALTY)).toEqual([]);
  });
});

for (const mode of ["label", "close"] as const) {
  for (const source of ["prefilter", "ordinary"] as const) {
    test(`a limited ${source} verdict stays held with one call in ${mode} mode`, async () => {
      await closedItem(async (run) => {
        if (source === "prefilter") run.emptyComparison();
        run.repositoryConfig(
          JSON.stringify({
            version: 1,
            audience: "protection",
            closure: true,
            categories: { empty: "close", spam: mode },
          }),
        );
        run.modelSequence([
          {
            category: "spam",
            confidence: 0.97,
            limitations: ["The source interpretation remains unresolved."],
          },
        ]);
        expect(await run.review()).toStartWith("held for maintainer");
        expect(run.modelInputs).toHaveLength(1);
        expect(run.sql("SELECT call_kind FROM slopbot_costs")).toEqual([
          { call_kind: "triage" },
        ]);
        expect(run.writes).not.toContain(
          "POST /repos/SlopDotCash/asi/issues/5/labels",
        );
        expect(run.currentState()).toBe("open");
        expect(run.sql(PENALTY)).toEqual([]);
      });
    });
  }

  for (const finding of [
    {
      name: "low confidence",
      confidence: 0.85,
      evidence: ["Buy cheap followers"],
      limitations: [],
    },
    {
      name: "bad grounding",
      confidence: 0.97,
      evidence: ["not in the submitted item"],
      limitations: [],
    },
    {
      name: "low confidence and limitations",
      confidence: 0.85,
      evidence: ["Buy cheap followers"],
      limitations: ["Unresolved check."],
    },
    {
      name: "bad grounding, low confidence and limitations",
      confidence: 0.85,
      evidence: ["not in the submitted item"],
      limitations: ["Unresolved check."],
    },
  ]) {
    test(`${finding.name} stays held with one call in ${mode} mode`, async () => {
      await closedItem(async (run) => {
        run.repositoryConfig(
          JSON.stringify({
            version: 1,
            audience: "protection",
            closure: true,
            categories: { spam: mode },
          }),
        );
        run.modelSequence([{ category: "spam", ...finding }]);
        expect(await run.review()).toStartWith("held for maintainer");
        expect(run.modelInputs).toHaveLength(1);
        expect(run.writes).not.toContain(
          "POST /repos/SlopDotCash/asi/issues/5/labels",
        );
        expect(run.currentState()).toBe("open");
        expect(run.sql(PENALTY)).toEqual([]);
      });
    });
  }
}

for (const change of ["head", "comparison", "consent"] as const) {
  test(`empty prefilter confirmation rechecks changed ${change}`, async () => {
    await closedItem(async (run) => {
      run.emptyComparison();
      run.model("empty", 0.97);
      run.onModelCall((count) => {
        if (count !== 2) return;
        if (change === "head") run.head("d".repeat(40));
        if (change === "comparison") run.nonemptyComparison();
        if (change === "consent") run.consent(false);
      });
      expect(await run.review()).not.toStartWith("closed");
      expect(run.modelInputs).toHaveLength(2);
      expect(run.writes.some((path) => path.startsWith("PATCH "))).toBe(false);
      expect(run.sql(PENALTY)).toEqual([]);
    });
  });
}

test("ordinary review keeps its nonzero comparison input and two-call close path", async () => {
  await closedItem(async (run) => {
    expect(await run.review()).toBe("closed (spam)");
    expect(run.modelInputs).toHaveLength(2);
    expect(run.modelInputs[0].item).toBe(
      `<item kind="pull_request">\nTitle: Followers\n\nBody:\n${BODY}\n\nDiff:\n--- README.md (modified)\n+${BODY}\n\n</item>`,
    );
  });
});

test("a spam close debits 3 thirds once; an accepted uphold draft reopens the item and reverses the debit once", async () => {
  await closedItem(async (run) => {
    expect(await run.review()).toBe("closed (spam)");
    expect(run.writes).toContain("PATCH /repos/SlopDotCash/asi/pulls/5");
    expect(run.sql(PENALTY)).toEqual([
      {
        category: "spam",
        debit_thirds: 3,
        moderator_review: 0,
        reversal: null,
      },
    ]);
    // A replayed review records nothing new.
    expect(await run.review()).toBe(
      "already reviewed at this revision and policy",
    );
    expect(run.sql(PENALTY)).toHaveLength(1);

    // The independent appeal review no longer finds spam.
    run.model("none", 0.95);
    expect(await run.deliver(run.job("appeal", { senderId: AUTHOR }))).toBe(
      "appeal drafted (uphold)",
    );
    expect(run.sql(APPEAL)).toEqual([
      { draft: "uphold", escalated: 0, resolution: null, resolved_by: null },
    ]);
    // Another person cannot answer the draft.
    expect(
      await run.deliver(
        run.job("appeal_command", { command: "accept", senderId: OUTSIDER }),
      ),
    ).toBe("only the appellant or a maintainer can answer the draft");

    expect(
      await run.deliver(
        run.job("appeal_command", { command: "accept", senderId: AUTHOR }),
      ),
    ).toBe("appeal upheld by the appellant");
    expect(
      run.writes.filter((w) => w === "PATCH /repos/SlopDotCash/asi/pulls/5"),
    ).toHaveLength(2);
    expect(run.labels).not.toContain("slopbot: spam");
    expect(run.sql(PENALTY)).toEqual([
      {
        category: "spam",
        debit_thirds: 3,
        moderator_review: 0,
        reversal: "appeal_upheld",
      },
    ]);

    // Replays, a later maintainer reopen and a re-review change nothing.
    const writes = run.writes.length;
    expect(
      await run.deliver(
        run.job("appeal_command", { command: "accept", senderId: AUTHOR }),
      ),
    ).toBe("appeal already resolved");
    expect(await run.deliver(await run.reopen())).toBe("human_reopen");
    // A maintainer closes the item again. A later command from anyone does
    // not resume the completed decision or reopen the item.
    run.closeByMaintainer();
    expect(
      await run.deliver(
        run.job("appeal_command", { command: "accept", senderId: OUTSIDER }),
      ),
    ).toBe("appeal already resolved");
    expect(run.writes).toHaveLength(writes);
    expect(run.sql(PENALTY)).toEqual([
      {
        category: "spam",
        debit_thirds: 3,
        moderator_review: 0,
        reversal: "appeal_upheld",
      },
    ]);
    expect(run.sql(APPEAL)).toEqual([
      {
        draft: "uphold",
        escalated: 0,
        resolution: "upheld",
        resolved_by: "appellant",
      },
    ]);
  });
});

test("an upheld appeal reopens only Slopbot's own close, never a later maintainer close", async () => {
  await closedItem(async (run) => {
    expect(await run.review()).toBe("closed (spam)");
    // A maintainer restores the item, then closes it as their own decision.
    expect(await run.deliver(await run.reopen())).toBe("human_reopen");
    run.closeByMaintainer();
    run.model("none", 0.95);
    expect(await run.deliver(run.job("appeal", { senderId: AUTHOR }))).toBe(
      "appeal drafted (uphold)",
    );
    expect(
      await run.deliver(
        run.job("appeal_command", { command: "accept", senderId: AUTHOR }),
      ),
    ).toBe("appeal upheld by the appellant");
    expect(run.currentState()).toBe("closed");
    expect(
      run.writes.filter((w) => w === "PATCH /repos/SlopDotCash/asi/pulls/5"),
    ).toHaveLength(1);
    expect(run.sql(PENALTY)).toEqual([
      {
        category: "spam",
        debit_thirds: 3,
        moderator_review: 0,
        reversal: "maintainer_reopen",
      },
    ]);
  });
  // Missing closer evidence keeps the upheld decision pending, not reopened.
  await closedItem(async (run) => {
    expect(await run.review()).toBe("closed (spam)");
    run.model("none", 0.95);
    await run.deliver(run.job("appeal", { senderId: AUTHOR }));
    run.closerEvidence(false);
    await expect(
      run.deliver(
        run.job("appeal_command", { command: "accept", senderId: AUTHOR }),
      ),
    ).rejects.toThrow("appeal job was retried");
    expect(run.currentState()).toBe("closed");
    run.closerEvidence(true);
    expect(
      await run.deliver(
        run.job("appeal_command", { command: "accept", senderId: AUTHOR }),
      ),
    ).toBe("appeal already resolved");
    expect(run.currentState()).toBe("open");
    expect(run.sql(PENALTY)).toEqual([
      {
        category: "spam",
        debit_thirds: 3,
        moderator_review: 0,
        reversal: "appeal_upheld",
      },
    ]);
  });
});

test("a scam close escalates to a moderator; only a moderator decides, and a denial keeps the debit", async () => {
  await closedItem(async (run) => {
    run.model("scam", 0.97);
    expect(await run.review()).toBe("closed (scam)");
    expect(run.sql(PENALTY)).toEqual([
      {
        category: "scam",
        debit_thirds: 24,
        moderator_review: 1,
        reversal: null,
      },
    ]);
    expect(run.labels).toContain("slopbot: moderator");

    expect(await run.deliver(run.job("appeal", { senderId: AUTHOR }))).toBe(
      "appeal escalated: the finding is a confirmed-malicious result",
    );
    expect(
      await run.deliver(
        run.job("appeal_command", { command: "accept", senderId: AUTHOR }),
      ),
    ).toBe("a Slop moderator decides this appeal");
    expect(
      await run.deliver(
        run.job("appeal_command", { command: "uphold", senderId: MAINTAINER }),
      ),
    ).toBe("only a Slop moderator can decide an escalated appeal");
    expect(
      await run.deliver(
        run.job("appeal_command", { command: "deny", senderId: MODERATOR }),
      ),
    ).toBe("appeal denied by the moderator");
    expect(run.sql(PENALTY)).toEqual([
      {
        category: "scam",
        debit_thirds: 24,
        moderator_review: 1,
        reversal: null,
      },
    ]);
    // A maintainer reopen still wins, removes the finding label, and reverses the debit once.
    expect(await run.deliver(await run.reopen())).toBe("human_reopen");
    expect(run.labels).not.toContain("slopbot: scam");
    expect(run.sql(PENALTY)).toEqual([
      {
        category: "scam",
        debit_thirds: 24,
        moderator_review: 1,
        reversal: "maintainer_reopen",
      },
    ]);
  });
});

test("a maintainer reopen upholds an open appeal and removes the finding label, but does not post an upheld comment after a maintainer-denied appeal", async () => {
  await closedItem(async (run) => {
    expect(await run.review()).toBe("closed (spam)");
    expect(run.labels).toContain("slopbot: spam");
    expect(await run.deliver(run.job("appeal", { senderId: AUTHOR }))).toBe(
      "appeal drafted (deny)",
    );
    expect(await run.deliver(await run.reopen())).toBe("human_reopen");
    expect(run.labels).not.toContain("slopbot: spam");
    expect(run.sql(APPEAL)).toEqual([
      {
        draft: "deny",
        escalated: 0,
        resolution: "upheld",
        resolved_by: "maintainer",
      },
    ]);
  });
  await closedItem(async (run) => {
    expect(await run.review()).toBe("closed (spam)");
    expect(await run.deliver(run.job("appeal", { senderId: AUTHOR }))).toBe(
      "appeal drafted (deny)",
    );
    expect(
      await run.deliver(
        run.job("appeal_command", { command: "accept", senderId: MAINTAINER }),
      ),
    ).toBe("appeal denied by the maintainer");
    const commentsBeforeReopen = run.comments.length;
    expect(await run.deliver(await run.reopen())).toBe("human_reopen");
    expect(run.labels).not.toContain("slopbot: spam");
    expect(run.sql(PENALTY)).toEqual([
      {
        category: "spam",
        debit_thirds: 3,
        moderator_review: 0,
        reversal: "maintainer_reopen",
      },
    ]);
    expect(run.sql(APPEAL)).toEqual([
      {
        draft: "deny",
        escalated: 0,
        resolution: "denied",
        resolved_by: "maintainer",
      },
    ]);
    expect(run.comments).toHaveLength(commentsBeforeReopen);
  });
});

test("a rejected draft escalates, and an appeal unresolved for 7 days escalates once", async () => {
  await closedItem(async (run) => {
    expect(await run.review()).toBe("closed (spam)");
    // The appeal review confirms the finding: the draft denies the appeal.
    expect(await run.deliver(run.job("appeal", { senderId: AUTHOR }))).toBe(
      "appeal drafted (deny)",
    );
    const start = Date.now();
    setSystemTime(new Date(start + 6 * day));
    expect(await run.tick()).toEqual([]);
    setSystemTime(new Date(start + 7 * day + 60_000));
    const due = await run.tick();
    expect(due.map((j) => j.kind)).toEqual(["appeal_due"]);
    expect(await run.deliver(due[0])).toBe(
      "appeal escalated: the appeal is unresolved 7 days after it opened",
    );
    expect(await run.tick()).toEqual([]);
    expect(run.labels).toContain("slopbot: moderator");
    expect(
      await run.deliver(
        run.job("appeal_command", { command: "reject", senderId: MAINTAINER }),
      ),
    ).toBe("a Slop moderator decides this appeal");
  });
  await closedItem(async (run) => {
    expect(await run.review()).toBe("closed (spam)");
    await run.deliver(run.job("appeal", { senderId: AUTHOR }));
    expect(
      await run.deliver(
        run.job("appeal_command", { command: "reject", senderId: MAINTAINER }),
      ),
    ).toBe("appeal escalated: the maintainer rejected the draft");
    expect(run.sql(APPEAL)).toEqual([
      { draft: "deny", escalated: 1, resolution: null, resolved_by: null },
    ]);
  });
});

test("a due appeal is not consumed while the installation is suspended", async () => {
  await closedItem(async (run) => {
    expect(await run.review()).toBe("closed (spam)");
    expect(await run.deliver(run.job("appeal", { senderId: AUTHOR }))).toBe(
      "appeal drafted (deny)",
    );
    const start = Date.now();
    run.suspendInstallation(true);
    setSystemTime(new Date(start + 7 * day + 60_000));
    const due = await run.tick();
    expect(due.map((j) => j.kind)).toEqual(["appeal_due"]);
    // The session gate fails gracefully, so nothing may be consumed: the
    // appeal stays unescalated and the dispatcher queues it again a day
    // later, exactly as it re-queues a lost message.
    expect(await run.deliver(due[0])).toBe("installation removed or suspended");
    expect(run.sql(APPEAL)).toEqual([
      { draft: "deny", escalated: 0, resolution: null, resolved_by: null },
    ]);
    expect(run.labels).not.toContain("slopbot: moderator");
    run.suspendInstallation(false);
    setSystemTime(new Date(start + 8 * day + 60_000));
    const retried = await run.tick();
    expect(retried.map((j) => j.kind)).toEqual(["appeal_due"]);
    expect(await run.deliver(retried[0])).toBe(
      "appeal escalated: the appeal is unresolved 7 days after it opened",
    );
    expect(run.sql(APPEAL)).toEqual([
      { draft: "deny", escalated: 1, resolution: null, resolved_by: null },
    ]);
    expect(run.labels).toContain("slopbot: moderator");
    expect(await run.tick()).toEqual([]);
  });
});

test("a due appeal still escalates when the repository leaves the registry", async () => {
  await closedItem(async (run) => {
    expect(await run.review()).toBe("closed (spam)");
    expect(await run.deliver(run.job("appeal", { senderId: AUTHOR }))).toBe(
      "appeal drafted (deny)",
    );
    const start = Date.now();
    run.unregisterRepository();
    setSystemTime(new Date(start + 7 * day + 60_000));
    const due = await run.tick();
    expect(due.map((j) => j.kind)).toEqual(["appeal_due"]);
    // The refusal is permanent, so waiting cannot clear it: the escalation
    // is recorded with its database-only moderator notices, and only the
    // publication (which needs the session) is skipped — the appeal is not
    // re-queued daily forever.
    expect(await run.deliver(due[0])).toBe(
      "appeal escalated; repository is not registered in the Slop registry",
    );
    expect(run.sql(APPEAL)).toEqual([
      { draft: "deny", escalated: 1, resolution: null, resolved_by: null },
    ]);
    expect(
      run.sql(
        "SELECT COUNT(*) AS n FROM notifications WHERE kind = 'slopbot_appeal_review'",
      ),
    ).toEqual([{ n: 1 }]);
    expect(run.labels).not.toContain("slopbot: moderator");
    expect(await run.tick()).toEqual([]);
  });
});

test("concurrent moderator decisions cannot deny an appeal after its uphold starts reopening the PR", async () => {
  await closedItem(async (run) => {
    run.model("scam", 0.97);
    await run.review();
    await run.deliver(run.job("appeal", { senderId: AUTHOR }));
    const pause = run.pauseNextReopen();
    const uphold = run.deliver(
      run.job("appeal_command", { command: "uphold", senderId: MODERATOR }),
    );
    await pause.entered;
    try {
      await run.deliver(
        run.job("appeal_command", { command: "deny", senderId: MODERATOR }),
      );
    } finally {
      pause.release();
      await uphold;
    }
    expect(run.sql("SELECT resolution FROM slopbot_appeals")).toEqual([
      { resolution: "upheld" },
    ]);
    expect(run.sql("SELECT reversal FROM slopbot_penalties")).toEqual([
      { reversal: "appeal_upheld" },
    ]);
    expect(
      run.comments.some((comment) => comment.includes("**Appeal denied**")),
    ).toBe(false);
  });
});

test("a retry after an uncertain reopen completes the recorded appeal decision", async () => {
  await closedItem(async (run) => {
    run.model("scam", 0.97);
    await run.review();
    await run.deliver(run.job("appeal", { senderId: AUTHOR }));
    run.loseNextReopenResponse();
    await expect(
      run.deliver(
        run.job("appeal_command", { command: "uphold", senderId: MODERATOR }),
      ),
    ).rejects.toThrow("appeal job was retried");
    expect(run.sql("SELECT resolution FROM slopbot_appeals")).toEqual([
      { resolution: "upheld" },
    ]);
    expect(run.sql("SELECT reversal FROM slopbot_penalties")).toEqual([
      { reversal: null },
    ]);
    await run.deliver(
      run.job("appeal_command", { command: "deny", senderId: MODERATOR }),
    );
    expect(run.sql("SELECT resolution FROM slopbot_appeals")).toEqual([
      { resolution: "upheld" },
    ]);
    expect(run.sql("SELECT reversal FROM slopbot_penalties")).toEqual([
      { reversal: "appeal_upheld" },
    ]);
    expect(run.labels).not.toContain("slopbot: scam");
  });
});

// PRD section 7: the real worker records the debit, its public penalty feed
// carries it to the real score producer, and the published score applies it
// once, only to its project and UTC month, never below zero. An upheld appeal
// removes it from the next published score.
test("a recorded debit reaches the published score once and an upheld appeal restores it", async () => {
  setSystemTime(new Date(GENERATED_AT));
  await closedItem(async (run) => {
    let journal = emptyPointsJournal(GENERATED_AT);
    const publish = async () => {
      const snapshot = createLeaderboardSnapshot({
        ...penaltyScoreInput(await fetchProjectPenalties("asi", run.feed)),
        penaltyHistory: await fetchProjectPenaltyHistory("asi", run.feed),
      });
      journal = applyPointsSnapshot(
        journal,
        snapshot,
        createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
        GENERATED_AT,
      );
      return snapshot;
    };
    const member = () =>
      pointMembers(journal, "2026-11").find(
        (row) => row.actor.id === PENALIZED_AUTHOR.id,
      );
    const adjustments = () =>
      journal.revisions.filter((r) => r.award.category === "slopbot-penalty");
    const standing = (snapshot: LeaderboardSnapshot) => {
      const leader = snapshot.leaders.find(
        (entry) => entry.actor.id === PENALIZED_AUTHOR.id,
      );
      const month = (cycleId: string) =>
        createProjectView(snapshot, "asi", cycleId).leaders.find(
          (entry) => entry.actor.id === PENALIZED_AUTHOR.id,
        );
      return {
        scoreThirds: leader?.scoreThirds,
        penaltyThirds: leader?.penaltyThirds ?? 0,
        october: month("2026-10")?.scoreThirds,
        november: month("2026-11")?.scoreThirds,
        novemberPenalty: month("2026-11")?.penaltyThirds,
      };
    };

    // The historical hold preserves October; November uses the value policy.
    expect(standing(await publish())).toEqual({
      scoreThirds: 4,
      penaltyThirds: 0,
      october: 3,
      november: 1,
      novemberPenalty: 0,
    });
    expect(member()).toMatchObject({
      total: 40,
      monthly: 10,
      firstContributionAt: "2026-10-29T12:00:00.000Z",
      projects: 1,
    });
    const original = structuredClone(journal.revisions);
    const originalBadges = [...member()!.badges];

    setSystemTime(new Date(CLOSED_AT));
    expect(await run.review()).toBe("closed (spam)");
    setSystemTime(new Date(GENERATED_AT));
    const debited = await publish();
    expect(
      debited.penalties?.map(({ id, category, debitThirds, occurredAt }) => ({
        id,
        category,
        debitThirds,
        occurredAt,
      })),
    ).toEqual([
      {
        id: "PR_local:penalty",
        category: "spam",
        debitThirds: 3,
        occurredAt: CLOSED_AT,
      },
    ]);
    // The 3-third debit stops at November's 1 third; October is untouched.
    const penalized = {
      scoreThirds: 3,
      penaltyThirds: 1,
      october: 3,
      november: 0,
      novemberPenalty: 1,
    };
    expect(standing(debited)).toEqual(penalized);
    expect(member()).toMatchObject({
      total: 30,
      monthly: 0,
      firstContributionAt: "2026-10-29T12:00:00.000Z",
      projects: 1,
    });
    expect(journal.revisions.slice(0, original.length)).toEqual(original);
    expect(member()!.badges).toEqual(originalBadges);
    expect(adjustments()).toMatchObject([
      {
        award: { amount: -10 },
        decision: { delta: -10 },
        penalty: { debit: 30, reversedAt: null },
      },
    ]);

    // A replayed review and a second publication apply the debit once.
    await run.review();
    expect(standing(await publish())).toEqual(penalized);
    expect(adjustments()).toHaveLength(1);

    run.model("none", 0.95);
    expect(await run.deliver(run.job("appeal", { senderId: AUTHOR }))).toBe(
      "appeal drafted (uphold)",
    );
    expect(
      await run.deliver(
        run.job("appeal_command", { command: "accept", senderId: AUTHOR }),
      ),
    ).toBe("appeal upheld by the appellant");
    const restored = await publish();
    expect(restored.penalties).toEqual([]);
    expect(standing(restored)).toEqual({
      scoreThirds: 4,
      penaltyThirds: 0,
      october: 3,
      november: 1,
      novemberPenalty: 0,
    });
    expect(member()).toMatchObject({ total: 40, monthly: 10 });
    expect(adjustments()).toMatchObject([
      { award: { amount: -10 } },
      {
        award: { amount: 0 },
        decision: { delta: 10 },
        penalty: { reversal: "appeal_upheld" },
      },
    ]);
    await publish();
    expect(adjustments()).toHaveLength(2);
  });
});

// PRD section 7: a debit is recorded once and reduces only that UTC month.
test("penalty collection preserves active debits during the history route rollout", async () => {
  setSystemTime(new Date(CLOSED_AT));
  await closedItem(async (run) => {
    await run.review();
    const legacy = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      url.searchParams.delete("history");
      return run.feed(url);
    }) as typeof fetch;
    const state = await fetchProjectPenaltyState("asi", legacy);
    expect(state.history).toBeNull();
    expect(state.penalties).toMatchObject([
      { itemNodeId: "PR_local", debitThirds: 3 },
    ]);
    expect(
      (await fetchProjectPenaltyState("asi", run.feed)).history,
    ).toMatchObject([{ itemNodeId: "PR_local", reversedAt: null }]);
  });
});

test("an old Points debit survives missing snapshots and reverses only on retained evidence", async () => {
  setSystemTime(new Date(CLOSED_AT));
  await closedItem(async (run) => {
    await run.review();
    setSystemTime(new Date(GENERATED_AT));
    const first = createLeaderboardSnapshot({
      ...penaltyScoreInput(await fetchProjectPenalties("asi", run.feed)),
      penaltyHistory: await fetchProjectPenaltyHistory("asi", run.feed),
    });
    const zeroInput = penaltyScoreInput(
      await fetchProjectPenalties("asi", run.feed),
    );
    zeroInput.mergedPullRequests = zeroInput.mergedPullRequests.filter(
      (r) => r.id !== "PR_november",
    );
    zeroInput.mergedPullRequestOutcomes =
      zeroInput.mergedPullRequestOutcomes.filter((r) => r.id !== "PR_november");
    zeroInput.detailEligibleMergedPullRequestIds =
      zeroInput.detailEligibleMergedPullRequestIds.filter(
        (id) => id !== "PR_november",
      );
    zeroInput.source.counts.mergedPullRequests = 2;
    zeroInput.source.counts.detailedMergedPullRequests = 2;
    const zero = createLeaderboardSnapshot(zeroInput);
    let journal = applyPointsSnapshot(
      emptyPointsJournal(GENERATED_AT),
      zero,
      "0".repeat(64),
      GENERATED_AT,
    );
    expect(journal.revisions.filter((r) => r.penalty)).toMatchObject([
      { award: { amount: 0 }, decision: { delta: 0 } },
    ]);
    const zeroCount = journal.revisions.length;
    journal = applyPointsSnapshot(journal, zero, "0".repeat(64), GENERATED_AT);
    expect(journal.revisions).toHaveLength(zeroCount);
    journal = applyPointsSnapshot(journal, first, "a".repeat(64), GENERATED_AT);
    const member = () =>
      pointMembers(journal, "2026-11").find(
        (row) => row.actor.id === PENALIZED_AUTHOR.id,
      );
    expect(member()).toMatchObject({ total: 30, monthly: 0 });
    const original = structuredClone(journal.revisions);
    const later = "2026-12-20T00:00:00.000Z";
    setSystemTime(new Date(later));
    const input = penaltyScoreInput([], later);
    input.mergedPullRequests = [];
    input.mergedPullRequestOutcomes = [];
    input.closedUnmergedPullRequests = [];
    input.detailEligibleMergedPullRequestIds = [];
    input.source.counts.mergedPullRequests = 0;
    input.source.counts.detailedMergedPullRequests = 0;
    // A paused project's repositories leave GitHub collection, but its
    // retained reversal history must still reach the Points journal.
    const empty = createLeaderboardSnapshot(input);
    const absent: LeaderboardSnapshot = {
      ...empty,
      repository: null,
      repositories: [],
      source: { ...empty.source, repositoryId: null, repositories: [] },
    };
    assertLeaderboardSnapshot(absent);
    // Neither an old-format snapshot nor a complete empty active feed is a reversal.
    journal = applyPointsSnapshot(journal, absent, "b".repeat(64), later);
    journal = applyPointsSnapshot(
      journal,
      { ...absent, penaltyHistory: [] },
      "c".repeat(64),
      later,
    );
    expect(journal.revisions).toEqual(original);
    expect(member()).toMatchObject({ total: 30, monthly: 0 });

    expect(await run.deliver(await run.reopen())).toBe("human_reopen");
    const history = await fetchProjectPenaltyHistory("asi", run.feed);
    expect(await fetchProjectPenalties("asi", run.feed)).toEqual([]);
    expect(history).toMatchObject([
      {
        itemNodeId: "PR_local",
        reversedAt: later,
        reversal: "maintainer_reopen",
      },
    ]);
    expect(history[0]).not.toHaveProperty("review_key");
    const restored = { ...absent, penaltyHistory: history };
    assertLeaderboardSnapshot(restored);
    journal = applyPointsSnapshot(journal, restored, "e".repeat(64), later);
    expect(member()).toMatchObject({ total: 40, monthly: 10 });
    expect(journal.revisions.slice(0, original.length)).toEqual(original);
    expect(journal.revisions.at(-1)).toMatchObject({
      award: { amount: 0, occurredAt: CLOSED_AT },
      decision: { delta: 10, effectiveAt: later },
    });
    const count = journal.revisions.length;
    journal = applyPointsSnapshot(journal, restored, "f".repeat(64), later);
    expect(journal.revisions).toHaveLength(count);
  });
});

// PRD section 7: a debit is recorded once and reduces only that UTC month.
// The author reopens the closed pull request and it closes again in December;
// GitHub's closedAt moves, but the published debit keeps Slopbot's recorded
// November month.
test("a reopen and later close keeps the debit in its recorded month", async () => {
  setSystemTime(new Date(CLOSED_AT));
  await closedItem(async (run) => {
    expect(await run.review()).toBe("closed (spam)");
    expect(
      run.sql("SELECT period, recorded_at FROM slopbot_penalties"),
    ).toEqual([{ period: "2026-11", recorded_at: CLOSED_AT }]);

    const publishedAt = AFTER_NOVEMBER;
    setSystemTime(new Date(publishedAt));
    const input = penaltyScoreInput(
      await fetchProjectPenalties("asi", run.feed),
      publishedAt,
    );
    const [closed] = input.closedUnmergedPullRequests ?? [];
    if (!closed) throw new Error("fixture closed pull request missing");
    const reclosedAt = "2026-12-01T00:00:00.000Z";
    input.closedUnmergedPullRequests = [
      { ...closed, updatedAt: reclosedAt, closedAt: reclosedAt },
    ];
    const snapshot = createLeaderboardSnapshot(input);

    expect(snapshot.penalties?.map((penalty) => penalty.occurredAt)).toEqual([
      CLOSED_AT,
    ]);
    const month = (cycleId: string) =>
      createProjectView(snapshot, "asi", cycleId).leaders.find(
        (entry) => entry.actor.id === PENALIZED_AUTHOR.id,
      );
    // November's 1-third merge minimum absorbs the debit; December has none.
    expect(month("2026-11")).toMatchObject({
      scoreThirds: 0,
      penaltyThirds: 1,
    });
    expect(month("2026-12")).toBeUndefined();
  });
});

// The recorded month is authoritative: a feed row whose period disagrees with
// its recorded time fails the snapshot, and a debit recorded before the
// scoring window never lands on a later GitHub close inside it.

// Exercise the actual worker event, Inbox route and existing email dispatcher.
// Local transport acceptance is distinct from provider delivery.
for (const state of ["active", "revoked", "resolved", "opted-out"] as const) {
  test(`an escalated appeal reaches the moderator Inbox and respects ${state} delivery state`, async () => {
    await closedItem(async (run) => {
      run.model("scam", 0.97);
      expect(await run.review()).toBe("closed (scam)");
      // Mail starts after the close, so only the appeal notice is mailed here;
      // the scam account-review notice has its own test below.
      await run.enableMail();
      await run.deliver(run.job("appeal", { senderId: AUTHOR }));
      await run.deliver(run.job("appeal", { senderId: AUTHOR }));
      const first = parseNotificationsResponse(
        await (await run.inbox(MODERATOR)).json(),
      );
      const appeals = first.notifications.filter(
        (n) => n.kind === "slopbot_appeal_review",
      );
      expect(appeals).toHaveLength(1);
      expect(first.notifications.map((n) => n.kind).sort()).toEqual([
        "slopbot_appeal_review",
        "slopbot_scam_review",
      ]);
      const path = appeals[0].actionPath;
      const target = await run.inbox(MODERATOR, String(MODERATOR), path);
      expect(target.status).toBe(302);
      expect(target.headers.get("location")).toMatch(
        /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/5$/u,
      );
      expect((await run.inbox(OUTSIDER, String(MODERATOR), path)).status).toBe(
        403,
      );
      expect(
        parseNotificationsResponse(await (await run.inbox(OUTSIDER)).json())
          .notifications,
      ).toHaveLength(0);
      if (state === "revoked") {
        expect(
          parseNotificationsResponse(
            await (await run.inbox(MODERATOR, "")).json(),
          ),
        ).toMatchObject({ notifications: [], unread: 0 });
        expect((await run.inbox(MODERATOR, "", path)).status).toBe(403);
      }
      if (state === "resolved") {
        await run.deliver(
          run.job("appeal_command", { command: "deny", senderId: MODERATOR }),
        );
        expect(
          parseNotificationsResponse(
            await (await run.inbox(MODERATOR)).json(),
          ).notifications.find((n) => n.eventKey === appeals[0].eventKey)?.kind,
        ).toBe("slopbot_appeal_resolved");
      }
      if (state === "opted-out")
        run.sql("UPDATE notification_email_preferences SET enabled=0");
      expect(
        await run.mail(state === "revoked" ? "" : String(MODERATOR)),
      ).toEqual(state === "active" ? ["moderator@example.com"] : []);
      expect(await run.mail()).toEqual([]);
      expect(
        run.sql("SELECT COUNT(*) AS total FROM activity_notification_outbox"),
      ).toEqual([{ total: 1 }]);
    });
  });
}

const SCAM_NOTICES =
  "SELECT event_key, recipient_github_id, kind, subject, detail, action_path FROM notifications WHERE kind = 'slopbot_scam_review'";

// Owner decision D4 (PRD section 11): a scam close asks each moderator, once,
// to review the author's account. The worker, Inbox route and mail dispatcher
// all run for real against the migrations.
test("a scam close writes one moderator account-review notice across replays", async () => {
  await closedItem(async (run) => {
    await run.enableMail();
    run.model("scam", 0.97);
    expect(await run.review()).toBe("closed (scam)");
    expect(await run.review()).toBe(
      "already reviewed at this revision and policy",
    );
    const notices = run.sql(SCAM_NOTICES) as Record<string, string>[];
    expect(notices).toEqual([
      {
        event_key: "slopbot-scam-review:PR_local",
        recipient_github_id: String(MODERATOR),
        kind: "slopbot_scam_review",
        subject: "asi",
        detail:
          "Review the account of @author after a scam closure on SlopDotCash/asi#5.",
        action_path:
          "/api/v1/notifications/scam-reviews/SlopDotCash/asi/pull/5",
      },
    ]);
    expect(run.labels).toContain("slopbot: moderator");

    const inbox = parseNotificationsResponse(
      await (await run.inbox(MODERATOR)).json(),
    );
    expect(inbox).toMatchObject({ unread: 1 });
    expect(inbox.notifications.map((n) => n.kind)).toEqual([
      "slopbot_scam_review",
    ]);
    const path = inbox.notifications[0].actionPath;
    const open = await run.inbox(MODERATOR, String(MODERATOR), path);
    expect(open.status).toBe(302);
    expect(open.headers.get("location")).toBe(
      "https://github.com/SlopDotCash/asi/pull/5",
    );
    // Moderator access is rechecked on every read: neither the author, an
    // outsider nor a former moderator sees or opens the notice.
    for (const actor of [AUTHOR, OUTSIDER])
      expect(
        parseNotificationsResponse(await (await run.inbox(actor)).json()),
      ).toMatchObject({ notifications: [], unread: 0 });
    expect((await run.inbox(OUTSIDER, String(MODERATOR), path)).status).toBe(
      403,
    );
    expect(
      parseNotificationsResponse(await (await run.inbox(MODERATOR, "")).json()),
    ).toMatchObject({ notifications: [], unread: 0 });
    expect((await run.inbox(MODERATOR, "", path)).status).toBe(403);
    // A moderator cannot open a target that no notice of theirs stores.
    expect(
      (
        await run.inbox(
          MODERATOR,
          String(MODERATOR),
          "/api/v1/notifications/scam-reviews/SlopDotCash/asi/pull/6",
        )
      ).status,
    ).toBe(404);

    // Optional activity mail rechecks moderator access before sending.
    expect(await run.mail("")).toEqual([]);
    run.sql(
      "UPDATE activity_notification_outbox SET state='queued' WHERE event_key='slopbot-scam-review:PR_local'",
    );
    expect(await run.mail()).toEqual(["moderator@example.com"]);
    expect(await run.mail()).toEqual([]);
    expect(
      run.sql(
        "SELECT COUNT(*) AS total FROM activity_notification_outbox WHERE event_key='slopbot-scam-review:PR_local'",
      ),
    ).toEqual([{ total: 1 }]);
    expect(run.sql(SCAM_NOTICES)).toHaveLength(1);
  });
});

test("a reversed scam penalty suppresses the pending account-review mail", async () => {
  await closedItem(async (run) => {
    await run.enableMail();
    run.model("scam", 0.97);
    expect(await run.review()).toBe("closed (scam)");
    expect(await run.deliver(await run.reopen())).toBe("human_reopen");
    expect(await run.mail()).toEqual([]);
    // The Inbox history is permanent; the notice is not deleted or rewritten.
    expect(run.sql(SCAM_NOTICES)).toHaveLength(1);
  });
});

for (const category of ["spam", "duplicate"] as const)
  test(`a ${category} close writes no moderator account-review notice`, async () => {
    await closedItem(async (run) => {
      if (category === "duplicate") run.seedDuplicate();
      run.model(category, 0.97);
      expect(await run.review()).toBe(`closed (${category})`);
      expect(run.sql(SCAM_NOTICES)).toEqual([]);
      expect(run.labels).not.toContain("slopbot: moderator");
    });
  });

test("a scam notice write failure is recovered after GitHub has closed the item", async () => {
  await closedItem(async (run) => {
    run.model("scam", 0.97);
    run.sql(`CREATE TEMP TRIGGER fail_scam_notice BEFORE INSERT ON notifications
      WHEN NEW.kind = 'slopbot_scam_review'
      BEGIN SELECT RAISE(FAIL, 'simulated notice write failure'); END`);
    await expect(run.review()).rejects.toThrow(
      "simulated notice write failure",
    );
    expect(run.sql(SCAM_NOTICES)).toHaveLength(0);
    expect(run.labels).toContain("slopbot: moderator");
    const githubWrites = [...run.writes];
    run.sql("DROP TRIGGER fail_scam_notice");
    await run.review();
    expect(run.sql(SCAM_NOTICES)).toHaveLength(1);
    await run.review();
    expect(run.sql(SCAM_NOTICES)).toHaveLength(1);
    expect(run.writes).toEqual(githubWrites);
  });
});

test("an appeal reaches triage after a confirmed close whose comment update failed", async () => {
  await closedItem(async (run) => {
    // GitHub confirms the close and the debit is recorded, then the close
    // comment update fails, so the run fails after the close.
    run.failNextCommentUpdate();
    await expect(run.review()).rejects.toThrow("returned 502");
    expect(run.currentState()).toBe("closed");
    expect(run.sql(PENALTY)).toEqual([
      {
        category: "spam",
        debit_thirds: 3,
        moderator_review: 0,
        reversal: null,
      },
    ]);
    // The queue retry finds a closed item and has no review to repeat.
    expect(await run.review()).toBe("item is not open");

    // The author's appeal still reaches Slopbot triage, and the accepted
    // uphold reopens the item and reverses the debit once.
    run.model("none", 0.95);
    expect(await run.deliver(run.job("appeal", { senderId: AUTHOR }))).toBe(
      "appeal drafted (uphold)",
    );
    expect(
      await run.deliver(
        run.job("appeal_command", { command: "accept", senderId: AUTHOR }),
      ),
    ).toBe("appeal upheld by the appellant");
    expect(run.currentState()).toBe("open");
    expect(run.labels).not.toContain("slopbot: spam");
    expect(run.sql(PENALTY)).toEqual([
      {
        category: "spam",
        debit_thirds: 3,
        moderator_review: 0,
        reversal: "appeal_upheld",
      },
    ]);
  });
});

for (const stage of ["draft", "escalation", "resolution"] as const) {
  test(`a lost ${stage} comment response reconciles once through the actual queue`, async () => {
    await closedItem(async (run) => {
      await run.review();
      const appealJob = run.job("appeal", { senderId: AUTHOR });
      if (stage !== "draft") await run.deliver(appealJob);
      const job =
        stage === "draft"
          ? appealJob
          : run.job("appeal_command", {
              senderId: AUTHOR,
              command: stage === "escalation" ? "reject" : "accept",
            });
      run.loseNextAppealCommentResponse();
      await expect(run.deliver(job)).rejects.toThrow("appeal job was retried");
      const body = run.comments.at(-1) ?? "";
      expect(body).toStartWith("<!-- slopbot:appeal:");
      expect(
        run.sql(
          `SELECT id FROM slopbot_actions WHERE review_key LIKE '%:${stage}' AND action='comment'`,
        ),
      ).toEqual([]);
      // Reconciliation must inspect all pages, and cannot trust a copied marker.
      run.appealHistory("copied", 150);
      await expect(run.deliver(job)).rejects.toThrow("appeal job was retried");
      expect(run.comments.filter((c) => c === body)).toHaveLength(1);
      run.appealHistory("normal", 150);
      await run.deliver(job);
      await run.deliver(job);
      expect(run.comments.filter((c) => c === body)).toHaveLength(1);
      expect(
        run.sql(
          `SELECT id FROM slopbot_actions WHERE review_key LIKE '%:${stage}' AND action='comment'`,
        ),
      ).toHaveLength(1);
      expect(
        run.sql(
          `SELECT confirmed_comment_id FROM slopbot_appeal_publications WHERE publication_key LIKE '%:${stage}'`,
        ),
      ).toEqual([{ confirmed_comment_id: 900 + run.comments.length }]);
    });
  });
}

test("concurrent deliveries serialize the same appeal stage", async () => {
  await closedItem(async (run) => {
    await run.review();
    const job = run.job("appeal", { senderId: AUTHOR });
    const pause = run.pauseNextAppealComment();
    const first = run.deliver(job);
    await pause.entered;
    try {
      await expect(run.deliver(job)).rejects.toThrow("appeal job was retried");
    } finally {
      pause.release();
      await first;
    }
    await run.deliver(job);
    expect(
      run.comments.filter((c) => c.startsWith("<!-- slopbot:appeal:")),
    ).toHaveLength(1);
    expect(
      run.sql(
        "SELECT id FROM slopbot_actions WHERE review_key LIKE '%:draft' AND action='comment'",
      ),
    ).toHaveLength(1);
  });
});

test("an expired publisher cannot complete or cause its successor to repeat the pending POST", async () => {
  await closedItem(async (run) => {
    await run.review();
    const job = run.job("appeal", { senderId: AUTHOR });
    const pause = run.pauseNextAppealComment();
    const first = run.deliver(job).then(
      () => "unexpected success",
      (error: unknown) => String(error),
    );
    await pause.entered;
    setSystemTime(new Date(Date.now() + 21 * 60 * 1000));
    try {
      await expect(run.deliver(job)).rejects.toThrow("appeal job was retried");
      expect(
        run.sql(
          "SELECT id FROM slopbot_actions WHERE review_key LIKE '%:draft' AND action='comment'",
        ),
      ).toEqual([]);
    } finally {
      pause.release();
      expect(await first).toContain("appeal job was retried");
    }
    await run.deliver(job);
    expect(
      run.comments.filter((c) => c.startsWith("<!-- slopbot:appeal:")),
    ).toHaveLength(1);
    expect(
      run.sql(
        "SELECT id FROM slopbot_actions WHERE review_key LIKE '%:draft' AND action='comment'",
      ),
    ).toHaveLength(1);
  });
});

test("missing evidence after an uncertain POST stays pending without a duplicate or false success", async () => {
  await closedItem(async (run) => {
    await run.review();
    const job = run.job("appeal", { senderId: AUTHOR });
    run.loseNextAppealCommentResponse(false);
    await expect(run.deliver(job)).rejects.toThrow("appeal job was retried");
    const writes = run.writes.filter((s) =>
      s.endsWith("/issues/5/comments"),
    ).length;
    await expect(run.deliver(job)).rejects.toThrow("appeal job was retried");
    expect(
      run.writes.filter((s) => s.endsWith("/issues/5/comments")),
    ).toHaveLength(writes);
    expect(
      run.sql(
        "SELECT post_started_at IS NOT NULL AS pending, confirmed_comment_id FROM slopbot_appeal_publications",
      ),
    ).toEqual([{ pending: 1, confirmed_comment_id: null }]);
    expect(
      run.sql(
        "SELECT id FROM slopbot_actions WHERE review_key LIKE '%:draft' AND action='comment'",
      ),
    ).toEqual([]);
  });
});

test("unavailable comment history refuses a first POST but remains retryable", async () => {
  await closedItem(async (run) => {
    await run.review();
    const job = run.job("appeal", { senderId: AUTHOR });
    run.appealHistory("unavailable");
    await expect(run.deliver(job)).rejects.toThrow("appeal job was retried");
    expect(
      run.comments.filter((c) => c.startsWith("<!-- slopbot:appeal:")),
    ).toHaveLength(0);
    run.appealHistory("normal");
    await run.deliver(job);
    expect(
      run.comments.filter((c) => c.startsWith("<!-- slopbot:appeal:")),
    ).toHaveLength(1);
  });
});

for (const status of [401, 403, 404, 410, 422, 429]) {
  test(`a confirmed GitHub ${status} rejection allows an authorized appeal retry`, async () => {
    await closedItem(async (run) => {
      await run.review();
      const job = run.job("appeal", { senderId: AUTHOR });
      run.rejectNextAppealComment(status);
      await expect(run.deliver(job)).rejects.toThrow("appeal job was retried");
      expect(
        run.comments.filter((c) => c.startsWith("<!-- slopbot:appeal:")),
      ).toHaveLength(0);
      await run.deliver(job);
      expect(
        run.comments.filter((c) => c.startsWith("<!-- slopbot:appeal:")),
      ).toHaveLength(1);
    });
  });
}

test("replaying an old reopen cannot remove a newer head finding", async () => {
  setSystemTime(new Date(CLOSED_AT));
  await closedItem(async (run) => {
    expect(await run.review()).toBe("closed (spam)");
    const reopened = await run.reopen();
    expect(await run.deliver(reopened)).toBe("human_reopen");
    run.head("d".repeat(40));
    setSystemTime(new Date(Date.parse(CLOSED_AT) + 2000));
    expect(await run.review()).toBe("labeled (spam)");
    const before = run.writes.length;
    // The replay keeps the one recorded decision for the old head and makes
    // no write: the newer head's finding stays.
    expect(await run.deliver(reopened)).toBe(
      "human_reopen; newer item state kept",
    );
    expect(run.labels).toContain("slopbot: spam");
    expect(run.writes).toHaveLength(before);
    expect(
      run.sql(
        "SELECT COUNT(*) AS n FROM slopbot_actions WHERE action = 'human_reopen'",
      ),
    ).toEqual([{ n: 1 }]);
  });
});

test("a delayed bound reopen clears the same-head finding that raced before its marker", async () => {
  setSystemTime(new Date(CLOSED_AT));
  await closedItem(async (run) => {
    // Admission has source evidence but the queue has not processed it yet.
    const reopened = await run.reopen();
    setSystemTime(new Date(Date.parse(CLOSED_AT) + 2000));
    run.closureEnabled(false);
    expect(await run.review()).toBe("labeled (spam)");
    expect(await run.deliver(reopened)).toBe("human_reopen");
    expect(run.labels).not.toContain("slopbot: spam");
    expect(
      run.sql(
        "SELECT COUNT(*) AS n FROM slopbot_actions WHERE action = 'human_reopen'",
      ),
    ).toEqual([{ n: 1 }]);
  });
});

test("a genuine fresh same-second reopen clears the finding and reverses once", async () => {
  const second = Date.parse(CLOSED_AT);
  setSystemTime(new Date(second + 100));
  await closedItem(async (run) => {
    expect(await run.review()).toBe("closed (spam)");
    // GitHub truncates updated_at; persistent protection binds the revision,
    // so precision cannot create a new wait or require another human action.
    setSystemTime(new Date(second + 500));
    const reopened = await run.reopen(MAINTAINER, CLOSED_AT);
    expect(await run.deliver(reopened)).toBe("human_reopen");
    expect(run.labels).not.toContain("slopbot: spam");
    expect(run.sql(PENALTY)).toMatchObject([{ reversal: "maintainer_reopen" }]);
    const first = run.sql("SELECT reversed_at FROM slopbot_penalties");
    expect(await run.deliver(reopened)).toBe("human_reopen");
    expect(run.sql("SELECT reversed_at FROM slopbot_penalties")).toEqual(first);
  });
});

test("unknown label DELETE retries preserve one reversal and current maintainer authority", async () => {
  setSystemTime(new Date(CLOSED_AT));
  await closedItem(async (run) => {
    expect(await run.review()).toBe("closed (spam)");
    const reopened = await run.reopen();
    run.loseNextLabelDelete();
    await expect(run.deliver(reopened)).rejects.toThrow(
      "appeal job was retried",
    );
    expect(run.labels).not.toContain("slopbot: spam");
    expect(await run.deliver(reopened)).toBe("human_reopen");
    const before = run.sql(
      "SELECT reversed_at, reversal FROM slopbot_penalties",
    );
    expect(await run.deliver(reopened)).toBe("human_reopen");
    expect(
      run.sql("SELECT reversed_at, reversal FROM slopbot_penalties"),
    ).toEqual(before);
    expect(
      run.sql(
        "SELECT COUNT(*) AS n FROM slopbot_actions WHERE action = 'human_reopen'",
      ),
    ).toEqual([{ n: 1 }]);
    // A GitHub outage retries the job instead of dropping the decision.
    run.maintainerPermission("unavailable");
    await expect(run.deliver(reopened)).rejects.toThrow(
      "appeal job was retried",
    );
    run.maintainerPermission(false);
    expect(await run.deliver(reopened)).toBe(
      "reopen by a non-maintainer recorded as no decision",
    );
  });
});

test("unsupported legacy reopen and a subsequently closed item make no decision", async () => {
  setSystemTime(new Date(CLOSED_AT));
  await closedItem(async (run) => {
    expect(await run.review()).toBe("closed (spam)");
    expect(
      await run.deliver(run.job("human_reopen", { senderId: MAINTAINER })),
    ).toBe("reopen source unavailable; no decision");
    const reopened = await run.reopen();
    run.closeByMaintainer();
    const before = run.writes.length;
    expect(await run.deliver(reopened)).toBe(
      "reopen source changed; no decision",
    );
    expect(run.labels).toContain("slopbot: spam");
    expect(run.sql(PENALTY)).toMatchObject([{ reversal: null }]);
    expect(run.writes).toHaveLength(before);
  });
});

for (const loseResponse of [false, true]) {
  test(`a same-revision reopen wins a concurrent category label (lost response: ${loseResponse})`, async () => {
    setSystemTime(new Date(CLOSED_AT));
    await closedItem(async (run) => {
      const paused = run.pauseNextFindingLabel(loseResponse);
      const pending = run.review().then(
        (outcome) => ({ outcome }),
        (error) => ({ error }),
      );
      try {
        await paused.entered;
        expect(await run.deliver(await run.reopen())).toBe("human_reopen");
      } finally {
        paused.release();
      }
      const result = await pending;
      if (loseResponse) {
        expect(result).toHaveProperty("error");
        expect(await run.review()).toContain("maintainer decision stands");
      } else expect(result).toHaveProperty("outcome");
      expect(run.labels).not.toContain("slopbot: spam");
      expect(
        run.writes.filter((w) => w === "PATCH /repos/SlopDotCash/asi/pulls/5"),
      ).toHaveLength(0);
      expect(run.sql(PENALTY)).toEqual([]);
    });
  });
}

test("the first delivery of an old-head reopen preserves a newer finding", async () => {
  setSystemTime(new Date(CLOSED_AT));
  await closedItem(async (run) => {
    const reopened = await run.reopen();
    run.head("d".repeat(40));
    run.closureEnabled(false);
    expect(await run.review()).toBe("labeled (spam)");
    const before = run.writes.length;
    // A maintainer reopen always wins: the decision for the reopened head is
    // recorded, but the newer head's finding is not removed.
    expect(await run.deliver(reopened)).toBe(
      "human_reopen; newer item state kept",
    );
    expect(run.labels).toContain("slopbot: spam");
    expect(run.writes).toHaveLength(before);
    expect(
      run.sql(
        "SELECT json_extract(reopen_source, '$.revision') AS revision FROM slopbot_deliveries WHERE reopen_confirmed_at IS NOT NULL",
      ),
    ).toEqual([{ revision: "b".repeat(40) }]);
    expect(
      run.sql(
        "SELECT review_key, COUNT(*) AS n FROM slopbot_actions WHERE action = 'human_reopen'",
      ),
    ).toEqual([{ review_key: `reopen:PR_local:${"b".repeat(40)}`, n: 1 }]);
  });
});

for (const failure of [
  "none",
  "close response",
  "reopen response",
  "closer evidence",
] as const) {
  test(`a confirmed same-revision reopen recovers a close already in flight: ${failure}`, async () => {
    setSystemTime(new Date(CLOSED_AT));
    await closedItem(async (run) => {
      const paused = run.pauseNextClose({
        loseResponse: failure === "close response",
      });
      const pending = run.review().then(
        (outcome) => ({ outcome }),
        (error) => ({ error }),
      );
      try {
        await paused.entered;
        run.closeByMaintainer();
        expect(await run.deliver(await run.reopen())).toBe("human_reopen");
        if (failure === "reopen response") run.loseNextReopenResponse();
        if (failure === "closer evidence") run.closerEvidence(false);
      } finally {
        paused.release();
      }
      const result = await pending;
      if (failure !== "none") {
        expect(result).toHaveProperty("error");
        expect(run.sql(PENALTY)).toEqual([]);
        if (failure === "closer evidence") {
          expect(run.currentState()).toBe("closed");
          const before = run.writes.length;
          await expect(run.review()).rejects.toThrow("Closer is unavailable");
          expect(run.writes).toHaveLength(before);
          run.closerEvidence(true);
        }
        await run.review();
      }
      expect(run.currentState()).toBe("open");
      expect(run.labels).not.toContain("slopbot: spam");
      expect(run.sql(PENALTY)).toEqual([]);
      expect(
        run.writes.filter((w) => w === "PATCH /repos/SlopDotCash/asi/pulls/5"),
      ).toHaveLength(2);
    });
  });
}

for (const later of ["human close", "new head", "merged"] as const) {
  test(`late-close recovery preserves a subsequent ${later}`, async () => {
    setSystemTime(new Date(CLOSED_AT));
    await closedItem(async (run) => {
      const paused = run.pauseNextClose({
        afterWrite: () => {
          if (later === "human close") run.closeByMaintainer();
          if (later === "new head") run.head("d".repeat(40));
          if (later === "merged") run.merged(true);
        },
      });
      const pending = run.review();
      try {
        await paused.entered;
        run.closeByMaintainer();
        expect(await run.deliver(await run.reopen())).toBe("human_reopen");
      } finally {
        paused.release();
      }
      await pending;
      expect(run.currentState()).toBe("closed");
      expect(run.sql(PENALTY)).toEqual([]);
      expect(
        run.writes.filter((w) => w === "PATCH /repos/SlopDotCash/asi/pulls/5"),
      ).toHaveLength(1);
    });
  });
}

test("a reopen that confirms at the first penalty INSERT atomically prevents a new debit", async () => {
  setSystemTime(new Date(CLOSED_AT));
  await closedItem(async (run) => {
    run.beforePenaltyInsert(async () => {
      expect(await run.deliver(await run.reopen())).toBe("human_reopen");
    });
    await run.review();
    expect(run.currentState()).toBe("open");
    expect(run.sql(PENALTY)).toEqual([]);
    expect(
      run.sql(
        "SELECT COUNT(*) AS n FROM slopbot_deliveries WHERE reopen_confirmed_at IS NOT NULL",
      ),
    ).toEqual([{ n: 1 }]);
  });
});

test("a delayed genuine reopen reverses the bot close that raced before queue delivery", async () => {
  setSystemTime(new Date(CLOSED_AT));
  await closedItem(async (run) => {
    const reopened = await run.reopen();
    expect(await run.review()).toBe("closed (spam)");
    expect(await run.deliver(reopened)).toBe("human_reopen");
    expect(run.currentState()).toBe("open");
    expect(run.sql(PENALTY)).toMatchObject([{ reversal: "maintainer_reopen" }]);
    const first = run.sql("SELECT reversed_at FROM slopbot_penalties");
    expect(await run.deliver(reopened)).toBe("human_reopen");
    expect(run.sql("SELECT reversed_at FROM slopbot_penalties")).toEqual(first);
  });
});

for (const timing of [
  "before triage",
  "after triage",
  "during acceptance",
] as const) {
  test(`an account banned ${timing} needs a moderator to resolve its public appeal`, async () => {
    await closedItem(async (run) => {
      expect(await run.review()).toBe("closed (spam)");
      if (timing === "before triage") run.ban();
      run.model("none", 0.95);
      expect(await run.deliver(run.job("appeal", { senderId: AUTHOR }))).toBe(
        timing === "before triage"
          ? "appeal escalated: the appellant has an active participation ban"
          : "appeal drafted (uphold)",
      );
      if (timing === "after triage") run.ban();
      if (timing === "during acceptance") run.beforeAppealResolution(run.ban);
      for (const senderId of [AUTHOR, MAINTAINER]) {
        expect(
          await run.deliver(
            run.job("appeal_command", {
              command: "accept",
              senderId,
            }),
          ),
        ).toBe("a Slop moderator decides this appeal");
      }
      expect(run.sql(APPEAL)).toEqual([
        { draft: "uphold", escalated: 1, resolution: null, resolved_by: null },
      ]);
      expect(run.currentState()).toBe("closed");
      expect(
        await run.deliver(
          run.job("appeal_command", {
            command: "uphold",
            senderId: MODERATOR,
          }),
        ),
      ).toBe("appeal upheld by the moderator");
      expect(run.currentState()).toBe("open");
      // Resolving a work appeal cannot reinstate a banned account.
      expect(run.sql("SELECT * FROM project_account_reinstatements")).toEqual(
        [],
      );
    });
  });
}

// Slopbot gap regressions (goal: Slopbot as specified). Fixtures prove the
// controls only, not model qualification or production behavior.

test("a maintainer reopen reverses the debit even when the author pushes before it is processed", async () => {
  setSystemTime(new Date(CLOSED_AT));
  await closedItem(async (run) => {
    expect(await run.review()).toBe("closed (spam)");
    const reopened = await run.reopen();
    // The author pushes a new head before the queue delivers the reopen.
    run.head("d".repeat(40));
    const before = run.writes.length;
    expect(await run.deliver(reopened)).toBe(
      "human_reopen; newer item state kept",
    );
    expect(run.sql(PENALTY)).toMatchObject([
      { category: "spam", reversal: "maintainer_reopen" },
    ]);
    // The decision binds the reopened head; no write touches the newer one.
    expect(run.writes).toHaveLength(before);
    expect(
      run.sql(
        "SELECT review_key FROM slopbot_actions WHERE action = 'human_reopen'",
      ),
    ).toEqual([{ review_key: `reopen:PR_local:${"b".repeat(40)}` }]);
    // A replay reverses nothing a second time.
    const reversed = run.sql("SELECT reversed_at FROM slopbot_penalties");
    expect(await run.deliver(reopened)).toBe(
      "human_reopen; newer item state kept",
    );
    expect(run.sql("SELECT reversed_at FROM slopbot_penalties")).toEqual(
      reversed,
    );
  });
});

test("an author's own reopen after a push is still not a maintainer decision", async () => {
  setSystemTime(new Date(CLOSED_AT));
  await closedItem(async (run) => {
    expect(await run.review()).toBe("closed (spam)");
    const reopened = await run.reopen(AUTHOR);
    run.head("d".repeat(40));
    expect(await run.deliver(reopened)).toBe(
      "reopen source changed; no decision",
    );
    expect(run.sql(PENALTY)).toMatchObject([{ reversal: null }]);
  });
});

test("a retired project reverses an existing debit through a maintainer reopen, with no review or GitHub write", async () => {
  setSystemTime(new Date(CLOSED_AT));
  await closedItem(async (run) => {
    expect(await run.review()).toBe("closed (spam)");
    run.retire();
    const writes = run.writes.length;
    const calls = run.modelInputs.length;
    // The webhook admits the reversal event for a retired project.
    const reopened = await run.reopen();
    expect(await run.deliver(reopened)).toBe(
      "human_reopen; project is retired, penalty reversal only",
    );
    expect(run.sql(PENALTY)).toMatchObject([{ reversal: "maintainer_reopen" }]);
    expect(run.writes).toHaveLength(writes);
    expect(run.modelInputs).toHaveLength(calls);
    // The active feed drops the reversed debit; history retains the reason.
    const history = (await (
      await run.feed(
        "https://slopbot.example/v1/penalties?project=asi&after=&history=1",
      )
    ).json()) as { records: { reversal: string | null }[] };
    expect(history.records).toMatchObject([{ reversal: "maintainer_reopen" }]);
  });
});

test("a retired project sends an appeal of an existing debit to a moderator, whose uphold reverses it without GitHub writes", async () => {
  setSystemTime(new Date(CLOSED_AT));
  await closedItem(async (run) => {
    expect(await run.review()).toBe("closed (spam)");
    run.retire();
    const writes = run.writes.length;
    const calls = run.modelInputs.length;
    expect(await run.deliver(run.job("appeal", { senderId: AUTHOR }))).toBe(
      "appeal escalated: the project is retired, so Slopbot does not triage",
    );
    expect(
      await run.deliver(
        run.job("appeal_command", { command: "accept", senderId: AUTHOR }),
      ),
    ).toBe("a Slop moderator decides this appeal");
    expect(
      await run.deliver(
        run.job("appeal_command", { command: "uphold", senderId: MODERATOR }),
      ),
    ).toBe("appeal upheld by the moderator");
    expect(run.sql(PENALTY)).toMatchObject([{ reversal: "appeal_upheld" }]);
    expect(run.sql(APPEAL)).toEqual([
      {
        draft: null,
        escalated: 1,
        resolution: "upheld",
        resolved_by: "moderator",
      },
    ]);
    expect(run.writes).toHaveLength(writes);
    expect(run.modelInputs).toHaveLength(calls);
  });
});

test("a retired project without a debit stays unreviewed", async () => {
  setSystemTime(new Date(CLOSED_AT));
  await closedItem(async (run) => {
    run.closureEnabled(false);
    expect(await run.review()).toBe("labeled (spam)");
    run.retire();
    const writes = run.writes.length;
    expect(await run.deliver(run.job("appeal", { senderId: AUTHOR }))).toBe(
      "project is retired; no review",
    );
    expect(run.sql(APPEAL)).toEqual([]);
    expect(run.writes).toHaveLength(writes);
  });
});

test("GitHub's close time, not Slopbot's clock, decides the debit month", async () => {
  // Slopbot records the close just after midnight UTC on 1 December; GitHub
  // closed the item in November.
  setSystemTime(new Date("2026-12-01T00:00:01.000Z"));
  await closedItem(async (run) => {
    run.closeTime("2026-11-30T23:59:59Z");
    expect(await run.review()).toBe("closed (spam)");
    expect(
      run.sql("SELECT period, recorded_at FROM slopbot_penalties"),
    ).toEqual([{ period: "2026-11", recorded_at: "2026-11-30T23:59:59.000Z" }]);
  });
});

test("a close response without GitHub's close time records no debit", async () => {
  setSystemTime(new Date(CLOSED_AT));
  await closedItem(async (run) => {
    run.closeTime(null);
    expect(await run.review()).toBe("labeled (spam)");
    expect(run.sql(PENALTY)).toEqual([]);
  });
});

for (const reversal of ["upheld appeal", "author dispute"] as const) {
  test(`the reopen-rate circuit breaker ${reversal === "upheld appeal" ? "counts" : "ignores"} an ${reversal}`, async () => {
    setSystemTime(new Date(CLOSED_AT));
    await closedItem(async (run) => {
      const [{ id: repositoryId }] = run.sql(
        "SELECT json_extract(manifest, '$.authority.repositoryId') AS id FROM projects",
      ) as { id: string }[];
      const earlier = new Date(Date.parse(CLOSED_AT) - day).toISOString();
      const later = new Date(Date.parse(CLOSED_AT) - day / 2).toISOString();
      // Five earlier Slopbot closes in this repository; one is reversed.
      for (let i = 1; i <= 5; i++)
        run.sql(
          `INSERT INTO slopbot_actions (review_key, repository_id, item_node_id, action, detail, created_at)
           VALUES ('prior-${i}', ${repositoryId}, 'PR_prior_${i}', 'close', '{}', '${earlier}')`,
        );
      if (reversal === "upheld appeal")
        run.sql(
          `INSERT INTO slopbot_appeals (appeal_key, repository_id, item_node_id, appellant_github_id, job_json,
             opened_at, due_at, resolved_at, resolution, resolved_by)
           VALUES ('appeal:PR_prior_1:x', ${repositoryId}, 'PR_prior_1', '42', '{}',
             '${earlier}', '${new Date(Date.parse(earlier) + 7 * day).toISOString()}', '${later}', 'upheld', 'appellant')`,
        );
      else
        run.sql(
          `INSERT INTO slopbot_actions (review_key, repository_id, item_node_id, action, detail, created_at)
           VALUES ('reopen:PR_prior_1:x', ${repositoryId}, 'PR_prior_1', 'appeal', '42', '${later}')`,
        );
      if (reversal === "upheld appeal") {
        expect(await run.review()).toBe("labeled (spam)");
        expect(run.sql(PENALTY)).toEqual([]);
      } else expect(await run.review()).toBe("closed (spam)");
    });
  });
}

test("an appeal draft never reuses a different finding's confidence as confidence to uphold", async () => {
  setSystemTime(new Date(CLOSED_AT));
  await closedItem(async (run) => {
    expect(await run.review()).toBe("closed (spam)");
    // The independent review is sure the item is bad, just not spam.
    run.model("gaming", 0.97);
    expect(await run.deliver(run.job("appeal", { senderId: AUTHOR }))).toBe(
      "appeal escalated: Slopbot confidence is below 0.9",
    );
    expect(
      run.sql("SELECT draft, draft_confidence FROM slopbot_appeals"),
    ).toEqual([{ draft: "uphold", draft_confidence: 0 }]);
    expect(run.sql(PENALTY)).toMatchObject([{ reversal: null }]);
  });
});

test("a delayed old-head reopen never reverses a later head's close and debit", async () => {
  setSystemTime(new Date(CLOSED_AT));
  await closedItem(async (run) => {
    // The maintainer reopen covers head b; its delivery is delayed.
    const reopened = await run.reopen();
    // The author pushes head d, and Slopbot closes d with a debit.
    run.head("d".repeat(40));
    setSystemTime(new Date(Date.parse(CLOSED_AT) + 60_000));
    expect(await run.review()).toBe("closed (spam)");
    expect(run.sql(PENALTY)).toMatchObject([{ reversal: null }]);
    const before = run.writes.length;
    expect(await run.deliver(reopened)).toBe(
      "human_reopen; newer item state kept",
    );
    // The old-head decision is recorded, but the later debit stands.
    expect(run.sql(PENALTY)).toMatchObject([{ reversal: null }]);
    expect(run.writes).toHaveLength(before);
    expect(run.currentState()).toBe("closed");
  });
});

test("accepting an older head's uphold draft never reverses a later head's close and debit", async () => {
  setSystemTime(new Date(CLOSED_AT));
  await closedItem(async (run) => {
    // Head b gets a spam label only: the owner has not consented to closure.
    run.consent(false);
    expect(await run.review()).not.toStartWith("closed");
    expect(run.labels).toContain("slopbot: spam");
    // The author appeals head b, and triage drafts an uphold.
    run.model("none", 0.95);
    expect(await run.deliver(run.job("appeal", { senderId: AUTHOR }))).toBe(
      "appeal drafted (uphold)",
    );
    // The owner consents, the author pushes head d, and Slopbot closes d
    // with a debit. Head d has no appeal.
    run.consent(true);
    run.head("d".repeat(40));
    setSystemTime(new Date(Date.parse(CLOSED_AT) + 60_000));
    run.model("spam", 0.97);
    expect(await run.review()).toBe("closed (spam)");
    expect(run.sql(PENALTY)).toMatchObject([{ reversal: null }]);
    const before = run.writes.length;
    // The author accepts the head-b draft. The decision is recorded for b,
    // but the close, label and debit of head d stand.
    const result = await run.deliver(
      run.job("appeal_command", { command: "accept", senderId: AUTHOR }),
    );
    expect(run.sql(PENALTY)).toMatchObject([{ reversal: null }]);
    expect(run.currentState()).toBe("closed");
    expect(run.labels).toContain("slopbot: spam");
    expect(
      run.writes.slice(before).filter((write) => !write.endsWith("/comments")),
    ).toEqual([]);
    expect(result).toBe(
      "appeal upheld by the appellant; newer item state kept",
    );
    expect(run.sql(APPEAL)).toMatchObject([
      { resolution: "upheld", resolved_by: "appellant" },
    ]);
  });
});

test("accepting an older head's uphold draft removes that head's label when a later head adds no finding", async () => {
  setSystemTime(new Date(CLOSED_AT));
  await closedItem(async (run) => {
    // Head b gets a spam label only: the owner has not consented to closure.
    run.consent(false);
    expect(await run.review()).not.toStartWith("closed");
    expect(run.labels).toContain("slopbot: spam");
    run.model("none", 0.95);
    expect(await run.deliver(run.job("appeal", { senderId: AUTHOR }))).toBe(
      "appeal drafted (uphold)",
    );
    // The author pushes a clean head d. Its review publishes no finding, so
    // head b's label is still the newest finding on the item.
    run.head("d".repeat(40));
    setSystemTime(new Date(Date.parse(CLOSED_AT) + 60_000));
    run.model("none", 0.95);
    expect(await run.review()).not.toStartWith("closed");
    expect(run.labels).toContain("slopbot: spam");
    const before = run.writes.length;
    const result = await run.deliver(
      run.job("appeal_command", { command: "accept", senderId: AUTHOR }),
    );
    expect(result).toBe(
      "appeal upheld by the appellant; newer item state kept",
    );
    // Head b's label goes; nothing reopens.
    expect(run.labels).not.toContain("slopbot: spam");
    const writes = run.writes
      .slice(before)
      .filter((write) => !write.endsWith("/comments"));
    expect(writes.some((write) => write.startsWith("DELETE"))).toBe(true);
    expect(writes.filter((write) => write.startsWith("PATCH"))).toEqual([]);
    expect(run.sql(APPEAL)).toMatchObject([
      { resolution: "upheld", resolved_by: "appellant" },
    ]);
  });
});

test("accepting an older head's uphold draft keeps a later head's finding label", async () => {
  setSystemTime(new Date(CLOSED_AT));
  await closedItem(async (run) => {
    run.consent(false);
    expect(await run.review()).not.toStartWith("closed");
    expect(run.labels).toContain("slopbot: spam");
    run.model("none", 0.95);
    expect(await run.deliver(run.job("appeal", { senderId: AUTHOR }))).toBe(
      "appeal drafted (uphold)",
    );
    // Head d gets its own label-only spam finding after the appeal opened.
    run.head("d".repeat(40));
    setSystemTime(new Date(Date.parse(CLOSED_AT) + 60_000));
    run.model("spam", 0.97);
    expect(await run.review()).not.toStartWith("closed");
    expect(run.labels).toContain("slopbot: spam");
    const before = run.writes.length;
    expect(
      await run.deliver(
        run.job("appeal_command", { command: "accept", senderId: AUTHOR }),
      ),
    ).toBe("appeal upheld by the appellant; newer item state kept");
    expect(run.labels).toContain("slopbot: spam");
    expect(
      run.writes.slice(before).filter((write) => !write.endsWith("/comments")),
    ).toEqual([]);
  });
});

test("reverting the branch to the appealed head after a later head's close never reopens or removes the later finding", async () => {
  setSystemTime(new Date(CLOSED_AT));
  await closedItem(async (run) => {
    // Head b gets a spam label only: the owner has not consented to closure.
    run.consent(false);
    expect(await run.review()).not.toStartWith("closed");
    expect(run.labels).toContain("slopbot: spam");
    // The author appeals head b, and triage drafts an uphold.
    run.model("none", 0.95);
    expect(await run.deliver(run.job("appeal", { senderId: AUTHOR }))).toBe(
      "appeal drafted (uphold)",
    );
    // The owner consents, the author pushes head d, and Slopbot closes d
    // with a scam finding and debit. Head d has no appeal.
    run.consent(true);
    run.head("d".repeat(40));
    setSystemTime(new Date(Date.parse(CLOSED_AT) + 60_000));
    run.model("scam", 0.97);
    expect(await run.review()).toBe("closed (scam)");
    expect(run.sql(PENALTY)).toMatchObject([
      { category: "scam", debit_thirds: 24, reversal: null },
    ]);
    // The author force-pushes the branch back to head b and accepts the old
    // head-b draft. Head d's close, scam label and debit must still stand.
    run.head("b".repeat(40));
    const before = run.writes.length;
    const result = await run.deliver(
      run.job("appeal_command", { command: "accept", senderId: AUTHOR }),
    );
    expect(run.sql(PENALTY)).toMatchObject([
      { category: "scam", debit_thirds: 24, reversal: null },
    ]);
    expect(run.currentState()).toBe("closed");
    expect(run.labels).toContain("slopbot: scam");
    expect(
      run.writes.slice(before).filter((write) => !write.endsWith("/comments")),
    ).toEqual([]);
    expect(result).toBe(
      "appeal upheld by the appellant; newer item state kept",
    );
    expect(run.sql(APPEAL)).toMatchObject([
      { resolution: "upheld", resolved_by: "appellant" },
    ]);
  });
});
