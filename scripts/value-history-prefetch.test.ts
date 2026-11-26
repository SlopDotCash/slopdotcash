// The read-ahead of first value-history pages only saves waiting. These cases
// hold it to the sequential reader: same requests, same results, same errors.
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { findRegisteredRepositoryById } from "../src/lib/repositories.mjs";
import {
  loadValueInputs,
  ValueFeedUnavailableError,
  type ValueInputProgress,
} from "./value-ingestion";

const registered = findRegisteredRepositoryById("SlopDotCash/asi");
if (!registered?.expectedNodeId) throw new Error("Missing registered fixture");
const nodeId = registered.expectedNodeId;
const route = `${registered.owner}/${registered.name}`;
const at = "2026-11-02T00:00:00.000Z";
const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

const outcome = (number: number, repository = route) => ({
  id: `PR_${number}`,
  number,
  url: `https://github.com/${repository}/pull/${number}`,
  headRefOid: number.toString(16).padStart(40, "0"),
  updatedAt: at,
  mergedAt: at,
});

// Pull requests 2 and 13 share one joint record with a member outside the
// census; every other pull request has no value history at all.
const JOINT = [2, 13];
const GONE = { id: "PR_gone", number: 99 };
const jointRecordJson = (
  members: readonly { id: string; number: number }[],
  supersedes: readonly string[] = [],
) =>
  JSON.stringify({
    schemaVersion: "slop-work-unit-record:v1",
    projectId: registered.projectId,
    sourceDigest: (supersedes.length ? "e" : "d").repeat(64),
    producerRevision: "a".repeat(40),
    assessedAt: at,
    sources: members.map((pull) => ({
      repository: registered.id,
      repositoryNodeId: nodeId,
      repositoryDatabaseId: 123,
      pullRequestNodeId: pull.id,
      pullRequestNumber: pull.number,
      headSha: "c".repeat(40),
      mergeSha: null,
      policySha: "a".repeat(40),
      sourceDigest: "b".repeat(64),
      occurredAt: at,
    })),
    claims: [],
    units: [],
    supersedes,
    legacyPredecessors: [],
    revisionReason: supersedes.length ? "reassessed" : null,
  });
const recordJson = JSON.stringify({
  schemaVersion: "slop-work-unit-record:v1",
  projectId: registered.projectId,
  sourceDigest: "d".repeat(64),
  producerRevision: "a".repeat(40),
  assessedAt: at,
  sources: [...JOINT.map((number) => outcome(number)), GONE].map((pull) => ({
    repository: registered.id,
    repositoryNodeId: nodeId,
    repositoryDatabaseId: 123,
    pullRequestNodeId: pull.id,
    pullRequestNumber: pull.number,
    headSha: "c".repeat(40),
    mergeSha: null,
    policySha: "a".repeat(40),
    sourceDigest: "b".repeat(64),
    occurredAt: at,
  })),
  claims: [],
  units: [],
  supersedes: [],
  legacyPredecessors: [],
  revisionReason: null,
});
const recordDigest = sha256(recordJson);
const NUMBERS = Array.from({ length: 14 }, (_, index) => index + 1);
const outcomes = NUMBERS.map((number) => outcome(number));

const jointUrl = (pull: number, after = 0, through?: number) =>
  `/v1/work-unit-assessments?repositoryNodeId=${nodeId}&pull=${pull}&after=${after}${
    through === undefined ? "" : `&through=${through}`
  }`;
const singleUrl = (pull: number) =>
  `/v1/value-assessments?repositoryNodeId=${nodeId}&pull=${pull}&after=0`;
/** The requests of the sequential reader, in its order. */
const SEQUENTIAL = NUMBERS.flatMap((number) =>
  JOINT.includes(number)
    ? [jointUrl(number), jointUrl(number, 1, 1)]
    : [jointUrl(number), singleUrl(number)],
);

type Fault = { url: string; status: number; times: number };
/**
 * The hosted feed changes the history of one pull request once the loop has
 * finished `at` outcomes. `before` and `after` answer that pull request's
 * first page of the named history; null means the ordinary answer.
 */
type Change = {
  at: number;
  pull: number;
  history: "joint" | "single";
  before: object | null;
  after: object;
};
/** Outcomes the loop had finished, as last reported by its progress. */
let loopCompleted = -1;

function feed(fault?: Fault, change?: Change) {
  const requests: string[] = [];
  const firstReads: { pull: number; history: string; completed: number }[] = [];
  let active = 0;
  let mostActive = 0;
  let remaining = fault?.times ?? 0;
  const read = async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://slopbot.slop.cash");
    const request = url.pathname + url.search;
    requests.push(request);
    active += 1;
    mostActive = Math.max(mostActive, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 2));
      if (fault && request === fault.url && remaining > 0) {
        remaining -= 1;
        return new Response("fixture fault", { status: fault.status });
      }
      const pull = Number(url.searchParams.get("pull"));
      const identity = {
        repository: registered?.id,
        repositoryNodeId: url.searchParams.get("repositoryNodeId"),
        pullRequestNumber: pull,
      };
      const history =
        url.pathname === "/v1/value-assessments" ? "single" : "joint";
      if (url.searchParams.get("after") === "0")
        firstReads.push({ pull, history, completed: loopCompleted });
      if (change && pull === change.pull && history === change.history) {
        const answer =
          loopCompleted >= change.at ? change.after : change.before;
        if (answer) return Response.json({ ...identity, ...answer });
      }
      if (url.pathname === "/v1/value-assessments")
        return Response.json({
          ...identity,
          schemaVersion: "slop-value-history:v1",
          records: [],
          nextAfter: null,
        });
      const joint = JOINT.includes(pull);
      const first = url.searchParams.get("after") === "0";
      // The joint history spans two pages, so its second page is always live.
      return Response.json({
        ...identity,
        schemaVersion: "slop-work-unit-history:v1",
        throughSequence: joint ? 1 : 0,
        totalRecords: joint ? 1 : 0,
        nextAfter: joint && first ? 1 : null,
        records:
          joint && first
            ? [
                {
                  sequence: 1,
                  record_digest: recordDigest,
                  record_json: recordJson,
                  recorded_at: at,
                },
              ]
            : [],
      });
    } finally {
      active -= 1;
    }
  };
  return {
    requests,
    firstReads,
    mostActive: () => mostActive,
    transport: Object.assign(read, { preconnect: fetch.preconnect }),
  };
}

function github(failFirstRepositoryRead = false) {
  const reads: string[] = [];
  const refuse = async (): Promise<never> => {
    throw new Error("The history fixture needs no other GitHub read");
  };
  return {
    reads,
    client: {
      async get<T>(path: string): Promise<T | null> {
        reads.push(path);
        if (path !== `/repos/${route}`) return refuse();
        if (failFirstRepositoryRead && reads.length === 1)
          throw new Error("Fixture GitHub transport unavailable");
        return { id: 123, node_id: nodeId, private: false } as T;
      },
      graphql: refuse,
      fileText: refuse,
    },
  };
}

async function collect(
  concurrency: number | undefined,
  options: {
    fault?: Fault;
    sources?: Parameters<typeof loadValueInputs>[1];
    failFirstRepositoryRead?: boolean;
    change?: Change;
    /** Holds the loop at each joint record, as a slow source read would. */
    slowLoopMs?: number;
  } = {},
) {
  loopCompleted = -1;
  const hosted = feed(options.fault, options.change);
  const source = github(options.failFirstRepositoryRead);
  const progress: ValueInputProgress[] = [];
  const probes: (readonly string[])[] = [];
  let result: Awaited<ReturnType<typeof loadValueInputs>> | null = null;
  let error: unknown = null;
  try {
    result = await loadValueInputs(
      source.client,
      options.sources ?? outcomes,
      hosted.transport,
      async (ids) => {
        probes.push(ids);
        if (options.slowLoopMs)
          await new Promise((resolve) =>
            setTimeout(resolve, options.slowLoopMs),
          );
        return ids.filter((id) => id.startsWith(GONE.id));
      },
      [],
      (entry) => {
        progress.push(entry);
        if (entry.phase === "value-histories") loopCompleted = entry.completed;
      },
      undefined,
      concurrency,
    );
  } catch (caught) {
    error = caught;
  }
  return { ...hosted, github: source.reads, progress, probes, result, error };
}

let warn: ReturnType<typeof spyOn<Console, "warn">>;
let previous: string | undefined;
beforeEach(() => {
  previous = process.env.SLOP_VALUE_FEED_CONCURRENCY;
  delete process.env.SLOP_VALUE_FEED_CONCURRENCY;
  warn = spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  if (previous === undefined) delete process.env.SLOP_VALUE_FEED_CONCURRENCY;
  else process.env.SLOP_VALUE_FEED_CONCURRENCY = previous;
  warn.mockRestore();
});
const warmedLines = () =>
  warn.mock.calls
    .map(([line]) => JSON.parse(String(line)))
    .filter((line) => line.event === "value_history_first_pages_warmed");

test("one read at a time makes the sequential requests in the sequential order", async () => {
  for (const concurrency of [1, undefined]) {
    const run = await collect(concurrency);
    expect(run.error).toBeNull();
    expect(run.requests).toEqual(SEQUENTIAL);
    expect(run.mostActive()).toBe(1);
    expect(run.github).toEqual([`/repos/${route}`]);
  }
  expect(warmedLines()).toEqual([]);
});

test("six reads at a time return what one read at a time returns", async () => {
  const one = await collect(1);
  const six = await collect(6);
  expect(one.error).toBeNull();
  expect(six.error).toBeNull();
  expect(six.result).toEqual(one.result);
  expect(six.progress).toEqual(one.progress);
  expect(six.probes).toEqual(one.probes);
  expect(six.github).toEqual(one.github);

  const decisions = six.result?.valueDecisions;
  expect(decisions?.size).toBe(NUMBERS.length - JOINT.length);
  expect(decisions?.get("PR_1")).toEqual({
    status: "missing",
    history: [],
    latestDigest: null,
    implementationActorNodeIds: [],
  });
  const held = six.result?.jointValueDecisions.get("PR_2");
  expect(held).toMatchObject({
    status: "unresolved",
    sourceUnavailable: true,
    latestDigest: recordDigest,
  });
  expect(six.result?.jointValueDecisions.get("PR_13")).toBe(held as never);
  expect(six.result?.heldWorkUnits).toEqual([
    {
      recordDigest,
      sourceNodeIds: ["PR_13", "PR_2", GONE.id],
      unavailableNodeIds: [GONE.id],
    },
  ]);
  // The member outside the census is probed once for the shared record.
  expect(six.probes).toEqual([[GONE.id]]);

  // An empty first page read ahead is never read again. A first page with
  // records (pull requests 2 and 13) is read again in the loop's own turn,
  // and the second joint page is never read ahead.
  expect([...six.requests].sort()).toEqual(
    [...SEQUENTIAL, ...JOINT.map((pull) => jointUrl(pull))].sort(),
  );
  // The read-ahead now runs beside the loop, so it may still read the first
  // page of pull request 14 after the loop's own second page of 13.
  for (const pull of JOINT)
    expect(six.requests.indexOf(jointUrl(pull, 1, 1))).toBeGreaterThan(
      six.requests.indexOf(jointUrl(pull)),
    );
  expect(warmedLines()).toEqual([
    {
      event: "value_history_first_pages_warmed",
      concurrency: 6,
      window: 12,
      outcomes: NUMBERS.length,
      unresolved: 0,
      pages: NUMBERS.length * 2 - JOINT.length,
    },
  ]);
});

test("the read-ahead keeps several reads in flight and never more than its limit", async () => {
  for (const concurrency of [2, 6, 16]) {
    const run = await collect(concurrency);
    expect(run.error).toBeNull();
    expect(run.mostActive()).toBe(Math.min(concurrency, NUMBERS.length));
  }
  process.env.SLOP_VALUE_FEED_CONCURRENCY = "6";
  expect((await collect(undefined)).mostActive()).toBe(6);
  for (const unset of ["", " ", "1"]) {
    process.env.SLOP_VALUE_FEED_CONCURRENCY = unset;
    const run = await collect(undefined);
    expect(run.mostActive()).toBe(1);
    expect(run.requests).toEqual(SEQUENTIAL);
  }
});

test("an invalid concurrency stops before any read", async () => {
  for (const invalid of ["0", "17", "six", "1.5", "-2", "006x"]) {
    process.env.SLOP_VALUE_FEED_CONCURRENCY = invalid;
    const run = await collect(undefined);
    expect(String(run.error)).toContain(
      "SLOP_VALUE_FEED_CONCURRENCY is invalid",
    );
    expect(run.requests).toEqual([]);
    expect(run.github).toEqual([]);
  }
  delete process.env.SLOP_VALUE_FEED_CONCURRENCY;
  for (const invalid of [0, 17, 1.5, Number.NaN]) {
    const run = await collect(invalid);
    expect(String(run.error)).toContain(
      "SLOP_VALUE_FEED_CONCURRENCY is invalid",
    );
    expect(run.requests).toEqual([]);
  }
});

for (const [kind, url] of [
  ["joint", jointUrl(4)],
  ["single", singleUrl(4)],
  ["shared joint", jointUrl(2)],
] as const)
  test(`a ${kind} page that fails while read ahead is read again by the loop`, async () => {
    const clean = await collect(1);
    const run = await collect(6, { fault: { url, status: 503, times: 1 } });
    expect(run.error).toBeNull();
    expect(run.result).toEqual(clean.result);
    expect(run.progress).toEqual(clean.progress);
    // The failed read and the loop's own read of the same page.
    expect(run.requests.filter((request) => request === url)).toHaveLength(2);
    // No empty page that was read ahead successfully is read twice; a first
    // page with records is read again by the loop at most once.
    for (const request of new Set(run.requests))
      if (request !== url)
        expect(
          run.requests.filter((other) => other === request).length,
        ).toBeLessThanOrEqual(
          JOINT.some((pull) => request === jointUrl(pull)) ? 2 : 1,
        );
    expect(new Set(run.requests)).toEqual(new Set(SEQUENTIAL));
    // The dropped read is logged, not silently swallowed.
    expect(warmedLines().at(-1)?.dropped).toEqual({
      outcome: Number(new URL(url, "https://x").searchParams.get("pull")) - 1,
      error: "ValueFeedUnavailableError",
    });
  });

for (const [kind, url, status, message] of [
  ["outage", jointUrl(4), 503, "The hosted value feed is unavailable"],
  ["outage", singleUrl(4), 503, "The hosted value feed is unavailable"],
  ["refusal", jointUrl(4), 400, "Authoritative value history is unavailable"],
  ["refusal", singleUrl(4), 403, "Authoritative value history is unavailable"],
] as const)
  test(`a lasting ${kind} of ${url.split("?")[0]} surfaces from the loop as without read-ahead`, async () => {
    const fault = { url, status, times: Number.POSITIVE_INFINITY };
    const one = await collect(1, { fault });
    const six = await collect(6, { fault });
    expect(one.result).toBeNull();
    expect(six.result).toBeNull();
    expect((six.error as Error).message).toBe(message);
    expect((six.error as Error).message).toBe((one.error as Error).message);
    expect(six.error instanceof ValueFeedUnavailableError).toBe(status === 503);
    expect(one.error instanceof ValueFeedUnavailableError).toBe(status === 503);
    // The same outcomes were finished before the failure, in the same order.
    expect(six.progress).toEqual(one.progress);
    expect(six.progress.at(-1)).toEqual({
      phase: "value-histories",
      completed: 3,
      total: NUMBERS.length,
    });
    expect(six.probes).toEqual(one.probes);
    // The loop made the failing read itself, after the read-ahead dropped it.
    expect(six.requests.filter((request) => request === url)).toHaveLength(2);
    expect(six.requests.at(-1)).toBe(url);
    // A failed read ends the read-ahead: the last outcome was never reached.
    expect(six.requests).not.toContain(jointUrl(NUMBERS.length));
    expect(six.mostActive()).toBeLessThanOrEqual(6);
  });

test("a repository the read-ahead cannot resolve is left to the loop", async () => {
  const clean = await collect(1);
  const run = await collect(6, { failFirstRepositoryRead: true });
  expect(run.error).toBeNull();
  expect(run.result).toEqual(clean.result);
  // Nothing was read ahead, so the loop read every page itself, in order.
  expect(run.github).toEqual([`/repos/${route}`, `/repos/${route}`]);
  expect(run.requests).toEqual(SEQUENTIAL);
  expect(run.mostActive()).toBe(1);

  const sources = [
    outcome(1),
    outcome(3),
    // Closed without a merge, so only the history loop resolves its repository.
    { ...outcome(5, "Example/unregistered"), mergedAt: null, closedAt: at },
    outcome(6),
  ];
  const one = await collect(1, { sources });
  const six = await collect(6, { sources });
  expect((six.error as Error).message).toBe(
    "Value outcome repository is not registered",
  );
  expect((six.error as Error).message).toBe((one.error as Error).message);
  expect(six.progress).toEqual(one.progress);
  expect(six.progress.at(-1)?.completed).toBe(2);
  expect(one.requests).toEqual([
    jointUrl(1),
    singleUrl(1),
    jointUrl(3),
    singleUrl(3),
  ]);
  // The outcomes of the registered repository were still read ahead.
  expect([...six.requests].sort()).toEqual(
    [...one.requests, jointUrl(6), singleUrl(6)].sort(),
  );
});

// The hosted feed keeps changing while a collection runs. A first page read
// ahead must not be older than the window in front of the loop, or a record
// published or replaced after the read-ahead is missed for the whole loop.
const LONG = Array.from({ length: 40 }, (_, index) => outcome(index + 1));
// The change lands 20 outcomes before LATE: outside the read-ahead window of
// concurrency 2 (4 outcomes) and 6 (12, the release setting), and inside the
// window of 16 (32), where only a replaced record is decided as without
// read-ahead, because a page with records is always read again by the loop.
const LATE = 40;
const CHANGE_AT = 19;
const jointRow = (sequence: number, json: string) => ({
  sequence,
  record_digest: sha256(json),
  record_json: json,
  recorded_at: at,
});
const lateMembers = [
  { id: `PR_${LATE}`, number: LATE },
  { id: `${GONE.id}_late`, number: 98 },
];
const lateA = jointRecordJson(lateMembers);
const lateB = jointRecordJson(lateMembers, [sha256(lateA)]);
const jointPage = (rows: ReturnType<typeof jointRow>[]) => ({
  schemaVersion: "slop-work-unit-history:v1",
  throughSequence: rows.at(-1)?.sequence ?? 0,
  totalRecords: rows.length,
  nextAfter: null,
  records: rows,
});
const singlePage = (digest: string) => ({
  schemaVersion: "slop-value-history:v1",
  nextAfter: null,
  records: [
    { sequence: 7, record_digest: digest, record_json: "{}", recorded_at: at },
  ],
});

for (const [kind, change, digest] of [
  [
    "published",
    { before: null, after: jointPage([jointRow(5, lateA)]) },
    sha256(lateA),
  ],
  [
    "replaced",
    {
      before: jointPage([jointRow(5, lateA)]),
      after: jointPage([jointRow(5, lateA), jointRow(6, lateB)]),
    },
    sha256(lateB),
  ],
] as const)
  test(`a joint record ${kind} after the read-ahead started is read as the loop finds it`, async () => {
    const options = {
      sources: LONG,
      slowLoopMs: 60,
      change: {
        at: CHANGE_AT,
        pull: LATE,
        history: "joint" as const,
        ...change,
      },
    };
    const one = await collect(1, options);
    expect(one.error).toBeNull();
    expect(one.result?.jointValueDecisions.get(`PR_${LATE}`)).toMatchObject({
      status: "unresolved",
      sourceUnavailable: true,
      latestDigest: digest,
    });
    for (const concurrency of kind === "replaced" ? [2, 6, 16] : [2, 6]) {
      const run = await collect(concurrency, options);
      expect(run.error).toBeNull();
      expect(run.result).toEqual(one.result);
      expect(run.probes).toEqual(one.probes);
      expect(run.result?.valueDecisions.has(`PR_${LATE}`)).toBe(false);
    }
  });

for (const [kind, before] of [
  ["published", null],
  ["replaced", singlePage("e".repeat(64))],
] as const)
  test(`a single record ${kind} after the read-ahead started is read as the loop finds it`, async () => {
    const options = {
      sources: LONG,
      slowLoopMs: 60,
      change: {
        at: CHANGE_AT,
        pull: LATE,
        history: "single" as const,
        before,
        after: singlePage("f".repeat(64)),
      },
    };
    const one = await collect(1, options);
    // A current record makes the loop collect its source, which this
    // fixture refuses: the read that found the record is what is compared.
    expect((one.error as Error).message).toBe(
      "The history fixture needs no other GitHub read",
    );
    for (const concurrency of kind === "replaced" ? [2, 6, 16] : [2, 6]) {
      const run = await collect(concurrency, options);
      expect(run.error).toEqual(one.error);
      expect(run.github).toEqual(one.github);
      expect(run.progress).toEqual(one.progress);
      const late = run.firstReads.filter(
        (read) => read.pull === LATE && read.history === "single",
      );
      // The loop decides from its last read of that page.
      expect(late.at(-1)?.completed).toBeGreaterThanOrEqual(CHANGE_AT);
    }
  });

test("no first page is read more than twice the concurrency ahead of the loop", async () => {
  for (const concurrency of [2, 6, 16]) {
    const run = await collect(concurrency, { sources: LONG, slowLoopMs: 60 });
    expect(run.error).toBeNull();
    expect(run.firstReads.length).toBeGreaterThan(LONG.length);
    for (const read of run.firstReads)
      expect(read.completed).toBeGreaterThanOrEqual(
        read.pull - 1 - 2 * concurrency,
      );
    expect(run.mostActive()).toBe(concurrency);
  }
});
