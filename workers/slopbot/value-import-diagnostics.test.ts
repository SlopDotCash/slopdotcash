import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { GitHubClient, GitHubError } from "./github";
import { importSubscriptionAssessment } from "./value-import";
import {
  historicalIntakeFailure,
  projectHistoricalIntakeFailure,
  withHistoricalIntakeDiagnostics,
} from "./value-import-diagnostics";

const secret =
  "credential https://private.invalid/token body prompt session path";
const progress = {
  stage: "source-registry",
  sourceIndex: 2,
  sourceCount: 23,
} as const;
test("failure observation retains only fixed stage/index/name/status and message digest", async () => {
  const error = Object.assign(new Error(secret), {
    status: 403,
    body: secret,
    url: secret,
    stack: secret,
    sourceId: secret,
    cause: { key: secret },
  });
  const result = await historicalIntakeFailure(progress, error);
  expect(result).toEqual({
    ...progress,
    event: "historical-intake-failure",
    errorName: "Error",
    httpStatus: 403,
    messageSha256: createHash("sha256").update(secret).digest("hex"),
  });
  expect(JSON.stringify(result)).not.toContain(secret);
});
test("oversize UTF8/name/status inputs cannot pass raw values", async () => {
  const result = await historicalIntakeFailure(progress, {
    name: secret,
    status: 499,
    message: "界".repeat(2000),
    stack: secret,
  });
  expect(result?.errorName).toBe("OtherError");
  expect(result?.httpStatus).toBeNull();
  expect(result?.messageSha256).toBeNull();
});
test("exact projection refuses extras and malformed or unbounded source positions", async () => {
  const safe = await historicalIntakeFailure(progress, new Error(secret));
  for (const patch of [
    { body: secret },
    { stage: secret },
    { sourceCount: 10001 },
    { sourceCount: null },
    { sourceIndex: 23 },
    { sourceIndex: -1 },
    { sourceIndex: 1.5 },
    { httpStatus: "403" },
    { errorName: secret },
    { messageSha256: secret },
  ])
    expect(projectHistoricalIntakeFailure({ ...safe, ...patch })).toBeNull();
  expect(projectHistoricalIntakeFailure(safe)).toEqual(safe);
});
test("wrapper preserves exact original failure and success, including logging failure", async () => {
  const original = new Error(secret),
    logs: string[] = [];
  let caught: unknown;
  try {
    await withHistoricalIntakeDiagnostics(
      async (observe) => {
        observe(progress);
        throw original;
      },
      (safe) => logs.push(safe),
    );
  } catch (e) {
    caught = e;
  }
  expect(caught).toBe(original);
  expect(logs).toHaveLength(1);
  expect(logs[0]).not.toContain(secret);
  await expect(
    withHistoricalIntakeDiagnostics(
      async () => {
        throw original;
      },
      () => {
        throw Error(secret);
      },
    ),
  ).rejects.toBe(original);
  expect(
    await withHistoricalIntakeDiagnostics(
      async () => "unchanged",
      () => {
        throw Error(secret);
      },
    ),
  ).toBe("unchanged");
});
test("normal importer envelope refusal is observed and rethrows the same object", async () => {
  const logs: string[] = [];
  let original: unknown, observed: unknown;
  const env = { SLOPBOT_PRODUCER_REVISION: "1".repeat(40) } as Parameters<
    typeof importSubscriptionAssessment
  >[0];
  try {
    await importSubscriptionAssessment(env, {});
  } catch (e) {
    original = e;
  }
  try {
    await withHistoricalIntakeDiagnostics(
      async (observe) => {
        try {
          return await importSubscriptionAssessment(
            env,
            {},
            undefined,
            observe,
          );
        } catch (e) {
          observed = e;
          throw e;
        }
      },
      (safe) => logs.push(safe),
    );
  } catch (e) {
    expect(e).toBe(observed);
  }
  expect((original as Error).message).toBe((observed as Error).message);
  expect(JSON.parse(logs[0]).stage).toBe("envelope");
});

const path = "/repos/example/source/commits/sha?per_page=100&page=1";

async function observeSourceResponse(response: Response, observe = true) {
  const calls: [string, string | undefined, string | null][] = [];
  const client = GitHubClient.forToken(
    secret,
    (async (url, init) => {
      calls.push([
        String(url),
        init?.method,
        new Headers(init?.headers).get("authorization"),
      ]);
      return response;
    }) as typeof fetch,
    { observeSourceReadRefusal: observe },
  );
  const logs: string[] = [];
  const original = `GET ${path} returned ${response.status}`;
  await expect(
    withHistoricalIntakeDiagnostics(
      async (observe) => {
        observe({ ...progress, stage: "source-evidence" });
        await client.get(path);
      },
      (safe) => logs.push(safe),
    ),
  ).rejects.toBeInstanceOf(GitHubError);
  expect(calls).toEqual([
    [`https://api.github.com${path}`, "GET", `Bearer ${secret}`],
  ]);
  expect(logs).toHaveLength(1);
  const observation = JSON.parse(logs[0]);
  expect(observation.messageSha256).toBe(
    createHash("sha256").update(original).digest("hex"),
  );
  expect(observation.errorName).toBe("Error");
  expect(observation.httpStatus).toBe(response.status);
  expect(logs[0]).not.toContain(secret);
  expect(logs[0]).not.toContain(path);
  return observation;
}

test("actual source GET refusal distinguishes fixed GitHub rate and access evidence without retry", async () => {
  const primary = await observeSourceResponse(
    Response.json(
      { message: secret },
      {
        status: 403,
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1794960000",
        },
      },
    ),
  );
  expect(primary.sourceReadRefusal).toEqual({
    category: "primary-rate-limit",
    remaining: 0,
    resetAt: 1794960000,
    retryAfterSeconds: null,
  });
  const secondary = await observeSourceResponse(
    Response.json(
      {
        message: `You have exceeded a secondary rate limit. ${secret}`,
      },
      {
        status: 403,
        headers: {
          "x-ratelimit-remaining": "550",
          "x-ratelimit-reset": secret,
          "retry-after": "60",
        },
      },
    ),
  );
  expect(secondary.sourceReadRefusal).toEqual({
    category: "secondary-rate-limit",
    remaining: 550,
    resetAt: null,
    retryAfterSeconds: 60,
  });
  const denied = await observeSourceResponse(
    Response.json(
      {
        message: "Resource not accessible by integration",
      },
      { status: 403, headers: { "x-ratelimit-remaining": "0" } },
    ),
  );
  expect(denied.sourceReadRefusal.category).toBe("access-denied");
  const opaque = await observeSourceResponse(
    Response.json(
      { message: secret },
      {
        status: 403,
        headers: {
          "x-ratelimit-remaining": "9007199254740992",
          "retry-after": "1.5",
        },
      },
    ),
  );
  expect(opaque.sourceReadRefusal).toEqual({
    category: "unclassified",
    remaining: null,
    resetAt: null,
    retryAfterSeconds: null,
  });
  const limited = await observeSourceResponse(
    new Response(null, { status: 429 }),
  );
  expect(limited.sourceReadRefusal.category).toBe("rate-limited");
});

test("diagnostic reads are opt-in and a stalled body keeps the original refusal", async () => {
  const disabled = Response.json({ message: secret }, { status: 403 });
  expect(
    (await observeSourceResponse(disabled, false)).sourceReadRefusal,
  ).toBeUndefined();
  expect(disabled.bodyUsed).toBe(false);

  let canceled = false;
  const body = new ReadableStream({
    cancel() {
      canceled = true;
    },
  });
  const stalled = await observeSourceResponse(
    new Response(body, {
      status: 403,
      headers: { "content-type": "application/json" },
    }),
  );
  expect(canceled).toBe(true);
  expect(stalled.sourceReadRefusal.category).toBe("unclassified");
});

test("strict source refusal projection refuses nested extras and contradictory metadata", async () => {
  const safe = await observeSourceResponse(new Response(null, { status: 429 }));
  for (const sourceReadRefusal of [
    { ...safe.sourceReadRefusal, body: secret },
    { ...safe.sourceReadRefusal, remaining: "0" },
    { ...safe.sourceReadRefusal, resetAt: -1 },
    { ...safe.sourceReadRefusal, retryAfterSeconds: 1.5 },
    { ...safe.sourceReadRefusal, category: secret },
    { ...safe.sourceReadRefusal, category: "access-denied" },
    {
      ...safe.sourceReadRefusal,
      category: "primary-rate-limit",
      remaining: 10,
    },
  ])
    expect(
      projectHistoricalIntakeFailure({ ...safe, sourceReadRefusal }),
    ).toBeNull();
  expect(
    projectHistoricalIntakeFailure({ ...safe, httpStatus: 500 }),
  ).toBeNull();
  expect(projectHistoricalIntakeFailure(safe)).toEqual(safe);
});
