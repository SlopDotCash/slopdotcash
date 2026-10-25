// Owner decisions D6, D7 and D8: closure of a verified Slop-skill member, the
// published penalty table, and Slopbot-first appeal triage with moderator
// escalation. The real worker runs against the real migrations, a local
// synthetic GitHub server and a local synthetic model endpoint; nothing
// leaves this process.
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { readdirSync } from "node:fs";
import { handleNotificationsApi } from "../../backend/notifications/handler";
import { fetchProjectPenalties } from "../../scripts/value-ingestion";
import {
  createLeaderboardSnapshot,
  type LeaderboardSnapshot,
} from "../../src/lib/leaderboard";
import { parseNotificationsResponse } from "../../src/lib/notifications";
import { createProjectView } from "../../src/lib/project-view";
import { findProject } from "../../src/lib/projects.mjs";
import {
  AFTER_NOVEMBER,
  GENERATED_AT,
  PENALIZED_AUTHOR,
  penaltyScoreInput,
} from "../../tests/penalty-score-fixture";
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

afterEach(() => setSystemTime());

const AUTHOR = 42;
const MAINTAINER = 43;
const OUTSIDER = 44;
const MODERATOR = 50;
const BODY = "Buy cheap followers today at our shop.";
/** When Slopbot closes the fixture pull request; GitHub's closedAt agrees. */
const CLOSED_AT = "2026-11-10T00:00:00.000Z";

type Run = {
  inbox(actor: number, moderators?: string, path?: string): Promise<Response>;
  enableMail(): Promise<void>;
  mail(moderators?: string): Promise<string[]>;
  review: () => Promise<string>;
  deliver: (job: Job) => Promise<string>;
  tick: () => Promise<Job[]>;
  model: (category: Category, confidence: number) => void;
  pauseNextReopen: () => { entered: Promise<void>; release: () => void };
  loseNextReopenResponse: () => void;
  closeByMaintainer: () => void;
  writes: string[];
  comments: string[];
  labels: string[];
  sql: (q: string) => unknown;
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
  const project = findProject("asi");
  if (!project) throw new Error("fixture project missing");
  const manifest = JSON.stringify({ ...project, status: "active" });
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
  // An installation past its shadow period: 14 days and 50 completed reviews.
  sqlite.run(
    "INSERT INTO slopbot_installations(installation_id, account_id, account_login, account_type, created_at) VALUES (1,77,?,'Organization',?)",
    [owner, at],
  );
  const repositoryId = Number(project.authority.repositoryId);
  for (let i = 0; i < 50; i++)
    sqlite.run(
      `INSERT INTO slopbot_reviews(review_key,installation_id,repository_id,item_kind,item_number,item_node_id,
        author_id,revision,content_digest,policy_digest,status,created_at,completed_at)
       VALUES (?,1,?,'pull_request',?,?,1000,'r','d','p','completed',?,?)`,
      [`shadow-${i}`, repositoryId, 100 + i, `PR_shadow_${i}`, at, at],
    );
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
  let pauseReopen: (() => Promise<void>) | null = null;
  let loseReopenResponse = false;
  let verdict = { category: "spam" as Category, confidence: 0.97 };
  const config = Buffer.from(
    JSON.stringify({ version: 1, audience: "protection", closure: true }),
  ).toString("base64");
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
      if (path === "/v1/messages")
        return Response.json({
          id: "msg_local",
          type: "message",
          role: "assistant",
          model: "claude-opus-5.5",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ...verdict,
                rule_refs: [
                  { source: "universal", quote: "Buy cheap followers" },
                ],
                evidence: ["Buy cheap followers"],
                summary: "This pull request advertises a service.",
                limitations: [],
                objective_defect: null,
              }),
            },
          ],
          usage: { input_tokens: 10, output_tokens: 10 },
        });
      if (path.endsWith("/access_tokens"))
        return Response.json({ token: "local-synthetic-token" });
      if (path === `/repos/${owner}/${repo}`)
        return Response.json({
          id: repositoryId,
          private: false,
          default_branch: "main",
          owner: { login: owner, id: 77, type: "Organization" },
        });
      if (path.endsWith("/contents/.github/slopbot.json"))
        return Response.json({
          type: "file",
          size: 64,
          content: config,
          encoding: "base64",
        });
      if (path.endsWith("/issues/5") && request.method === "GET")
        return Response.json({
          node_id: "PR_local",
          number: 5,
          state,
          title: "Followers",
          body: BODY,
          user: { login: "author", id: AUTHOR, type: "User" },
          assignees: [],
          labels: labels.map((name) => ({ name })),
          pull_request: {},
        });
      if (path.endsWith("/pulls/5") && request.method === "PATCH") {
        const next = ((await request.json()) as { state: string }).state;
        if (next === "open" && pauseReopen) {
          const pause = pauseReopen;
          pauseReopen = null;
          await pause();
        }
        state = next;
        if (next === "open" && loseReopenResponse) {
          loseReopenResponse = false;
          return Response.json(
            { error: "synthetic lost response" },
            { status: 503 },
          );
        }
        return Response.json({ state });
      }
      if (path.endsWith("/pulls/5"))
        return Response.json({
          draft: false,
          merged: false,
          head: { sha: "b".repeat(40) },
          base: { sha: "c".repeat(40) },
          additions: 1,
          deletions: 0,
          changed_files: 1,
        });
      if (path.endsWith("/branches/main"))
        return Response.json({ commit: { sha: "c".repeat(40) } });
      if (path.endsWith("/pulls/5/files"))
        return Response.json(
          url.searchParams.get("page") === "1" || !url.searchParams.has("page")
            ? [
                {
                  filename: "README.md",
                  status: "modified",
                  patch: `+${BODY}`,
                },
              ]
            : [],
        );
      const user = path.match(/^\/user\/(\d+)$/u);
      if (user && login(Number(user[1])))
        return Response.json({
          login: login(Number(user[1])),
          id: Number(user[1]),
        });
      if (path.endsWith("/permission"))
        return Response.json({
          permission: path.includes("/maintainer/") ? "write" : "read",
        });
      if (path.endsWith("/issues/5/comments") && request.method === "GET")
        return Response.json([
          {
            id: 1,
            body: "/slopbot appeal This is my real project page, not an advert.",
            user: { id: AUTHOR },
          },
        ]);
      if (path.endsWith("/issues/5/comments")) {
        comments.push(((await request.json()) as { body: string }).body);
        return Response.json({ id: 900 + comments.length }, { status: 201 });
      }
      if (/\/issues\/comments\/\d+$/u.test(path)) {
        comments.push(((await request.json()) as { body: string }).body);
        return Response.json({ id: Number(path.split("/").pop()) });
      }
      if (path.endsWith("/issues/5/labels")) {
        const body = (await request.json()) as { labels: string[] };
        for (const name of body.labels)
          if (!labels.includes(name)) labels.push(name);
        return Response.json(labels.map((name) => ({ name })));
      }
      const removed = path.match(/\/issues\/5\/labels\/(.+)$/u);
      if (removed && request.method === "DELETE") {
        const name = decodeURIComponent(removed[1]);
        labels.splice(labels.indexOf(name), 1);
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
    if (u.origin === new URL(server.url).origin) return nativeFetch(url, init);
    if (u.hostname !== "api.github.com")
      throw new Error(`unexpected network request to ${u.hostname}`);
    return nativeFetch(new URL(u.pathname + u.search, server.url), init);
  }) as typeof fetch;
  const sent: Job[] = [];
  const env = {
    SLOPBOT_DB: db as unknown as D1TransactionalDatabase,
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
      closeByMaintainer: () => {
        state = "closed";
      },
      loseNextReopenResponse: () => {
        loseReopenResponse = true;
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
      sql: (q) => sqlite.query(q).all(),
      feed: ((url: Parameters<typeof fetch>[0]) =>
        worker.fetch(
          new Request(url instanceof Request ? url.url : String(url)),
          env as never,
        )) as typeof fetch,
    });
  } finally {
    console.log = log;
    globalThis.fetch = nativeFetch;
    server.stop(true);
    sqlite.close();
  }
}

const PENALTY =
  "SELECT category, debit_thirds, moderator_review, reversal FROM slopbot_penalties";
const APPEAL =
  "SELECT draft, escalation IS NOT NULL AS escalated, resolution, resolved_by FROM slopbot_appeals";
const day = 24 * 60 * 60 * 1000;

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
    expect(run.comments.at(-1)).toContain("removes 3 thirds of a point");
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
    expect(run.comments.at(-1)).toContain(
      "Slopbot drafted this resolution: uphold",
    );
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
    expect(
      await run.deliver(run.job("human_reopen", { senderId: MAINTAINER })),
    ).toBe("human_reopen");
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
    // A maintainer reopen still wins and reverses the debit once.
    expect(
      await run.deliver(run.job("human_reopen", { senderId: MAINTAINER })),
    ).toBe("human_reopen");
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
    expect(run.comments.at(-1)).toContain("**Appeal upheld**");
  });
});

// PRD section 7: the real worker records the debit, its public penalty feed
// carries it to the real score producer, and the published score applies it
// once, only to its project and UTC month, never below zero. An upheld appeal
// removes it from the next published score.
test("a recorded debit reaches the published score once and an upheld appeal restores it", async () => {
  setSystemTime(new Date(GENERATED_AT));
  await closedItem(async (run) => {
    const publish = async () =>
      createLeaderboardSnapshot(
        penaltyScoreInput(await fetchProjectPenalties("asi", run.feed)),
      );
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

    // October earns 3 thirds; November earns the 1-third merge minimum.
    expect(standing(await publish())).toEqual({
      scoreThirds: 4,
      penaltyThirds: 0,
      october: 3,
      november: 1,
      novemberPenalty: 0,
    });

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

    // A replayed review and a second publication apply the debit once.
    await run.review();
    expect(standing(await publish())).toEqual(penalized);

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
test("a recorded debit outside its month or window is never applied", () => {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const record = {
    itemNodeId: "PR_local",
    authorGithubId: "42",
    category: "spam",
    tableVersion: "slopbot-penalties-v1",
    debitThirds: 3,
    period: "2026-11",
    recordedAt: CLOSED_AT,
  };
  expect(() =>
    createLeaderboardSnapshot(
      penaltyScoreInput([{ ...record, period: "2026-12" }], AFTER_NOVEMBER),
    ),
  ).toThrow("Penalty feed record is malformed");

  // Recorded in September, before the 35-day window; GitHub's later close
  // stays inside it.
  const snapshot = createLeaderboardSnapshot(
    penaltyScoreInput(
      [
        {
          ...record,
          period: "2026-09",
          recordedAt: "2026-09-30T00:00:00.000Z",
        },
      ],
      AFTER_NOVEMBER,
    ),
  );
  expect(snapshot.penalties).toEqual([]);
  expect(
    createProjectView(snapshot, "asi", "2026-11").leaders.find(
      (entry) => entry.actor.id === PENALIZED_AUTHOR.id,
    ),
  ).toMatchObject({ penaltyThirds: 0 });
});

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
    expect(
      await run.deliver(run.job("human_reopen", { senderId: MAINTAINER })),
    ).toBe("human_reopen");
    expect(await run.mail()).toEqual([]);
    // The Inbox history is permanent; the notice is not deleted or rewritten.
    expect(run.sql(SCAM_NOTICES)).toHaveLength(1);
  });
});

for (const category of ["spam", "duplicate"] as const)
  test(`a ${category} close writes no moderator account-review notice`, async () => {
    await closedItem(async (run) => {
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
