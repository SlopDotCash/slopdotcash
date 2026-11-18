import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import {
  assertMaintainerShare,
  assertMaintainerShareHistory,
  maintainerShareBasisPoints,
  maintainerShareCardLine,
  maintainerShareLabel,
  maintainerShareNotice,
  prospectiveMaintainerShare,
} from "../src/lib/maintainer-share.mjs";
import {
  assertMaintainerDecisionRecord,
  type MaintainerDecision,
  type MaintainerDecisionRecord,
  maintainerShare,
} from "../src/lib/payments/maintainer-share";
import { fixtureProject } from "../tests/fixture-overlay.mjs";
import { sqliteD1 } from "../tests/sqlite-d1";
import {
  collectMaintainerDecisions,
  DECISIONS_QUERY,
  githubGraphql,
  maintainerDecisionBytes,
} from "./maintainer-decisions";
import { buildMonthlyBase, monthlyBasesSql } from "./prepare-monthly-rewards";

const snapshotBytes = gunzipSync(
  readFileSync(
    "tests/fixtures/history/cycles/eliza/2026-09/source-snapshot.json.gz",
  ),
);
const SEPTEMBER = "2026-09";
const GENERATED_AT = "2026-10-01T00:00:00.000Z";

/** GitHub's legacy node ID of a numeric user ID. */
const nodeId = (id: string) => btoa(`04:User${id}`);

function decision(
  number: number,
  githubUserId: string,
  login: string,
  fields: Partial<MaintainerDecision> = {},
): MaintainerDecision {
  return {
    repository: "elizaOS/eliza",
    number,
    outcome: "merged",
    decidedAt: "2026-09-10T12:00:00.000Z",
    author: "outside-author",
    githubUserId,
    nodeId: nodeId(githubUserId),
    login,
    ...fields,
  };
}

function record(decisions: MaintainerDecision[]): MaintainerDecisionRecord {
  return {
    schemaVersion: "1",
    projectId: "eliza",
    period: SEPTEMBER,
    repositories: ["elizaOS/eliza"],
    decisions,
  };
}

/** The fixture's funded September project, with an owner-set share. */
function sharedProject(basisPoints: number) {
  const project = fixtureProject("eliza");
  project.reward.feeBasisPoints = 200;
  project.escrow = {
    schemaVersion: "1",
    effectiveCycle: SEPTEMBER,
    chain: "solana",
    feeBasisPoints: 200,
    withdrawalFeeBasisPoints: 200,
    feeMode: "deduct-from-gross",
    deployments: [],
  };
  if (basisPoints > 0) project.reward.maintainerShare = basisPoints;
  return project;
}

const total = (rows: readonly { grossBase: string }[]) =>
  rows.reduce((sum, row) => sum + BigInt(row.grossBase), 0n);

test("the setting is 1 to 3000 basis points and a month keeps the share it had", () => {
  for (const valid of [1, 2000, 3000]) assertMaintainerShare(valid, "share");
  for (const invalid of [0, 3001, 12.5, "2000", null])
    expect(() => assertMaintainerShare(invalid, "share")).toThrow();
  assertMaintainerShareHistory(
    [
      { throughCycle: "2026-10", basisPoints: 0 },
      { throughCycle: "2026-12", basisPoints: 3000 },
    ],
    "history",
  );
  for (const invalid of [
    [],
    [{ throughCycle: "2026-13", basisPoints: 0 }],
    [{ throughCycle: "2026-10", basisPoints: 3001 }],
    [
      { throughCycle: "2026-10", basisPoints: 0 },
      { throughCycle: "2026-10", basisPoints: 100 },
    ],
    [{ throughCycle: "2026-10", basisPoints: 0, extra: true }],
  ])
    expect(() => assertMaintainerShareHistory(invalid, "history")).toThrow();

  const reward = {
    kind: "monthly-pool",
    maintainerShare: 1000,
    maintainerShareHistory: [
      { throughCycle: "2026-10", basisPoints: 0 },
      { throughCycle: "2026-12", basisPoints: 2000 },
    ],
  };
  expect(maintainerShareBasisPoints({ reward }, "2026-09")).toBe(0);
  expect(maintainerShareBasisPoints({ reward }, "2026-10")).toBe(0);
  expect(maintainerShareBasisPoints({ reward }, "2026-11")).toBe(2000);
  expect(maintainerShareBasisPoints({ reward }, "2026-12")).toBe(2000);
  expect(maintainerShareBasisPoints({ reward }, "2027-01")).toBe(1000);
  expect(
    maintainerShareBasisPoints(
      { reward: { kind: "external-prize-share", maintainerShare: 1000 } },
      "2027-01",
    ),
  ).toBe(0);

  // A change during December keeps December and earlier as they were.
  const changed = prospectiveMaintainerShare(
    { kind: "monthly-pool", maintainerShare: 2000 },
    { kind: "monthly-pool", maintainerShare: 3000 },
    "2026-12",
  );
  expect(changed.maintainerShareHistory).toEqual([
    { throughCycle: "2026-12", basisPoints: 2000 },
  ]);
  expect(maintainerShareBasisPoints({ reward: changed }, "2026-12")).toBe(2000);
  expect(maintainerShareBasisPoints({ reward: changed }, "2027-01")).toBe(3000);
  // Removing the share is a change like any other.
  const removed = prospectiveMaintainerShare(
    changed,
    { kind: "monthly-pool" },
    "2027-02",
  );
  expect(maintainerShareBasisPoints({ reward: removed }, "2027-02")).toBe(3000);
  expect(maintainerShareBasisPoints({ reward: removed }, "2027-03")).toBe(0);
  expect(maintainerShareLabel(2000)).toBe("20%");
  expect(maintainerShareLabel(1250)).toBe("12.5%");
  expect(maintainerShareLabel(undefined)).toBe("None");
});

test("public lines name this month's share and a pending change", () => {
  const now = new Date("2026-11-18T10:00:00.000Z");
  const pool = { kind: "monthly-pool", monthlyCapMinor: "250000000" };
  expect(maintainerShareNotice({ reward: pool }, now)).toBeNull();
  expect(maintainerShareCardLine({ reward: pool }, now)).toBeNull();
  const steady = { reward: { ...pool, maintainerShare: 2000 } };
  expect(maintainerShareNotice(steady, now)).toBe(
    "Maintainer share: 20% of the monthly amount, split among the maintainers who merge or close outside pull requests.",
  );
  expect(maintainerShareCardLine(steady, now)).toBe("Maintainer share 20%");
  const pending = {
    reward: {
      ...pool,
      maintainerShare: 2000,
      maintainerShareHistory: [{ throughCycle: "2026-11", basisPoints: 0 }],
    },
  };
  expect(maintainerShareNotice(pending, now)).toBe(
    "Maintainer share: none of the monthly amount this month, 20% from December, split among the maintainers who merge or close outside pull requests.",
  );
  expect(maintainerShareCardLine(pending, now)).toBe(
    "Maintainer share 20% from December",
  );
  // No monthly amount means nothing to take a share of.
  expect(
    maintainerShareNotice(
      { reward: { ...steady.reward, monthlyCapMinor: "0" } },
      now,
    ),
  ).toBeNull();
});

test("the share is split by decisions, never exceeds its part, and skips excluded accounts", () => {
  const decisions = [
    decision(1, "11", "ana"),
    decision(2, "11", "ana", { outcome: "closed" }),
    decision(3, "11", "ana"),
    decision(4, "22", "ben", { outcome: "closed" }),
  ];
  const none = new Set<string>();
  const split = maintainerShare({
    cap: 1_000n,
    basisPoints: 2000,
    decisions,
    excludedGithubUserIds: none,
  });
  expect(split.pool).toBe(200n);
  expect(
    split.rows.map((row) => [row.login, row.decisions, row.amount]),
  ).toEqual([
    ["ana", 3, 150n],
    ["ben", 1, 50n],
  ]);
  // An indivisible share goes out whole; the leftover unit goes to the
  // largest remainder, and equal remainders to the lower account ID.
  const uneven = maintainerShare({
    cap: 1_000n,
    basisPoints: 1000,
    decisions: [
      decision(1, "9", "low"),
      decision(2, "10", "mid"),
      decision(3, "300", "high"),
    ],
    excludedGithubUserIds: none,
  });
  expect(uneven.pool).toBe(100n);
  expect(uneven.rows.map((row) => [row.login, row.amount])).toEqual([
    ["low", 34n],
    ["mid", 33n],
    ["high", 33n],
  ]);
  // An excluded account's decisions leave the split.
  const excluded = maintainerShare({
    cap: 1_000n,
    basisPoints: 2000,
    decisions,
    excludedGithubUserIds: new Set(["11"]),
  });
  expect(excluded.rows.map((row) => [row.login, row.amount])).toEqual([
    ["ben", 200n],
  ]);
  // No counted decision: no share, the whole amount stays with contributors.
  for (const empty of [
    { decisions: [], excludedGithubUserIds: none },
    { decisions, excludedGithubUserIds: new Set(["11", "22"]) },
  ])
    expect(
      maintainerShare({ cap: 1_000n, basisPoints: 3000, ...empty }),
    ).toEqual({ pool: 0n, rows: [] });
  expect(
    maintainerShare({
      cap: 1_000n,
      basisPoints: 0,
      decisions,
      excludedGithubUserIds: none,
    }).pool,
  ).toBe(0n);
  expect(() =>
    maintainerShare({
      cap: 1_000n,
      basisPoints: 3001,
      decisions,
      excludedGithubUserIds: none,
    }),
  ).toThrow();
});

test("a decision record is refused unless every decision is inside the month, unique and by another account", () => {
  const valid = record([decision(1, "11", "ana"), decision(2, "22", "ben")]);
  assertMaintainerDecisionRecord(valid, "eliza", SEPTEMBER);
  for (const invalid of [
    { ...valid, projectId: "asi" },
    { ...valid, period: "2026-10" },
    { ...valid, repositories: [] },
    record([decision(1, "11", "ana"), decision(1, "22", "ben")]),
    record([
      decision(1, "11", "ana", { decidedAt: "2026-10-01T00:00:00.000Z" }),
    ]),
    record([
      decision(1, "11", "ana", { decidedAt: "2026-08-31T23:59:59.999Z" }),
    ]),
    record([decision(1, "11", "ana", { author: "Ana" })]),
    record([decision(1, "11", "ana", { nodeId: nodeId("12") })]),
    record([decision(1, "11", "ana", { repository: "other/repo" })]),
    record([
      { ...decision(1, "11", "ana"), amount: "5" } as MaintainerDecision,
    ]),
  ])
    expect(() =>
      assertMaintainerDecisionRecord(invalid, "eliza", SEPTEMBER),
    ).toThrow();
});

type PullNode = Record<string, unknown>;
const user = (id: number, login: string) => ({
  __typename: "User",
  login,
  id: nodeId(String(id)),
  databaseId: id,
});
function pull(number: number, fields: PullNode): PullNode {
  return {
    number,
    updatedAt: "2026-09-20T00:00:00Z",
    closedAt: "2026-09-10T12:00:00Z",
    mergedAt: null,
    authorAssociation: "CONTRIBUTOR",
    author: { __typename: "User", login: "outside-author" },
    mergedBy: null,
    timelineItems: { nodes: [] },
    ...fields,
  };
}
const closedBy = (actor: unknown, at = "2026-09-10T12:00:00Z") => ({
  closedAt: at,
  timelineItems: { nodes: [{ createdAt: at, actor }] },
});
const mergedBy = (actor: unknown, at = "2026-09-10T12:00:00Z") => ({
  closedAt: at,
  mergedAt: at,
  mergedBy: actor,
});

test("the read counts only outside pull requests merged or closed in the month by another user", async () => {
  const project = sharedProject(2000);
  const pages: PullNode[][] = [
    [
      // Updated after the month but decided in it: counted.
      pull(10, {
        updatedAt: "2026-10-01T05:00:00Z",
        ...mergedBy(user(11, "ana")),
      }),
      // Decided after the month ended.
      pull(11, mergedBy(user(11, "ana"), "2026-10-01T00:00:00Z")),
      pull(12, closedBy(user(22, "ben"))),
      // The author's own close is not a decision.
      pull(
        13,
        closedBy({
          __typename: "User",
          login: "Outside-Author",
          id: nodeId("5"),
          databaseId: 5,
        }),
      ),
      // A bot's close (Slopbot included) is not a decision.
      pull(14, closedBy({ __typename: "Bot", login: "slopdotcash" })),
      // A maintainer's or a bot's own pull request is not outside work.
      pull(15, { authorAssociation: "MEMBER", ...mergedBy(user(11, "ana")) }),
      pull(16, {
        author: { __typename: "Bot", login: "dependabot" },
        ...mergedBy(user(11, "ana")),
      }),
    ],
    [
      // The same pull request can repeat on the next page; it counts once.
      pull(12, closedBy(user(22, "ben"))),
      // A deleted author still leaves a decision.
      pull(17, { author: null, ...mergedBy(user(11, "ana")) }),
      // The closing actor is gone: nobody to credit.
      pull(18, closedBy(null)),
      // Last updated before the month: the read ends here.
      pull(19, {
        updatedAt: "2026-08-31T23:00:00Z",
        ...mergedBy(user(11, "ana"), "2026-08-30T00:00:00Z"),
      }),
      pull(20, mergedBy(user(33, "cal"))),
    ],
    [pull(21, mergedBy(user(33, "cal")))],
  ];
  const requests: Record<string, unknown>[] = [];
  const graphql = async (query: string, variables: Record<string, unknown>) => {
    expect(query).toBe(DECISIONS_QUERY);
    requests.push(variables);
    const index = requests.length - 1;
    return {
      repository: {
        id: project.authority.repositoryNodeId,
        pullRequests: {
          pageInfo: {
            hasNextPage: index < pages.length - 1,
            endCursor: `cursor-${index}`,
          },
          nodes: pages[index],
        },
      },
    };
  };
  const collected = await collectMaintainerDecisions(
    project,
    SEPTEMBER,
    graphql,
  );
  expect(requests).toEqual([
    { owner: "elizaOS", name: "eliza", first: 50, after: null },
    { owner: "elizaOS", name: "eliza", first: 50, after: "cursor-0" },
  ]);
  expect(collected.repositories).toEqual(["elizaOS/eliza"]);
  expect(
    collected.decisions.map((entry) => [
      entry.number,
      entry.outcome,
      entry.login,
      entry.author,
    ]),
  ).toEqual([
    [10, "merged", "ana", "outside-author"],
    [12, "closed", "ben", "outside-author"],
    [17, "merged", "ana", "ghost"],
  ]);
  // Another repository under the registered name is refused, as is a
  // malformed answer: a month is never split from a partial record.
  await expect(
    collectMaintainerDecisions(project, SEPTEMBER, async () => ({
      repository: {
        id: "R_other",
        pullRequests: { pageInfo: { hasNextPage: false }, nodes: [] },
      },
    })),
  ).rejects.toThrow("not the registered repository");
  await expect(
    collectMaintainerDecisions(project, SEPTEMBER, async () => ({
      repository: {
        id: project.authority.repositoryNodeId,
        pullRequests: { pageInfo: { hasNextPage: false } },
      },
    })),
  ).rejects.toThrow();
  await expect(
    collectMaintainerDecisions(project, SEPTEMBER, async () => {
      throw new Error("GitHub maintainer decision read failed: HTTP 502");
    }),
  ).rejects.toThrow("HTTP 502");
});

test("the GitHub reader retries a refused answer and never returns a GraphQL error as data", async () => {
  const answers = [
    new Response("busy", { status: 502 }),
    new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
  ];
  const waits: number[] = [];
  const read = githubGraphql("token", {
    fetch: (async () => answers.shift() as Response) as unknown as typeof fetch,
    wait: async (milliseconds) => {
      waits.push(milliseconds);
    },
  });
  expect(await read("query", {})).toEqual({ ok: true });
  expect(waits).toEqual([2000]);
  const refused = githubGraphql("token", {
    fetch: (async () =>
      new Response(JSON.stringify({ data: {}, errors: [{ message: "no" }] }), {
        status: 200,
      })) as unknown as typeof fetch,
  });
  await expect(refused("query", {})).rejects.toThrow("refused");
  const down = githubGraphql("token", {
    attempts: 2,
    fetch: (async () =>
      new Response("limited", { status: 403 })) as unknown as typeof fetch,
    wait: async () => {},
  });
  await expect(down("query", {})).rejects.toThrow("HTTP 403");
  expect(() => githubGraphql("")).toThrow();
});

test("a month with a maintainer share distributes exactly its amount and stores the record once", async () => {
  const plain = sharedProject(0);
  const plainBytes = Buffer.from(JSON.stringify(plain));
  const input = {
    projectId: "eliza",
    period: SEPTEMBER,
    generatedAt: GENERATED_AT,
  };
  const without = buildMonthlyBase(input, snapshotBytes, plainBytes);
  expect(without.maintainerShare).toBeUndefined();
  const cap = BigInt(without.capBase);
  expect(cap).toBe(5_000_000_000n);
  expect(total(without.rows)).toBe(cap);

  const project = sharedProject(2000);
  const policyBytes = Buffer.from(JSON.stringify(project));
  // One maintainer also has a points share; the other only decided.
  const scorer = without.rows.find((row) => BigInt(row.grossBase) > 0n);
  if (!scorer) throw new Error("fixture needs a scored contributor");
  const outsider = "987654321";
  expect(without.rows.some((row) => row.githubUserId === outsider)).toBe(false);
  const decisions = record([
    decision(1, scorer.githubUserId, scorer.login),
    decision(2, outsider, "only-maintains", { outcome: "closed" }),
    decision(3, outsider, "only-maintains"),
    decision(4, outsider, "only-maintains"),
  ]);
  const decisionBytes = maintainerDecisionBytes(decisions);
  const base = buildMonthlyBase(
    input,
    snapshotBytes,
    policyBytes,
    decisionBytes,
  );
  // 20% of the amount leaves before the points split; the total is unchanged.
  expect(base.capBase).toBe(without.capBase);
  expect(total(base.rows)).toBe(cap);
  expect(base.maintainerShare).toMatchObject({
    basisPoints: 2000,
    poolBase: "1000000000",
    rows: [
      {
        githubUserId: scorer.githubUserId,
        decisions: 1,
        grossBase: "250000000",
      },
      { githubUserId: outsider, decisions: 3, grossBase: "750000000" },
    ].sort(
      (left, right) =>
        left.githubUserId.length - right.githubUserId.length ||
        left.githubUserId.localeCompare(right.githubUserId),
    ),
  });
  expect(base.rows).toHaveLength(without.rows.length + 1);
  expect(
    base.rows.find((row) => row.githubUserId === outsider)?.grossBase,
  ).toBe("750000000");
  // The scorer has one row: a points share of the remaining 80% plus the
  // maintainer part.
  const combined = BigInt(
    base.rows.find((row) => row.githubUserId === scorer.githubUserId)
      ?.grossBase ?? "0",
  );
  expect(combined).toBeGreaterThan(250_000_000n);
  expect(combined).toBeLessThan(BigInt(scorer.grossBase) + 250_000_000n);
  // Every other contributor's amount only shrinks.
  for (const row of without.rows) {
    if (row.githubUserId === scorer.githubUserId) continue;
    const after = base.rows.find(
      (entry) => entry.githubUserId === row.githubUserId,
    );
    expect(BigInt(after?.grossBase ?? "-1")).toBeLessThanOrEqual(
      BigInt(row.grossBase),
    );
  }

  // No decided outside pull request: the month is the plain points split.
  const quiet = buildMonthlyBase(
    input,
    snapshotBytes,
    policyBytes,
    maintainerDecisionBytes(record([])),
  );
  expect(quiet.rows.map((row) => row.grossBase)).toEqual(
    without.rows.map((row) => row.grossBase),
  );
  expect(quiet.maintainerShare).toMatchObject({ poolBase: "0", rows: [] });

  // The record is required exactly when the revision sets a share, and it
  // must cover the project's repositories.
  expect(() => buildMonthlyBase(input, snapshotBytes, policyBytes)).toThrow(
    "needs its maintainer decision record",
  );
  expect(() =>
    buildMonthlyBase(input, snapshotBytes, plainBytes, decisionBytes),
  ).toThrow("takes no maintainer decision record");
  expect(() =>
    buildMonthlyBase(
      input,
      snapshotBytes,
      policyBytes,
      maintainerDecisionBytes({
        ...decisions,
        repositories: ["a/b"],
        decisions: [],
      }),
    ),
  ).toThrow("does not cover");

  // An excluded maintainer's decisions leave the split.
  const excluding = sharedProject(2000);
  excluding.reward.payoutExclusions = [
    {
      actorId: outsider,
      nodeId: nodeId(outsider),
      login: "only-maintains",
      relationship: "owner",
      fromCycle: SEPTEMBER,
      untilCycle: null,
    },
  ];
  const excluded = buildMonthlyBase(
    input,
    snapshotBytes,
    Buffer.from(JSON.stringify(excluding)),
    decisionBytes,
  );
  expect(excluded.maintainerShare?.rows).toEqual([
    {
      githubUserId: scorer.githubUserId,
      login: scorer.login,
      decisions: 1,
      grossBase: "1000000000",
    },
  ]);
  expect(excluded.rows.some((row) => row.githubUserId === outsider)).toBe(
    false,
  );
  expect(total(excluded.rows)).toBe(cap);

  const { db, sqlite } = sqliteD1(
    readdirSync("migrations")
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  try {
    const result = {
      period: SEPTEMBER,
      skipped: [],
      bases: [{ ...base, manifest: policyBytes.toString() }],
    };
    const sql = monthlyBasesSql(result, "2026-10-01T00:11:00.000Z");
    sqlite.exec(sql);
    sqlite.exec(sql);
    // A later run with other decisions changes nothing that was stored.
    sqlite.exec(
      monthlyBasesSql(
        {
          ...result,
          bases: [
            {
              ...result.bases[0],
              sourceSnapshotSha256: "f".repeat(64),
              maintainerShare: quiet.maintainerShare,
            },
          ],
        },
        "2026-10-02T00:11:00.000Z",
      ),
    );
    const stored = await db
      .prepare(
        "SELECT basis_points points,pool_base pool,decisions,decisions_sha256 digest,(SELECT json_group_array(json_object('id',github_user_id,'decisions',decisions,'gross',gross_base)) FROM (SELECT * FROM monthly_maintainer_share_rows ORDER BY CAST(github_user_id AS INTEGER))) rows,(SELECT COUNT(*) FROM monthly_reward_base_rows) recipients FROM monthly_maintainer_shares",
      )
      .all<{
        points: number;
        pool: string;
        decisions: string;
        digest: string;
        rows: string;
        recipients: number;
      }>();
    expect(stored.results).toHaveLength(1);
    const [share] = stored.results;
    expect(share.points).toBe(2000);
    expect(share.pool).toBe("1000000000");
    expect(share.decisions).toBe(new TextDecoder().decode(decisionBytes));
    expect(share.digest).toBe(base.maintainerShare?.decisionsSha256 ?? "");
    expect(share.recipients).toBe(base.rows.length);
    expect(
      (JSON.parse(share.rows) as { gross: string }[]).reduce(
        (sum, row) => sum + BigInt(row.gross),
        0n,
      ),
    ).toBe(1_000_000_000n);
    expect(() =>
      sqlite.exec("UPDATE monthly_maintainer_shares SET pool_base='1'"),
    ).toThrow();
    expect(() =>
      sqlite.exec("DELETE FROM monthly_maintainer_share_rows"),
    ).toThrow();
  } finally {
    sqlite.close();
  }
});

test("a busy month's decision record is stored exactly through statements within D1's limit", () => {
  // D1 refuses a statement over 100 KB, and the import is one transaction:
  // one oversized statement would leave every project in the file unstored.
  // elizaOS/eliza merged about 3,900 scored pull requests in 30 days of the
  // public ledger; 1,200 decisions make a record of about 250 KB.
  const ids = ["1001", "1002", "1003", "1004"];
  const decisionBytes = maintainerDecisionBytes(
    record(
      Array.from({ length: 1200 }, (_, index) =>
        decision(30_000 + index, ids[index % 4], `maintainer-${index % 4}`),
      ),
    ),
  );
  expect(decisionBytes.length).toBeGreaterThan(200_000);
  const policyBytes = Buffer.from(JSON.stringify(sharedProject(2000)));
  const base = buildMonthlyBase(
    { projectId: "eliza", period: SEPTEMBER, generatedAt: GENERATED_AT },
    snapshotBytes,
    policyBytes,
    decisionBytes,
  );
  const sql = monthlyBasesSql(
    {
      period: SEPTEMBER,
      skipped: [],
      bases: [{ ...base, manifest: policyBytes.toString() }],
    },
    "2026-10-01T00:11:00.000Z",
  );
  const statements = sql.trimEnd().split("\n");
  expect(
    Math.max(...statements.map((line) => Buffer.byteLength(line))),
  ).toBeLessThanOrEqual(100_000);
  // SQLite orders group_concat's input only by an ORDER BY inside the
  // aggregate; the order of a subquery it reads from is not promised.
  expect(
    statements.find((line) =>
      line.startsWith("INSERT INTO monthly_maintainer_shares("),
    ),
  ).toContain("group_concat(part,'' ORDER BY sequence)");

  const { sqlite } = sqliteD1(
    readdirSync("migrations")
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  // One transaction, like the D1 import. Statement by statement, because
  // Bun's exec of several statements raises only the last one's error.
  const apply = (lines: string[]) => {
    sqlite.exec("BEGIN");
    try {
      for (const line of lines) sqlite.run(line);
      sqlite.exec("COMMIT");
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  };
  try {
    // A lost part stores nothing: the share statement fails the import.
    const first = statements.findIndex((line) => line.includes("_parts("));
    expect(() =>
      apply(statements.filter((_, index) => index !== first)),
    ).toThrow("NOT NULL");
    expect(
      sqlite.query("SELECT COUNT(*) n FROM monthly_reward_bases").get(),
    ).toEqual({ n: 0 });
    // Parts written in reverse and scanned in reverse still join in order.
    sqlite.exec("PRAGMA reverse_unordered_selects=ON");
    const parts = statements.filter((line) => line.includes("_parts("));
    apply([
      ...statements.slice(0, first),
      ...parts.toReversed(),
      ...statements.slice(first + parts.length),
    ]);
    apply(statements);
    expect(
      sqlite
        .query(
          "SELECT decisions,decisions_sha256 digest FROM monthly_maintainer_shares",
        )
        .all(),
    ).toEqual([
      {
        decisions: new TextDecoder().decode(decisionBytes),
        digest: base.maintainerShare?.decisionsSha256 ?? "",
      },
    ]);
    expect(
      sqlite
        .query("SELECT COUNT(*) n FROM monthly_maintainer_share_parts")
        .get(),
    ).toEqual({ n: 0 });
  } finally {
    sqlite.close();
  }
});
