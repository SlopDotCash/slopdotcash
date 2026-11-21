/**
 * The points generator's private read of the protected project months
 * (operator decision, 21 November 2026; PRD section 7): when it is used, what
 * it sends, what it accepts, and that every failure is one warning and the
 * committed list alone. The last test runs the real route, the hold and the
 * real Points import together.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { D1Database, D1QueryStatement } from "../backend/d1";
import {
  handleProtectedPointMonths,
  PROTECTED_POINT_MONTHS_PATH,
} from "../backend/payments/protected-point-months";
import {
  appendPointAwards,
  emptyPointsJournal,
  type PointAward,
  type PointsJournal,
  pointKey,
} from "../src/lib/points";
import { sqliteD1 } from "../tests/sqlite-d1";
import { holdProtectedPointAwards, pointsSql } from "./generate-points";
import {
  parseProtectedPointMonths,
  resolvePointProtection,
} from "./points-protection-read";

const ORIGIN = "https://slop.cash";
const URL_ = `${ORIGIN}${PROTECTED_POINT_MONTHS_PATH}`;
const TOKEN = "generator-token-0123456789abcdef0123456789";
const ENVIRONMENT = {
  POINTS_PROTECTION_URL: URL_,
  POINTS_PROTECTION_TOKEN: TOKEN,
};
const COMMITTED = [
  { projectId: "asi", period: "2026-08" },
  { projectId: "feed", period: "2026-10" },
];
const ANSWER = {
  schema: "slop-protected-point-months-v1",
  generatedAt: "2026-11-21T12:00:00.000Z",
  months: [
    { projectId: "feed", period: "2026-10" },
    { projectId: "toon-plugins", period: "2026-11" },
  ],
  everyMonthProjects: ["legacy"],
};

type Call = { input: unknown; init: RequestInit | undefined };

/** Runs one resolution and records every request and printed line. */
async function resolve(
  environment: Record<string, string | undefined>,
  respond: (call: Call) => Response | Promise<Response>,
  origin = ORIGIN,
) {
  const calls: Call[] = [];
  const warnings: string[] = [];
  const logs: string[] = [];
  const protection = await resolvePointProtection(
    COMMITTED,
    environment,
    origin,
    {
      request: (async (input: unknown, init?: RequestInit) => {
        calls.push({ input, init });
        return respond({ input, init });
      }) as typeof fetch,
      warn: (line) => warnings.push(line),
      log: (line) => logs.push(line),
    },
  );
  return { protection, calls, warnings, logs };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const FILE_ONLY = { months: COMMITTED, projects: [] };
const never = () => {
  throw new Error("no request is expected");
};

test("without both environment values the committed list is used alone and nothing is requested", async () => {
  for (const environment of [
    {},
    { POINTS_PROTECTION_URL: URL_ },
    { POINTS_PROTECTION_TOKEN: TOKEN },
    { POINTS_PROTECTION_URL: URL_, POINTS_PROTECTION_TOKEN: "" },
    { POINTS_PROTECTION_URL: "", POINTS_PROTECTION_TOKEN: TOKEN },
    { POINTS_PROTECTION_URL: undefined, POINTS_PROTECTION_TOKEN: undefined },
  ]) {
    const result = await resolve(environment, never);
    expect(result.protection).toEqual(FILE_ONLY);
    expect(result.calls).toEqual([]);
    expect(result.warnings).toEqual([]);
    // A build that was given the address but no token (a trusted production
    // build before the secret exists) says so once; any other build is silent.
    expect(result.logs).toEqual(
      environment.POINTS_PROTECTION_URL
        ? [
            "[points] private protected-months read is not configured (no token); holding by data/points/protected-months.json only",
          ]
        : [],
    );
  }
});

test("an empty or shorter answer never drops a committed month", async () => {
  for (const months of [[], [{ projectId: "feed", period: "2026-10" }]]) {
    const result = await resolve(ENVIRONMENT, () =>
      json({ ...ANSWER, months, everyMonthProjects: [] }),
    );
    expect(result.protection.months).toEqual(
      expect.arrayContaining([...COMMITTED]),
    );
    expect(result.protection.months).toHaveLength(
      COMMITTED.length +
        months.filter(
          (m) =>
            !COMMITTED.some(
              (c) => c.projectId === m.projectId && c.period === m.period,
            ),
        ).length,
    );
    expect(result.protection.projects).toEqual([]);
    expect(result.warnings).toEqual([]);
  }
});

test("a good read holds the union of the committed list and the route's answer", async () => {
  const result = await resolve(ENVIRONMENT, () => json(ANSWER));
  expect(result.protection).toEqual({
    months: [
      { projectId: "asi", period: "2026-08" },
      { projectId: "feed", period: "2026-10" },
      { projectId: "toon-plugins", period: "2026-11" },
    ],
    projects: ["legacy"],
  });
  // One bounded request: this site's route, the bearer token in the header
  // only, a deadline, and no redirect to follow.
  expect(result.calls).toHaveLength(1);
  const [{ input, init }] = result.calls;
  expect(input).toBe(URL_);
  expect(init?.redirect).toBe("error");
  expect(init?.cache).toBe("no-store");
  expect(init?.signal).toBeInstanceOf(AbortSignal);
  expect(init?.method).toBeUndefined();
  expect(init?.body).toBeUndefined();
  expect(init?.headers).toEqual({
    Accept: "application/json",
    Authorization: `Bearer ${TOKEN}`,
  });
  expect(result.warnings).toEqual([]);
  // The one line says which lists were used and nothing about their content.
  expect(result.logs).toEqual([
    "[points] holding by data/points/protected-months.json and the private protected-months record",
  ]);
});

test("the address must be the route of the site this build publishes to", async () => {
  for (const address of [
    `https://staging.slop.cash${PROTECTED_POINT_MONTHS_PATH}`,
    `http://slop.cash${PROTECTED_POINT_MONTHS_PATH}`,
    `https://slop.cash.example${PROTECTED_POINT_MONTHS_PATH}`,
    `${URL_}?next=https://example.com`,
    `${ORIGIN}/api/v1/operator/reserved-awards`,
    "not a url",
  ]) {
    const result = await resolve(
      { ...ENVIRONMENT, POINTS_PROTECTION_URL: address },
      never,
    );
    expect(result.protection).toEqual(FILE_ONLY);
    // The token is never sent anywhere else.
    expect(result.calls).toEqual([]);
    expect(result.warnings).toEqual([
      "[points] private protected-months read failed (the address is not this site's protected-point-months route); holding by data/points/protected-months.json only",
    ]);
  }
  // A staging build accepts only the staging route.
  const staging = "https://staging.slop.cash";
  const result = await resolve(
    {
      ...ENVIRONMENT,
      POINTS_PROTECTION_URL: `${staging}${PROTECTED_POINT_MONTHS_PATH}`,
    },
    () => json(ANSWER),
    staging,
  );
  expect(result.protection.projects).toEqual(["legacy"]);
});

const failures: [string, () => Response | Promise<Response>, string][] = [
  [
    "the route's not-found answer for a wrong or unset secret",
    () => json({ error: "not_found" }, 404),
    "HTTP 404",
  ],
  [
    "a server failure",
    () => json({ error: "internal_error", message: "Internal error" }, 500),
    "HTTP 500",
  ],
  ["a redirect answer", () => new Response(null, { status: 302 }), "HTTP 302"],
  [
    "a refused connection or refused redirect",
    () => {
      throw new TypeError(`fetch failed for Bearer ${TOKEN}`);
    },
    "TypeError",
  ],
  [
    "a timeout",
    () => {
      throw new DOMException(`timed out with ${TOKEN}`, "TimeoutError");
    },
    "TimeoutError",
  ],
  [
    "an error with an unprintable name",
    () => {
      const error = new Error("failed");
      error.name = `Bearer ${TOKEN}`;
      throw error;
    },
    "Error",
  ],
  [
    "a thrown value that is not an error",
    () => {
      throw `Bearer ${TOKEN}`;
    },
    "Error",
  ],
  [
    "a body that is not JSON",
    () => new Response(`<html>${TOKEN}</html>`, { status: 200 }),
    "invalid answer",
  ],
  [
    "a body over the size limit",
    () => new Response("x".repeat(1024 * 1024 + 1), { status: 200 }),
    "answer too large",
  ],
  [
    "a declared length over the size limit",
    () =>
      new Response("{}", {
        status: 200,
        headers: { "content-length": String(1024 * 1024 + 1) },
      }),
    "answer too large",
  ],
  ["another schema", () => json({ ...ANSWER, schema: "v2" }), "invalid answer"],
  ["an extra field", () => json({ ...ANSWER, amounts: [] }), "invalid answer"],
  [
    "a missing list",
    () => json({ ...ANSWER, everyMonthProjects: undefined }),
    "invalid answer",
  ],
  [
    "a month that is not YYYY-MM",
    () =>
      json({ ...ANSWER, months: [{ projectId: "feed", period: "2026-13" }] }),
    "invalid answer",
  ],
  [
    "a month entry with an extra field",
    () =>
      json({
        ...ANSWER,
        months: [{ projectId: "feed", period: "2026-10", amount: "1" }],
      }),
    "invalid answer",
  ],
  [
    "an empty project id",
    () => json({ ...ANSWER, everyMonthProjects: [""] }),
    "invalid answer",
  ],
  [
    "a project id that is not text",
    () => json({ ...ANSWER, everyMonthProjects: [7] }),
    "invalid answer",
  ],
  [
    "a time that is not a time",
    () => json({ ...ANSWER, generatedAt: "yesterday" }),
    "invalid answer",
  ],
  ["a list instead of an answer", () => json([ANSWER]), "invalid answer"],
];

for (const [name, respond, reason] of failures) {
  test(`${name} is one warning and the committed list alone`, async () => {
    const result = await resolve(ENVIRONMENT, respond);
    expect(result.protection).toEqual(FILE_ONLY);
    expect(result.calls).toHaveLength(1);
    expect(result.logs).toEqual([]);
    expect(result.warnings).toEqual([
      `[points] private protected-months read failed (${reason}); holding by data/points/protected-months.json only`,
    ]);
    // The token is never printed, even when a failure's own text carries it.
    expect(result.warnings.join("\n")).not.toContain(TOKEN);
  });
}

test("the parser accepts exactly the route's answer shape", () => {
  expect(parseProtectedPointMonths(ANSWER)).toEqual({
    months: ANSWER.months,
    projects: ["legacy"],
  });
  expect(
    parseProtectedPointMonths({
      ...ANSWER,
      months: [],
      everyMonthProjects: [],
    }),
  ).toEqual({ months: [], projects: [] });
  expect(() => parseProtectedPointMonths(null)).toThrow("invalid answer");
  expect(() =>
    parseProtectedPointMonths({
      ...ANSWER,
      months: Array.from({ length: 20_001 }, () => ANSWER.months[0]),
    }),
  ).toThrow("invalid answer");
});

// The real route, the hold and the real import, on one migrated database.
const RECORDED = "2026-11-06T00:00:00.000Z";
const CORRECTED = "2026-11-07T00:00:00.000Z";

function award(
  projectId: string,
  source: string,
  occurredAt: string,
  amount: number,
): PointAward {
  return {
    key: pointKey(projectId, "4242", "merged-pull-request", source),
    actor: { id: "4242", login: "contributor" },
    projectId,
    category: "merged-pull-request",
    amount,
    occurredAt,
    sourceId: source,
    sourceUrl: `https://github.com/example/${projectId}/pull/1`,
    workUnitId: `wu_${source}`,
    provisional: true,
  };
}

test("the import refuses the candidate, and accepts it once the generator holds what the route names", async () => {
  const { db, sqlite } = sqliteD1();
  try {
    const publish = (journal: PointsJournal) =>
      sqlite.transaction(() => {
        for (const statement of pointsSql(journal).trim().split("\n"))
          sqlite.exec(statement);
      })();
    const awards = (amount: number) => [
      // "asi" has an obligation no month accounts for: every month.
      award("asi", "PR_asi_august", "2026-08-03T00:00:00.000Z", amount),
      award("asi", "PR_asi_november", "2026-11-03T00:00:00.000Z", amount),
      // "eliza" has a frozen run for October only.
      award("eliza", "PR_eliza_october", "2026-10-03T00:00:00.000Z", amount),
      award("eliza", "PR_eliza_november", "2026-11-03T00:00:00.000Z", amount),
    ];
    const published = appendPointAwards(
      emptyPointsJournal(RECORDED),
      awards(10),
      "a".repeat(64),
      "slop-score-v2",
      RECORDED,
    );
    publish(published);
    sqlite.run("PRAGMA foreign_keys = OFF");
    sqlite
      .query(
        "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at,paid_transaction) VALUES('obligation','asi','4242','base-mainnet','base','vault',?,6,'100','2',?,'reserved',?,NULL)",
      )
      .run(`0x${"1".repeat(40)}`, "f".repeat(64), RECORDED);
    sqlite
      .query(
        "INSERT INTO monthly_payment_runs(project_id,period,trigger,actor_id,allocation_sequence,snapshot,snapshot_sha256,network,vault,total_gross_base,frozen_at,obligations_created_at) VALUES('eliza','2026-10','automatic',NULL,0,'{}',?,'base-mainnet','vault','100',?,NULL)",
      )
      .run("e".repeat(64), RECORDED);

    // A fresh collection changes every award and adds one to each project.
    const candidate = appendPointAwards(
      published,
      [
        ...awards(20),
        award("asi", "PR_asi_new", "2026-09-03T00:00:00.000Z", 5),
        award("eliza", "PR_eliza_new", "2026-10-09T00:00:00.000Z", 5),
      ],
      "b".repeat(64),
      "slop-score-v2",
      CORRECTED,
    );
    expect(() => publish(candidate)).toThrow(
      "NOT NULL constraint failed: points_batches.coverage",
    );

    const known = new Set(published.revisions.map((r) => r.id));
    const request = (async (input: unknown, init?: RequestInit) =>
      (await handleProtectedPointMonths(new Request(String(input), init), {
        db: db as unknown as D1Database<D1QueryStatement>,
        token: TOKEN,
      })) ?? json({ error: "not_found" }, 404)) as typeof fetch;

    // The committed list alone does not know these months: still refused.
    const fileOnly = await resolvePointProtection([], {}, ORIGIN, { request });
    expect(() =>
      publish(
        holdProtectedPointAwards(
          candidate,
          known,
          fileOnly.months,
          fileOnly.projects,
        ).journal,
      ),
    ).toThrow("NOT NULL constraint failed: points_batches.coverage");

    const protection = await resolvePointProtection([], ENVIRONMENT, ORIGIN, {
      request,
      log: () => {},
    });
    expect(protection).toEqual({
      months: [{ projectId: "eliza", period: "2026-10" }],
      projects: ["asi"],
    });
    const held = holdProtectedPointAwards(
      candidate,
      known,
      protection.months,
      protection.projects,
    );
    // Held: both changed and the new "asi" awards, and the changed and
    // the new "eliza" October awards. Published: "eliza" November.
    expect(held.held).toBe(5);
    publish(held.journal);
    const latest = sqlite
      .query<{ source: string; amount: number }, []>(
        "SELECT json_extract(payload,'$.award.sourceId') AS source, json_extract(payload,'$.award.amount') AS amount FROM points_revisions ORDER BY rowid",
      )
      .all();
    expect(latest.filter((row) => row.amount !== 10)).toEqual([
      { source: "PR_eliza_november", amount: 20 },
    ]);
  } finally {
    sqlite.close();
  }
});

test("only a trusted main build receives the address and the token, and the address is the route", () => {
  const source = readFileSync(
    new URL("../.github/workflows/deploy.yml", import.meta.url),
    "utf8",
  );
  const workflow = Bun.YAML.parse(source) as {
    jobs: Record<
      string,
      { steps?: { name?: string; env?: Record<string, string> }[] }
    >;
  };
  const steps = Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);
  const receiving = steps.filter(
    (step) =>
      step.env?.POINTS_PROTECTION_TOKEN !== undefined ||
      step.env?.POINTS_PROTECTION_URL !== undefined,
  );
  expect(receiving.map((step) => step.name)).toEqual(["Build production site"]);
  const trusted =
    "github.event_name != 'pull_request' && github.ref == 'refs/heads/main'";
  // The generator refuses any other address, so the workflow's address must
  // be production's own route. Without the secret both expressions are
  // empty text, which the generator treats as "not configured".
  expect(receiving[0].env).toMatchObject({
    POINTS_PROTECTION_URL: `\${{ ${trusted} && '${ORIGIN}${PROTECTED_POINT_MONTHS_PATH}' || '' }}`,
    POINTS_PROTECTION_TOKEN: `\${{ ${trusted} && secrets.POINTS_PROTECTION_TOKEN || '' }}`,
  });
  // The secret is named nowhere else in the workflow.
  expect(source.split("secrets.POINTS_PROTECTION_TOKEN")).toHaveLength(2);
});
