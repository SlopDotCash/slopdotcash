import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
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
