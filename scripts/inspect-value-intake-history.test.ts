import { expect, test } from "bun:test";
import type { HistoricalIntakeFailure } from "../workers/slopbot/value-import-diagnostics";
import {
  inspectValueIntakeHistory,
  intakeHistoryQuery,
  intakeHistoryWindow,
  storedIntakeFailure,
} from "./inspect-value-intake-history";

const from = "2026-11-17T02:27:00Z",
  to = "2026-11-17T02:35:00.000Z";
const now = Date.parse("2026-11-17T03:00:00.000Z");
const window = intakeHistoryWindow(from, to, now);
const failure: HistoricalIntakeFailure = {
  event: "historical-intake-failure",
  stage: "bundle-file-recovery",
  sourceIndex: null,
  sourceCount: 23,
  errorName: "OtherError",
  httpStatus: null,
  messageSha256: "a".repeat(64),
};
const deployment = "12345678-1234-1234-1234-123456789abc";
const version = "abcdef12-1234-1234-1234-123456789abc";
const event = {
  timestamp: window.from + 1000,
  $metadata: {
    service: "slop-slopbot",
    message: JSON.stringify(failure),
    requestId: "never-export",
    error: "never-export",
  },
  source: { message: JSON.stringify(failure), private: "never-export" },
};
const json = (result: unknown) => Response.json({ success: true, result });
function transport(
  overrides: { query?: unknown; after?: string; queryStatus?: number } = {},
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/deployments"))
      return json({
        deployments: [
          {
            id: deployment,
            versions: [
              {
                version_id:
                  calls.length > 1 ? (overrides.after ?? version) : version,
                percentage: 100,
              },
            ],
          },
        ],
      });
    if (overrides.queryStatus)
      return Response.json(
        { success: false, errors: [{ code: 10000, message: "never-export" }] },
        { status: overrides.queryStatus },
      );
    return json(
      overrides.query ?? {
        run: { status: "COMPLETED", dry: true },
        events: { count: 1, events: [event] },
      },
    );
  }) as typeof fetch;
  return { request, calls };
}
const input = {
  account: "a".repeat(32),
  token: "test-only-not-a-key",
  from,
  to,
  now,
};

test("window and query are fixed, recent, bounded and dry", () => {
  expect(window).toEqual({ from: Date.parse(from), to: Date.parse(to) });
  expect(intakeHistoryQuery(window)).toEqual({
    queryId: "slop-fixed-intake-failures-v1",
    timeframe: window,
    dry: true,
    view: "events",
    limit: 200,
    parameters: {
      datasets: ["cloudflare-workers"],
      filterCombination: "and",
      filters: [
        {
          key: "$metadata.service",
          operation: "eq",
          type: "string",
          value: "slop-slopbot",
        },
      ],
      needle: {
        value: "historical-intake-failure",
        isRegex: false,
        matchCase: true,
      },
    },
  });
});
for (const [start, end] of [
  ["", to],
  [from, ""],
  [to, from],
  [from, from],
  ["2026-11-17T02:00:00Z", to],
  ["2026-11-15T02:27:00Z", "2026-11-15T02:35:00Z"],
  [from, "2026-11-17T04:00:00Z"],
  ["2026-02-30T02:27:00Z", to],
  [from.replace("Z", "+00:00"), to],
  ["not-a-date", to],
])
  test(`invalid window refuses before network: ${start} ${end}`, async () => {
    const t = transport();
    await expect(
      inspectValueIntakeHistory({
        ...input,
        from: start,
        to: end,
        request: t.request,
      }),
    ).rejects.toThrow("Invalid intake history window");
    expect(t.calls).toHaveLength(0);
  });
test("one exact failure is detached from all raw metadata and duplicated representations", () => {
  const projected = storedIntakeFailure(event, window);
  expect(projected).toEqual({ timestamp: event.timestamp, failure });
  expect(JSON.stringify(projected)).not.toContain("never-export");
  if (!projected) throw new Error("Expected fixed failure projection");
  expect(Object.keys(projected.failure)).toHaveLength(7);
});
test("retained source refusal projection accepts only fixed GitHub fields", () => {
  const observed: HistoricalIntakeFailure = {
    ...failure,
    stage: "source-evidence",
    sourceIndex: 0,
    httpStatus: 403,
    sourceReadRefusal: {
      category: "primary-rate-limit",
      remaining: 0,
      resetAt: 1794960000,
      retryAfterSeconds: null,
    },
  };
  const stored = (message: unknown) => ({
    timestamp: event.timestamp,
    $metadata: { service: "slop-slopbot" },
    source: { message: JSON.stringify(message) },
  });
  expect(storedIntakeFailure(stored(observed), window)).toEqual({
    timestamp: event.timestamp,
    failure: observed,
  });
  expect(
    storedIntakeFailure(
      stored({
        ...observed,
        sourceReadRefusal: {
          ...observed.sourceReadRefusal,
          body: "never-export",
        },
      }),
      window,
    ),
  ).toBeNull();
});
for (const change of [
  { $metadata: { ...event.$metadata, service: "another-worker" } },
  { timestamp: window.from - 1 },
  { timestamp: window.to + 1 },
  { timestamp: "wrong" },
  {
    source: { ...failure, raw: "never-export" },
    $metadata: { service: "slop-slopbot" },
  },
  {
    source: { message: JSON.stringify({ ...failure, stage: "unrecognized" }) },
    $metadata: { service: "slop-slopbot" },
  },
  {
    source: { message: JSON.stringify({ ...failure, sourceIndex: 23 }) },
    $metadata: { service: "slop-slopbot" },
  },
  { source: { message: JSON.stringify({ ...failure, sourceCount: 22 }) } },
  { source: "x".repeat(8193), $metadata: { service: "slop-slopbot" } },
])
  test("wrong scope, malformed, extra or conflicting fields are not exported", () =>
    expect(storedIntakeFailure({ ...event, ...change }, window)).toBeNull());
test("successful inspection rechecks deployment and retains only safe observations", async () => {
  const t = transport();
  const result = await inspectValueIntakeHistory({
    ...input,
    request: t.request,
  });
  expect(result.complete).toBe(true);
  expect(result.observations).toEqual([
    { timestamp: event.timestamp, failure },
  ]);
  expect(t.calls.map((c) => c.init?.method)).toEqual(["GET", "POST", "GET"]);
  expect(t.calls[1].url).toBe(
    `https://api.cloudflare.com/client/v4/accounts/${input.account}/workers/observability/telemetry/query`,
  );
  expect(JSON.parse(String(t.calls[1].init?.body))).toEqual(
    intakeHistoryQuery(window),
  );
  expect(JSON.stringify(result)).not.toContain("never-export");
  expect(JSON.stringify(result)).not.toContain(input.token);
});
for (const status of [401, 403, 429, 500])
  test(`provider refusal ${status} has fixed scalar diagnostics and no retry`, async () => {
    const t = transport({ queryStatus: status });
    const result = await inspectValueIntakeHistory({
      ...input,
      request: t.request,
    });
    expect(result.complete).toBe(false);
    expect(result.observations).toEqual([]);
    expect(t.calls).toHaveLength(2);
    expect(result).toMatchObject({
      failure: {
        stage: "history-query",
        httpStatus: status,
        providerCode: 10000,
      },
    });
    expect(JSON.stringify(result)).not.toContain("never-export");
  });
for (const query of [
  {
    run: { status: "STARTED", dry: true },
    events: { count: 1, events: [event] },
  },
  {
    run: { status: "COMPLETED", dry: false },
    events: { count: 1, events: [event] },
  },
  {
    run: { status: "COMPLETED", dry: true },
    events: { count: 0, events: [event] },
  },
  {
    run: { status: "COMPLETED", dry: true },
    events: { count: 201, events: Array(201).fill(event) },
  },
])
  test("unfinished, persisted or invalid provider result refuses", async () => {
    const t = transport({ query });
    const result = await inspectValueIntakeHistory({
      ...input,
      request: t.request,
    });
    expect(result.complete).toBe(false);
    expect(result.observations).toEqual([]);
    expect(t.calls).toHaveLength(2);
  });
test("a changed deployment cannot report a complete observation", async () => {
  const t = transport({ after: "bbbbbbbb-1234-1234-1234-123456789abc" });
  const result = await inspectValueIntakeHistory({
    ...input,
    request: t.request,
  });
  expect(result.complete).toBe(false);
  expect(result.observations).toEqual([]);
});
for (const truncated of [true, "true", null])
  test("provider event truncation metadata refuses complete inspection", async () => {
    const t = transport({
      query: {
        run: { status: "COMPLETED", dry: true },
        events: { count: 1, events: [{ ...event, $workers: { truncated } }] },
      },
    });
    const result = await inspectValueIntakeHistory({
      ...input,
      request: t.request,
    });
    expect(result.complete).toBe(false);
    expect(JSON.stringify(result)).not.toContain('"$workers"');
  });
for (const abr of [2, 0, -1, "1", null])
  test("sampled or invalid query metadata refuses even an empty result", async () => {
    const t = transport({
      query: {
        run: { status: "COMPLETED", dry: true, statistics: { abr_level: abr } },
        events: { count: 0, events: [] },
      },
    });
    const result = await inspectValueIntakeHistory({
      ...input,
      request: t.request,
    });
    expect(result.complete).toBe(false);
  });
test("the separate response sampling metadata is also checked", async () => {
  const t = transport({
    query: {
      run: { status: "COMPLETED", dry: true, statistics: { abr_level: 1 } },
      statistics: { abr_level: 2 },
      events: { count: 0, events: [] },
    },
  });
  const result = await inspectValueIntakeHistory({
    ...input,
    request: t.request,
  });
  expect(result.complete).toBe(false);
});
test("explicit unsampled query and untruncated event metadata are admitted", async () => {
  const t = transport({
    query: {
      run: { status: "COMPLETED", dry: true, statistics: { abr_level: 1 } },
      statistics: { abr_level: 1 },
      events: {
        count: 1,
        events: [{ ...event, $workers: { truncated: false } }],
      },
    },
  });
  expect(
    (await inspectValueIntakeHistory({ ...input, request: t.request }))
      .complete,
  ).toBe(true);
});
test("an unprojectable matching row cannot report complete inspection", async () => {
  const t = transport({
    query: {
      run: { status: "COMPLETED", dry: true },
      events: {
        count: 1,
        events: [
          {
            ...event,
            source: "never-export",
            $metadata: { service: "slop-slopbot" },
          },
        ],
      },
    },
  });
  const result = await inspectValueIntakeHistory({
    ...input,
    request: t.request,
  });
  expect(result.complete).toBe(false);
  expect(result).toMatchObject({ rejectedEvents: 1 });
  expect(result.observations).toEqual([]);
  expect(JSON.stringify(result)).not.toContain("never-export");
});
test("truncation is disclosed without automatic pagination", async () => {
  const t = transport({
    query: {
      run: { status: "COMPLETED", dry: true },
      events: { count: 2, events: [event] },
    },
  });
  const result = await inspectValueIntakeHistory({
    ...input,
    request: t.request,
  });
  expect(result.complete).toBe(false);
  expect(result).toMatchObject({ matchedEvents: 2, returnedEvents: 1 });
  expect(t.calls).toHaveLength(3);
});
test("oversized raw response is discarded", async () => {
  const t = transport();
  const request = (async (url: string | URL | Request, init?: RequestInit) =>
    String(url).endsWith("/query")
      ? new Response("x".repeat(1_048_577))
      : t.request(url, init)) as typeof fetch;
  const result = await inspectValueIntakeHistory({ ...input, request });
  expect(result.complete).toBe(false);
  expect(result.observations).toEqual([]);
});
