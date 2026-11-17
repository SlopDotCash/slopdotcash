import { expect, test } from "bun:test";
import { inspectSlopbotRuntime } from "./inspect-slopbot-runtime";

const deploymentId = "11111111-1111-1111-1111-111111111111";
const versionId = "22222222-2222-2222-2222-222222222222";
const otherId = "33333333-3333-3333-3333-333333333333";
const source = "a".repeat(40);
const input = {
  account: "b".repeat(32),
  token: "synthetic-private-token",
  expectedSource: source,
};
const deployment = () => ({
  deployments: [
    {
      id: deploymentId,
      versions: [{ version_id: versionId, percentage: 100 }],
      requestId: "never-export",
    },
  ],
});
const version = () => ({
  id: versionId,
  annotations: { "workers/tag": source, private: "never-export" },
  resources: {
    bindings: [{ name: "PRIVATE", text: "never-export" }],
    script_runtime: {
      limits: { cpu_ms: 300_000, private: "never-export" },
      usage_model: "standard",
    },
  },
  metadata: { author_email: "never-export" },
});
function transport(
  options: {
    before?: unknown;
    after?: unknown;
    version?: unknown;
    failureAt?: number;
    status?: number;
    rawResponse?: string;
  } = {},
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const request = (async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === options.failureAt) {
      if (options.status === undefined) throw new Error("never-export");
      return new Response("never-export", { status: options.status });
    }
    if (String(url).endsWith("/deployments"))
      return Response.json({
        success: true,
        result:
          calls.length === 1
            ? (options.before ?? deployment())
            : (options.after ?? deployment()),
      });
    if (options.rawResponse !== undefined)
      return new Response(options.rawResponse);
    return Response.json({
      success: true,
      result: options.version ?? version(),
    });
  }) as typeof fetch;
  return { request, calls };
}

test("positiveMetadataTest: three fixed TLS GETs retain only the coherent source/runtime projection", async () => {
  const t = transport();
  const report = await inspectSlopbotRuntime({ ...input, request: t.request });
  expect(report.status).toBe("observed");
  expect(report.observation).toEqual({
    sourceCommit: source,
    versionId,
    cpuMs: 300_000,
    usageModel: "standard",
    deploymentStable: true,
  });
  expect(t.calls.map((call) => call.url)).toEqual([
    `https://api.cloudflare.com/client/v4/accounts/${input.account}/workers/scripts/slop-slopbot/deployments`,
    `https://api.cloudflare.com/client/v4/accounts/${input.account}/workers/scripts/slop-slopbot/versions/${versionId}`,
    `https://api.cloudflare.com/client/v4/accounts/${input.account}/workers/scripts/slop-slopbot/deployments`,
  ]);
  for (const call of t.calls) {
    expect(call.init?.method).toBe("GET");
    expect(call.init?.body).toBeUndefined();
    expect(call.init?.redirect).toBe("error");
    expect(call.init?.cache).toBe("no-store");
    expect(call.init?.signal).toBeInstanceOf(AbortSignal);
  }
});

test("privacyProjectionTest: raw bindings, account, token, author, request and deployment IDs are absent", async () => {
  const report = await inspectSlopbotRuntime({
    ...input,
    request: transport().request,
  });
  const serialized = JSON.stringify(report);
  for (const forbidden of [
    "never-export",
    "bindings",
    input.account,
    input.token,
    deploymentId,
    "ready",
    "entitlement",
  ])
    expect(serialized).not.toContain(forbidden);
});

for (const changed of [
  { expectedSource: "b".repeat(40) },
  { expectedSource: "a" },
])
  test(`${changed.expectedSource.length === 40 ? "wrongSourceRefusedTest" : "malformedExpectedSourceTest"}: expected source is exact, never a prefix or a readiness claim`, async () => {
    const t = transport();
    const report = await inspectSlopbotRuntime({
      ...input,
      ...changed,
      request: t.request,
    });
    expect(report.status).toBe("unavailable");
    expect(report.observation).toBeNull();
    expect(t.calls).toHaveLength(changed.expectedSource.length === 40 ? 2 : 0);
  });

for (const after of [
  { deployments: [{ ...deployment().deployments[0], id: otherId }] },
  {
    deployments: [
      {
        id: deploymentId,
        versions: [{ version_id: otherId, percentage: 100 }],
      },
    ],
  },
])
  test("deploymentDriftRefusedTest: even a same-version redeployment discards the observation", async () => {
    const t = transport({ after });
    const report = await inspectSlopbotRuntime({
      ...input,
      request: t.request,
    });
    expect(report.status).toBe("unavailable");
    expect(report.observation).toBeNull();
    expect(report).toMatchObject({ failure: { stage: "deployment-recheck" } });
    expect(t.calls).toHaveLength(3);
  });

for (const before of [
  { deployments: [] },
  { deployments: [{ id: "never-export", versions: [] }] },
  {
    deployments: [
      {
        id: deploymentId,
        versions: [{ version_id: versionId, percentage: 50 }],
      },
    ],
  },
  {
    deployments: [
      {
        id: deploymentId,
        versions: [
          { version_id: versionId, percentage: 100 },
          { version_id: otherId, percentage: 0 },
        ],
      },
    ],
  },
])
  test("malformedRefusedTest: missing or split active deployment refuses before version reads", async () => {
    const t = transport({ before });
    const report = await inspectSlopbotRuntime({
      ...input,
      request: t.request,
    });
    expect(report.status).toBe("unavailable");
    expect(report.observation).toBeNull();
    expect(t.calls).toHaveLength(1);
    expect(JSON.stringify(report)).not.toContain("never-export");
  });

for (const [scenario, invalid] of [
  ["incoherentVersionRefusedTest", { ...version(), id: otherId }],
  ["wrongSourceRefusedTest", { ...version(), annotations: {} }],
  ["malformedRefusedTest", { ...version(), resources: {} }],
  ...[undefined, null, 0, -1, 1.5, 300_001, "300000"].map((cpu_ms) => [
    "invalidRuntimeRefusedTest",
    {
      ...version(),
      resources: {
        script_runtime: { limits: { cpu_ms }, usage_model: "standard" },
      },
    },
  ]),
  ...[undefined, null, "never-export"].map((usage_model) => [
    "invalidRuntimeRefusedTest",
    {
      ...version(),
      resources: {
        script_runtime: { limits: { cpu_ms: 300_000 }, usage_model },
      },
    },
  ]),
])
  test(`${scenario}: identity, source and runtime fields cannot be guessed`, async () => {
    const t = transport({ version: invalid });
    const report = await inspectSlopbotRuntime({
      ...input,
      request: t.request,
    });
    expect(report.status).toBe("unavailable");
    expect(report.observation).toBeNull();
    expect(t.calls).toHaveLength(2);
    expect(JSON.stringify(report)).not.toContain("never-export");
  });

for (const failureAt of [1, 2, 3])
  for (const status of [undefined, 401, 403, 429, 500])
    test("deniedRefusedTest: failed GETs retain no partial observation or response body and never retry", async () => {
      const t = transport({ failureAt, status });
      const report = await inspectSlopbotRuntime({
        ...input,
        request: t.request,
      });
      expect(report.status).toBe("unavailable");
      expect(report.observation).toBeNull();
      expect(t.calls).toHaveLength(failureAt);
      expect(JSON.stringify(report)).not.toContain("never-export");
      expect(JSON.stringify(report)).not.toContain(input.token);
      if (status !== undefined)
        expect(report).toMatchObject({ failure: { httpStatus: status } });
    });

for (const rawResponse of [
  "never-export",
  JSON.stringify({ success: false, errors: [{ message: "never-export" }] }),
  "x".repeat(1_048_577),
])
  test("malformedRefusedTest: invalid, unsuccessful and oversized responses remain unavailable", async () => {
    const report = await inspectSlopbotRuntime({
      ...input,
      request: transport({ rawResponse }).request,
    });
    expect(report.status).toBe("unavailable");
    expect(report.observation).toBeNull();
    expect(JSON.stringify(report)).not.toContain("never-export");
  });

for (const changed of [{ account: "invalid" }, { token: "" }])
  test("missingAuthorityTest: absent or invalid authority makes no request", async () => {
    const t = transport();
    const report = await inspectSlopbotRuntime({
      ...input,
      ...changed,
      request: t.request,
    });
    expect(report.status).toBe("unavailable");
    expect(report.observation).toBeNull();
    expect(t.calls).toHaveLength(0);
  });

test("TLS verification cannot be disabled", async () => {
  const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  try {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    const t = transport();
    const report = await inspectSlopbotRuntime({
      ...input,
      request: t.request,
    });
    expect(report).toMatchObject({
      status: "unavailable",
      observation: null,
      failure: { stage: "tls" },
    });
    expect(t.calls).toHaveLength(0);
  } finally {
    if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
  }
});

for (const usageModel of ["standard", "bundled", "unbound"])
  test("actual valid CPU/model values are observed without asserting the expected budget or Paid entitlement", async () => {
    const value = version();
    value.resources.script_runtime = {
      limits: { cpu_ms: 30_000, private: "never-export" },
      usage_model: usageModel,
    };
    const report = await inspectSlopbotRuntime({
      ...input,
      request: transport({ version: value }).request,
    });
    expect(report.observation).toMatchObject({ cpuMs: 30_000, usageModel });
    expect(report.status).toBe("observed");
  });
