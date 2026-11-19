// Drives the daily collection logic against a stateful GitHub API stand-in.
// Dispatches and reruns are the result; no live workflow is called.
import { expect, test } from "bun:test";
import {
  type Artifact,
  decide,
  type Env,
  followUp,
  type Job,
  type Run,
  start,
} from "./daily-collection";

const repo = "SlopDotCash/slopdotcash";
const T0 = Date.parse("2026-11-19T07:17:00Z");

function run(id: number, extra: Partial<Run> = {}): Run {
  return {
    id,
    status: "completed",
    conclusion: "success",
    event: "workflow_dispatch",
    head_branch: "main",
    head_sha: "a".repeat(40),
    path: ".github/workflows/deploy.yml",
    run_attempt: 1,
    created_at: new Date(T0).toISOString(),
    repository: { full_name: repo },
    head_repository: { full_name: repo },
    ...extra,
  };
}

type Shape = {
  collect?: string | null;
  profilesAt?: string;
  restore?: string;
  published?: boolean;
  prepare?: string;
};
function jobs(shape: Shape): Job[] {
  const prepareStatus = shape.prepare ?? "completed";
  const list: Job[] = [
    {
      name: "Prepare checked browser bundle",
      status: prepareStatus,
      conclusion:
        prepareStatus !== "completed"
          ? null
          : shape.collect === "failure"
            ? "failure"
            : "success",
      steps: [
        {
          name: "Generate live contribution data",
          status: "completed",
          conclusion: shape.collect === undefined ? "success" : shape.collect,
        },
        {
          name: "Generate live contributor profiles",
          status: "completed",
          conclusion: "success",
          started_at: shape.profilesAt ?? "2026-11-19T10:00:00Z",
        },
      ],
    },
    {
      name: "Deploy trusted production bundle",
      status: "completed",
      conclusion: "success",
      steps: [
        {
          name: "Verify Cloudflare deployment commit metadata",
          status: "completed",
          conclusion: shape.published ? "success" : "skipped",
        },
      ],
    },
  ];
  if (shape.restore)
    list.push({
      name: "Restore trusted production discussion reads",
      status: "completed",
      conclusion: shape.restore,
    });
  return list;
}

const checkpoint: Artifact[] = [
  { name: "leaderboard-discussions-1", expired: false },
];

function world(options: {
  runs?: Run[];
  jobs?: Record<number, Job[]>;
  artifacts?: Record<number, Artifact[]>;
  monthly?: Run[];
  live?: string;
  // How each dispatched publish or collection run ends, in order.
  outcomes?: { conclusion: string; published: boolean; afterRerun?: boolean }[];
  returnRunId?: boolean;
}) {
  let time = T0;
  let nextId = 900;
  const runs = new Map((options.runs ?? []).map((r) => [r.id, r]));
  const jobMap = new Map(
    Object.entries(options.jobs ?? {}).map(([k, v]) => [Number(k), v]),
  );
  const dispatched: Record<string, string>[] = [];
  const reruns: number[] = [];
  const outcomes = [...(options.outcomes ?? [])];
  const rerunOutcome = new Map<
    number,
    { conclusion: string; published: boolean }
  >();
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });
  const request = (async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ) => {
    const url = new URL(String(input));
    if (url.host === "slop.cash")
      return options.live === undefined
        ? new Response("", { status: 503 })
        : json({ generatedAt: options.live });
    const path = url.pathname.replace(`/repos/${repo}`, "");
    if (path.endsWith("/dispatches")) {
      const body = JSON.parse(String(init?.body));
      expect(body.ref).toBe("main");
      dispatched.push(body.inputs);
      const id = nextId++;
      const outcome = outcomes.shift() ?? {
        conclusion: "success",
        published: true,
      };
      runs.set(
        id,
        run(id, {
          status: "in_progress",
          conclusion: null,
          created_at: new Date(time).toISOString(),
        }),
      );
      jobMap.set(
        id,
        jobs({ collect: "skipped", published: outcome.published }),
      );
      // Each dispatched run completes on its next read.
      (runs.get(id) as Run & { pending?: typeof outcome }).pending = outcome;
      if (outcome.afterRerun !== undefined)
        rerunOutcome.set(id, {
          conclusion: "failure",
          published: outcome.afterRerun,
        });
      return options.returnRunId === false
        ? new Response(null, { status: 204 })
        : json({ workflow_run_id: id });
    }
    const rerun = path.match(/^\/actions\/runs\/(\d+)\/rerun-failed-jobs$/);
    if (rerun) {
      const id = Number(rerun[1]);
      reruns.push(id);
      const after = rerunOutcome.get(id) ?? {
        conclusion: "failure",
        published: false,
      };
      const current = runs.get(id) as Run;
      runs.set(id, { ...current, status: "in_progress", conclusion: null });
      (runs.get(id) as Run & { pending?: unknown }).pending = after;
      jobMap.set(id, jobs({ collect: "skipped", published: after.published }));
      return new Response(null, { status: 201 });
    }
    const list = path.match(/^\/actions\/workflows\/([\w.-]+)\/runs$/);
    if (list) {
      const source =
        list[1] === "monthly-rewards.yml"
          ? (options.monthly ?? [])
          : [...runs.values()];
      const event = url.searchParams.get("event");
      return json({
        workflow_runs: source.filter((r) => !event || r.event === event),
      });
    }
    const one = path.match(/^\/actions\/runs\/(\d+)(\/jobs|\/artifacts)?$/);
    if (one) {
      const id = Number(one[1]);
      if (one[2] === "/jobs") return json({ jobs: jobMap.get(id) ?? [] });
      if (one[2] === "/artifacts")
        return json({ artifacts: options.artifacts?.[id] ?? [] });
      const current = runs.get(id) as Run & {
        pending?: { conclusion: string };
      };
      if (current.pending) {
        const finished = {
          ...current,
          status: "completed",
          conclusion: current.pending.conclusion,
        };
        delete (finished as { pending?: unknown }).pending;
        runs.set(id, finished);
        return json(current);
      }
      return json(current);
    }
    throw new Error(`Unexpected request ${path}`);
  }) as typeof fetch;
  const log: string[] = [];
  const env: Env = {
    repo,
    token: async () => "token",
    request,
    sleep: async (ms) => {
      time += ms;
    },
    now: () => time,
    log: (line) => log.push(line),
  };
  return { env, dispatched, reruns, log, runs, jobMap };
}

test("decide publishes, resumes once, or does nothing", () => {
  const publish = decide(run(1), jobs({}), [], repo);
  expect(publish.action).toBe("publish");
  expect(decide(run(1), jobs({ published: true }), [], repo).action).toBe(
    "none",
  );
  expect(
    decide(run(1), jobs({ collect: "failure" }), checkpoint, repo).action,
  ).toBe("resume");
  expect(
    decide(
      run(1),
      jobs({ collect: "failure", restore: "success" }),
      checkpoint,
      repo,
    ).action,
  ).toBe("none");
  expect(decide(run(1), jobs({ collect: "failure" }), [], repo).action).toBe(
    "none",
  );
  expect(
    decide(
      run(1),
      jobs({ collect: "failure" }),
      [{ name: "leaderboard-discussions-1", expired: true }],
      repo,
    ).action,
  ).toBe("none");
  // A retained-data release did not collect, so it never triggers a publish.
  expect(decide(run(1), jobs({ collect: "skipped" }), [], repo).action).toBe(
    "none",
  );
  expect(decide(run(1), jobs({ collect: null }), [], repo).action).toBe("none");
  // Pull requests, forks and other branches are never acted on.
  for (const other of [
    run(1, { event: "pull_request" }),
    run(1, { head_branch: "development" }),
    run(1, { head_repository: { full_name: "someone/slopdotcash" } }),
    run(1, { path: ".github/workflows/formal.yml" }),
    run(1, { status: "in_progress" }),
  ])
    expect(decide(other, jobs({}), checkpoint, repo).action).toBe("none");
});

test("the daily start dispatches one fast fresh collection when nothing collects", async () => {
  const w = world({ live: "2026-11-19T01:00:00Z" });
  expect(await start(w.env)).toBe(0);
  expect(w.dispatched).toEqual([
    { skip_proofs: "true", skip_browser_tests: "true" },
  ]);
});

test("the daily start waits for a short retained-data release, then dispatches", async () => {
  const busy = run(5, { status: "in_progress", conclusion: null });
  const w = world({
    runs: [busy],
    jobs: { 5: jobs({ prepare: "in_progress" }) },
    live: "2026-11-19T01:00:00Z",
  });
  let reads = 0;
  const request = w.env.request;
  w.env.request = (async (input, init) => {
    if (String(input).includes("/actions/runs/5/jobs") && ++reads === 3)
      w.jobMap.set(5, jobs({ prepare: "completed" }));
    return request(input, init);
  }) as typeof fetch;
  expect(await start(w.env)).toBe(0);
  expect(w.dispatched).toHaveLength(1);
});

test("the daily start skips while a collection or the monthly close runs", async () => {
  const collecting = world({
    runs: [run(5, { status: "in_progress", conclusion: null, event: "push" })],
    jobs: { 5: jobs({ prepare: "in_progress" }) },
    live: "2026-11-19T01:00:00Z",
  });
  expect(await start(collecting.env)).toBe(0);
  expect(collecting.dispatched).toEqual([]);
  // A run that has not created its preparation job yet is still a collection.
  const queued = world({
    runs: [run(6, { status: "queued", conclusion: null })],
    live: "2026-11-19T01:00:00Z",
  });
  await start(queued.env);
  expect(queued.dispatched).toEqual([]);
  const monthly = world({
    monthly: [
      run(7, {
        status: "in_progress",
        path: ".github/workflows/monthly-rewards.yml",
      }),
    ],
    live: "2026-11-19T01:00:00Z",
  });
  await start(monthly.env);
  expect(monthly.dispatched).toEqual([]);
  // A finished preparation job no longer collects.
  const done = world({
    runs: [run(8, { status: "in_progress", conclusion: null })],
    jobs: { 8: jobs({ prepare: "completed" }) },
    live: "2026-11-19T01:00:00Z",
  });
  await start(done.env);
  expect(done.dispatched).toHaveLength(1);
});

test("the daily start fails visibly when live data is over two days old", async () => {
  const stale = world({ live: "2026-11-07T12:34:00Z" });
  expect(await start(stale.env)).toBe(1);
  expect(stale.dispatched).toHaveLength(1);
  expect(stale.log.some((line) => line.startsWith("::error::"))).toBe(true);
  const unreadable = world({});
  expect(await start(unreadable.env)).toBe(1);
});

test("a superseded collection is published, and a superseded publish is retried", async () => {
  const w = world({
    runs: [run(1, { event: "push" })],
    jobs: { 1: jobs({ profilesAt: "2026-11-19T10:00:00Z" }) },
    live: "2026-11-07T12:34:00Z",
    outcomes: [
      { conclusion: "success", published: false },
      { conclusion: "success", published: true },
    ],
  });
  expect(await followUp(w.env, 1)).toBe(0);
  const publish = {
    skip_proofs: "true",
    skip_browser_tests: "true",
    use_published_data: "true",
    data_from_run: "1",
  };
  expect(w.dispatched).toEqual([publish, publish]);
});

test("publishing finds the dispatched run when GitHub returns no run ID", async () => {
  const w = world({
    runs: [run(1)],
    jobs: { 1: jobs({}) },
    live: "2026-11-07T12:34:00Z",
    returnRunId: false,
  });
  expect(await followUp(w.env, 1)).toBe(0);
  expect(w.dispatched).toHaveLength(1);
});

test("publishing stops after three superseded releases", async () => {
  const superseded = { conclusion: "success", published: false };
  const w = world({
    runs: [run(1)],
    jobs: { 1: jobs({}) },
    live: "2026-11-07T12:34:00Z",
    outcomes: [superseded, superseded, superseded],
  });
  expect(await followUp(w.env, 1)).toBe(1);
  expect(w.dispatched).toHaveLength(3);
});

test("a failed publish has its failed jobs rerun once", async () => {
  const recovered = world({
    runs: [run(1)],
    jobs: { 1: jobs({}) },
    live: "2026-11-07T12:34:00Z",
    outcomes: [{ conclusion: "failure", published: false, afterRerun: true }],
  });
  expect(await followUp(recovered.env, 1)).toBe(0);
  expect(recovered.reruns).toEqual([900]);
  const failed = world({
    runs: [run(1)],
    jobs: { 1: jobs({}) },
    live: "2026-11-07T12:34:00Z",
    outcomes: [{ conclusion: "failure", published: false, afterRerun: false }],
  });
  expect(await followUp(failed.env, 1)).toBe(1);
  expect(failed.reruns).toEqual([900]);
  expect(failed.dispatched).toHaveLength(1);
});

test("no publish when the live site already serves this collection or a newer one", async () => {
  const w = world({
    runs: [run(1)],
    jobs: { 1: jobs({ profilesAt: "2026-11-19T10:00:00Z" }) },
    live: "2026-11-19T10:05:00Z",
  });
  expect(await followUp(w.env, 1)).toBe(0);
  expect(w.dispatched).toEqual([]);
});

test("a failed collection resumes once from its checkpoint after others end", async () => {
  const w = world({
    runs: [run(1)],
    jobs: { 1: jobs({ collect: "failure" }) },
    artifacts: { 1: checkpoint },
  });
  expect(await followUp(w.env, 1)).toBe(0);
  expect(w.dispatched).toEqual([
    {
      skip_proofs: "true",
      skip_browser_tests: "true",
      discussion_resume_run: "1",
    },
  ]);
  const resumed = world({
    runs: [run(2)],
    jobs: { 2: jobs({ collect: "failure", restore: "success" }) },
    artifacts: { 2: checkpoint },
  });
  expect(await followUp(resumed.env, 2)).toBe(0);
  expect(resumed.dispatched).toEqual([]);
  // Another collection running for the whole five hours: no resume.
  const busy = world({
    runs: [
      run(3),
      run(4, { status: "in_progress", conclusion: null, event: "push" }),
    ],
    jobs: {
      3: jobs({ collect: "failure" }),
      4: jobs({ prepare: "in_progress" }),
    },
    artifacts: { 3: checkpoint },
  });
  expect(await followUp(busy.env, 3)).toBe(1);
  expect(busy.dispatched).toEqual([]);
});

test("a collection that published itself, or a retained-data release, needs nothing", async () => {
  const published = world({
    runs: [run(1)],
    jobs: { 1: jobs({ published: true }) },
  });
  expect(await followUp(published.env, 1)).toBe(0);
  const retained = world({
    runs: [run(2)],
    jobs: { 2: jobs({ collect: "skipped" }) },
  });
  expect(await followUp(retained.env, 2)).toBe(0);
  expect([...published.dispatched, ...retained.dispatched]).toEqual([]);
});

test("a publish refused because newer data went live is not retried", async () => {
  const w = world({
    runs: [run(1)],
    jobs: { 1: jobs({ profilesAt: "2026-11-19T10:00:00Z" }) },
    live: "2026-11-07T12:34:00Z",
    outcomes: [{ conclusion: "failure", published: false }],
  });
  const request = w.env.request;
  let reads = 0;
  w.env.request = (async (input, init) => {
    if (String(input).startsWith("https://slop.cash/") && ++reads >= 2)
      return new Response(
        JSON.stringify({ generatedAt: "2026-11-19T12:00:00Z" }),
      );
    return request(input, init);
  }) as typeof fetch;
  expect(await followUp(w.env, 1)).toBe(0);
  expect(w.reruns).toEqual([]);
  expect(w.dispatched).toHaveLength(1);
});
