import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  inspectValueIntake,
  intakeError,
  readIntakeTail,
  sanitizeIntakeTail,
} from "./inspect-value-intake";

const secret = "secret-token https://private.invalid/body";
const version = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const deployment = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const tailId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const options = { account: "a".repeat(32), token: secret };
const messageHash = (message: string) =>
  createHash("sha256").update(message, "utf8").digest("hex");

test("structured historical stages survive both projections without raw payloads", () => {
  const safe = {
    event: "historical-intake-failure",
    stage: "source-registry",
    sourceCount: 23,
    sourceIndex: 2,
    errorName: "Error",
    httpStatus: 403,
    messageSha256: messageHash(secret),
  };
  const result = sanitizeIntakeTail({
    logs: [
      {
        message: [
          JSON.stringify(safe),
          { ...safe, body: secret },
          { ...safe, sourceIndex: 23 },
        ],
      },
    ],
  });
  expect(result?.historicalIntakeFailures).toEqual([safe]);
  expect(result?.categories).toBeUndefined();
  expect(sanitizeIntakeTail(result)?.historicalIntakeFailures).toEqual([safe]);
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(
    sanitizeIntakeTail({
      historicalIntakeFailures: [{ ...safe, url: secret }],
    }),
  ).toBeNull();
  expect(
    sanitizeIntakeTail({
      historicalIntakeFailures: Array.from({ length: 30 }, () => safe),
    })?.historicalIntakeFailures,
  ).toHaveLength(20);
});

test("tail sanitizer emits fixed labels and numeric HTTP state only", () => {
  const result = sanitizeIntakeTail({
    scriptName: secret,
    outcome: "exceededMemory",
    event: {
      request: {
        method: "POST",
        url: secret,
        headers: { authorization: secret },
      },
      response: { status: 409 },
    },
    exceptions: [
      {
        name: secret,
        message: "Merge reconstruction unavailable: supervisor-timeout-137",
        stack: secret,
      },
      { message: "Too many subrequests " + secret },
      { message: "GET /repos/private returned 403" },
    ],
    logs: [
      {
        message: ["historical value import failure", secret, { body: secret }],
      },
    ],
  });
  expect(result).toEqual({
    outcome: "exceededMemory",
    method: "POST",
    httpStatus: 409,
    categories: [
      "merge-supervisor-timeout",
      "subrequest-limit",
      "github-http-403",
      "publication-failed",
      "other",
    ],
    exceptionFingerprints: [
      {
        name: "OtherError",
        messageSha256: messageHash(
          "Merge reconstruction unavailable: supervisor-timeout-137",
        ),
      },
      {
        name: "OtherError",
        messageSha256: messageHash("Too many subrequests " + secret),
      },
      {
        name: "OtherError",
        messageSha256: messageHash("GET /repos/private returned 403"),
      },
    ],
  });
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(intakeError("Merge reconstruction unavailable: output-read")).toBe(
    "merge-output-read",
  );
  expect(
    intakeError("Error: Merge reconstruction unavailable: input-write"),
  ).toBe("merge-input-write");
  expect(intakeError("Recovery source metadata changed")).toBe(
    "source-metadata-changed",
  );
  expect(
    intakeError("Merge reconstruction unavailable: supervisor-exited-999"),
  ).toBe("other");
  expect(
    sanitizeIntakeTail({
      outcome: secret,
      httpStatus: 700,
      method: secret,
      categories: [secret],
    }),
  ).toBeNull();
});

test("early first-party errors remain identifiable without retaining messages, URLs or stacks", () => {
  const tokenFailure = "installation token request failed";
  expect(intakeError(tokenFailure)).toBe("other");
  const result = sanitizeIntakeTail({
    exceptions: [
      {
        name: "Error",
        message: tokenFailure,
        stack: secret,
        cause: { body: secret },
      },
      {
        name: "TypeError",
        message: "Cannot read properties of undefined " + secret,
      },
      { name: secret, message: secret },
    ],
  });
  expect(result).toEqual({
    categories: ["other"],
    exceptionFingerprints: [
      { name: "Error", messageSha256: messageHash(tokenFailure) },
      {
        name: "TypeError",
        messageSha256: messageHash(
          "Cannot read properties of undefined " + secret,
        ),
      },
      { name: "OtherError", messageSha256: messageHash(secret) },
    ],
  });
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(JSON.stringify(result)).not.toContain(tokenFailure);
  expect(sanitizeIntakeTail(result)).toEqual(result);
});

test("exception fingerprints bound message bytes/counts and reject forged projected fields", () => {
  const result = sanitizeIntakeTail({
    exceptions: [
      { name: "Error", message: "x".repeat(4096) },
      { name: "Error", message: "x".repeat(4097) },
      { name: "Error", message: "界".repeat(2000) },
      { name: "Error", message: { body: secret } },
      ...Array.from({ length: 30 }, () => ({ name: secret, message: secret })),
    ],
  });
  expect(result?.exceptionFingerprints).toHaveLength(20);
  if (!result) throw Error("Missing exception fingerprint projection");
  expect(
    (result.exceptionFingerprints as Record<string, unknown>[]).slice(0, 4),
  ).toEqual([
    { name: "Error", messageSha256: messageHash("x".repeat(4096)) },
    { name: "Error", messageSha256: null },
    { name: "Error", messageSha256: null },
    { name: "Error", messageSha256: null },
  ]);
  expect(
    sanitizeIntakeTail({
      exceptionFingerprints: [
        { name: secret, messageSha256: "a".repeat(64) },
        { name: "Error", messageSha256: secret },
        { name: "Error", messageSha256: "a".repeat(64), message: secret },
      ],
    }),
  ).toBeNull();
  expect(JSON.stringify(result)).not.toContain(secret);
});

function fixture(
  overrides: {
    badTransport?: boolean;
    denied?: boolean;
    changed?: boolean;
    cleanupDenied?: boolean;
  } = {},
) {
  const calls: { path: string; method: string; body?: any }[] = [];
  const reads = new Map<string, number>();
  const request = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? "GET";
    calls.push({
      path,
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (overrides.denied)
      return Response.json(
        { success: false, errors: [{ code: 10000, message: secret }] },
        { status: 403 },
      );
    if (method === "DELETE")
      return Response.json({ success: !overrides.cleanupDenied, result: {} });
    if (method === "POST")
      return Response.json({
        success: true,
        result: {
          id: tailId,
          url: overrides.badTransport
            ? "wss://attacker.invalid/secret"
            : "wss://tail.workers.dev/secret",
        },
      });
    reads.set(path, (reads.get(path) ?? 0) + 1);
    const active =
      overrides.changed && reads.get(path)! > 1 ? tailId : deployment;
    return Response.json({
      success: true,
      result: path.includes("/pages/")
        ? { canonical_deployment: { id: active, environment: "production" } }
        : {
            deployments: [
              {
                id: active,
                versions: [{ version_id: version, percentage: 100 }],
              },
            ],
          },
    });
  }) as typeof fetch;
  return { calls, request };
}

test("normal inspection binds both Workers and Pages and removes all three tails", async () => {
  const f = fixture();
  const result = await inspectValueIntake({
    ...options,
    request: f.request,
    tail: async () => [
      {
        outcome: "exception",
        event: { response: { status: 409 } },
        exceptions: [
          { message: "historical value import failure", stack: secret },
        ],
        secret,
      },
    ],
  });
  expect(result.targets.every((target) => target.complete)).toBe(true);
  expect(f.calls.filter((call) => call.method === "DELETE")).toHaveLength(3);
  expect(
    f.calls.filter((call) => call.method === "POST").map((call) => call.body),
  ).toEqual([
    { filters: [{ scriptVersion: version }] },
    { filters: [{ scriptVersion: version }] },
    {},
  ]);
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(result.targets[0].observations).toEqual([
    {
      outcome: "exception",
      httpStatus: 409,
      categories: ["publication-failed"],
      exceptionFingerprints: [
        {
          name: "OtherError",
          messageSha256: messageHash("historical value import failure"),
        },
      ],
    },
  ]);
});

test("unsafe transport refuses but cleans every created tail", async () => {
  const f = fixture({ badTransport: true });
  const result = await inspectValueIntake({
    ...options,
    request: f.request,
    tail: async () => {
      throw Error("must not connect");
    },
  });
  expect(result.targets.every((target) => !target.complete)).toBe(true);
  expect(f.calls.filter((call) => call.method === "DELETE")).toHaveLength(3);
  expect(
    result.targets.every(
      (target) => target.failure?.stage === "tail-transport",
    ),
  ).toBe(true);
});

test("provider failures expose only stage and integer codes", async () => {
  const f = fixture({ denied: true });
  const result = await inspectValueIntake({ ...options, request: f.request });
  expect(result.targets[0].failure).toEqual({
    stage: "deployment-read",
    httpStatus: 403,
    providerCode: 10000,
  });
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(f.calls).toHaveLength(3);
});

test("changed deployments and unsuccessful cleanup refuse completion", async () => {
  for (const [option, stage] of [
    [{ changed: true }, "deployment-recheck"],
    [{ cleanupDenied: true }, "tail-delete"],
  ] as const) {
    const f = fixture(option);
    const result = await inspectValueIntake({
      ...options,
      request: f.request,
      tail: async () => [],
    });
    expect(
      result.targets.every(
        (target) => !target.complete && target.failure?.stage === stage,
      ),
    ).toBe(true);
  }
});

test("tail transport failure retains only sanitized observations and always cleans up", async () => {
  const f = fixture();
  const result = await inspectValueIntake({
    ...options,
    request: f.request,
    tail: async () => {
      throw Error(secret);
    },
  });
  expect(
    result.targets.every(
      (target) =>
        !target.complete && target.failure?.stage === "tail-transport",
    ),
  ).toBe(true);
  expect(f.calls.filter((call) => call.method === "DELETE")).toHaveLength(3);
  expect(JSON.stringify(result)).not.toContain(secret);
});

test("a socket that never opens cannot report completed observation", async () => {
  const original = globalThis.WebSocket;
  class NeverOpen {
    binaryType = "";
    addEventListener() {}
    close() {}
    send() {}
  }
  globalThis.WebSocket = NeverOpen as unknown as typeof WebSocket;
  try {
    await expect(
      readIntakeTail("wss://tail.workers.dev/secret", 0.001),
    ).rejects.toThrow("Tail transport unavailable");
  } finally {
    globalThis.WebSocket = original;
  }
});

test("an opened socket finishes bounded observation and rejects send failure", async () => {
  const original = globalThis.WebSocket;
  for (const sendFails of [false, true]) {
    class OpenSocket {
      binaryType = "";
      addEventListener(kind: string, callback: () => void) {
        if (kind === "open") queueMicrotask(callback);
      }
      close() {}
      send() {
        if (sendFails) throw Error("private transport text");
      }
    }
    globalThis.WebSocket = OpenSocket as unknown as typeof WebSocket;
    try {
      const result = readIntakeTail("wss://tail.workers.dev/secret", 0.005);
      if (sendFails)
        await expect(result).rejects.toThrow("Tail transport unavailable");
      else expect(await result).toEqual([]);
    } finally {
      globalThis.WebSocket = original;
    }
  }
});
