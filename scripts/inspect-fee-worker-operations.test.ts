import { expect, test } from "bun:test";
import { sqliteD1 } from "../tests/sqlite-d1";
import {
  feeErrorCategory,
  feeRpcMethod,
  inspectFeeOperations,
  sanitizeFeeTail,
  summarizeFeeDatabase,
} from "./inspect-fee-worker-operations";

const secret = "PRIVATE_SECRET_https://private.invalid/key";
test("tail allows only fixed fee event labels and categorized errors", () => {
  const safe = sanitizeFeeTail({
    scriptName: "slop-fee-converter",
    outcome: "exception",
    exceptions: [{ message: `${secret} rate limit 429` }],
    logs: [
      {
        message: [
          JSON.stringify({
            event: "fee_claim_error",
            network: "solana",
            error: `${secret} invalid signer key`,
            raw: secret,
          }),
          JSON.stringify({ event: secret, network: "solana" }),
          JSON.stringify({
            event: "fee_converter_run",
            trigger: "recovery",
            results: [
              {
                network: "solana",
                status: "locked",
                claimed: 0,
                quote: secret,
              },
            ],
          }),
        ],
      },
    ],
  });
  expect(JSON.stringify(safe)).not.toContain(secret);
  expect(safe?.records).toEqual([
    {
      event: "fee_claim_error",
      network: "solana",
      errorCategory: "signer-configuration",
    },
    {
      event: "fee_converter_run",
      trigger: "recovery",
      results: [
        { network: "solana", status: "locked", claimed: 0, reconciled: null },
      ],
    },
  ]);
  expect(safe?.exceptionCategories).toEqual(["rpc-rate-limit"]);
  expect(
    sanitizeFeeTail({
      scriptName: "another-worker",
      logs: [{ message: [secret] }],
    }),
  ).toBeNull();
});

test("database summaries discard freeform data and sum base units with bigint", () => {
  const report = summarizeFeeDatabase(
    {
      locks: [
        {
          network: "solana",
          expires_at: "2026-11-16T08:30:00.000Z",
          gas_revision: 1,
          run_id: secret,
        },
      ],
      gas: [
        {
          network: "solana",
          state: "signed",
          maximum_wei: "9007199254740993",
          actual_wei: "5000",
          raw_tx: secret,
        },
      ],
      attempts: [
        {
          network: "solana",
          kind: "claim",
          state: "failed",
          created_at: "2026-11-16T08:29:00.000Z",
          reason: `${secret} timeout`,
        },
      ],
    },
    "2026-11-16T08:29:00.000Z",
  );
  expect(JSON.stringify(report)).not.toContain(secret);
  expect(report.gas[0].maximumBase).toBe("9007199254740993");
  expect(report.attempts[0].errorCategory).toBe("timeout");
  expect(report.locks[0].active).toBe(true);
});

test("unknown error text becomes a fixed category", () => {
  expect(feeErrorCategory(secret)).toBe("signer-configuration");
  expect(feeErrorCategory("sensitive arbitrary text")).toBe("other");
});

function transport(failTail = false) {
  const calls: { path: string; method: string; body?: any }[] = [];
  const request = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      calls.push({
        path,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (path.includes("/versions/"))
        return Response.json({
          success: true,
          result: {
            id: "c".repeat(36),
            resources: {
              bindings: [{ name: "FEE_DB", type: "d1", id: "b".repeat(36) }],
            },
          },
        });
      if (path.endsWith("/schedules"))
        return Response.json({
          success: true,
          result: { schedules: [{ cron: "* * * * *" }] },
        });
      if (path.endsWith("/query"))
        return Response.json({
          success: true,
          result: [{ success: true, results: [] }],
        });
      if (path.endsWith("/tails"))
        return Response.json({
          success: true,
          result: {
            id: "tail-id",
            url: "wss://tail.cloudflare.com/private-token",
          },
        });
      if (path.endsWith("/tails/tail-id"))
        return Response.json({ success: true });
      throw Error("unexpected endpoint");
    },
    { preconnect: fetch.preconnect },
  );
  const tail = async () => {
    if (failTail) throw Error(secret);
    return [];
  };
  return { request, calls, tail };
}

test("fixed queries are read-only and ephemeral tail is removed", async () => {
  const io = transport();
  const result = await inspectFeeOperations({
    account: "a".repeat(32),
    token: secret,
    database: "b".repeat(36),
    versionId: "c".repeat(36),
    ...io,
  });
  expect(result.expectedEveryMinute).toBe(true);
  expect(io.calls.map((call) => call.method)).toEqual([
    "GET",
    "GET",
    "POST",
    "POST",
    "POST",
    "POST",
    "DELETE",
  ]);
  const queries = io.calls
    .filter((call) => call.path.endsWith("/query"))
    .map((call) => call.body.sql);
  expect(queries).toHaveLength(3);
  expect(
    queries.every(
      (sql) => sql.startsWith("SELECT ") && !/raw_tx|quote|signature/.test(sql),
    ),
  ).toBe(true);
  expect(io.calls[5].body).toEqual({
    filters: [{ scriptVersion: "c".repeat(36) }],
  });
  expect(JSON.stringify(result)).not.toContain(secret);
});

test("tail failure still removes the ephemeral tail", async () => {
  const io = transport(true);
  await expect(
    inspectFeeOperations({
      account: "a".repeat(32),
      token: secret,
      database: "b".repeat(36),
      versionId: "c".repeat(36),
      ...io,
    }),
  ).rejects.toMatchObject({
    stage: "tail-transport",
    category: "signer-configuration",
  });
  expect(io.calls.at(-1)?.method).toBe("DELETE");
});

test("API failures retain only a static stage and category", async () => {
  const io = transport();
  const normal = io.request;
  io.request = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith("/query")
        ? new Response(secret, { status: 403 })
        : normal(input, init),
    { preconnect: fetch.preconnect },
  );
  await expect(
    inspectFeeOperations({
      account: "a".repeat(32),
      token: secret,
      database: "b".repeat(36),
      versionId: "c".repeat(36),
      ...io,
    }),
  ).rejects.toMatchObject({ stage: "locks-query", category: "authentication" });
});

test("wrong deployed D1 binding refuses before any database query", async () => {
  const io = transport();
  const normal = io.request;
  io.request = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes("/versions/")
        ? Response.json({
            success: true,
            result: {
              id: "c".repeat(36),
              resources: {
                bindings: [{ name: "FEE_DB", type: "d1", id: "d".repeat(36) }],
              },
            },
          })
        : normal(input, init),
    { preconnect: fetch.preconnect },
  );
  await expect(
    inspectFeeOperations({
      account: "a".repeat(32),
      token: secret,
      database: "b".repeat(36),
      versionId: "c".repeat(36),
      ...io,
    }),
  ).rejects.toMatchObject({ stage: "database-binding" });
  expect(io.calls).toHaveLength(0);
});

test("actual startup errors are categorized without retaining text", () => {
  const value = sanitizeFeeTail({
    scriptName: "slop-fee-converter",
    logs: [
      {
        message: [
          JSON.stringify({
            event: "fee_converter_network_error",
            network: "solana",
            error: `${secret} RPC fetch 429`,
          }),
        ],
      },
    ],
  });
  expect(value?.records).toEqual([
    {
      event: "fee_converter_network_error",
      network: "solana",
      errorCategory: "rpc-rate-limit",
    },
  ]);
  expect(JSON.stringify(value)).not.toContain(secret);
});

test("all fixed SELECTs execute against the actual migrated fee schema", async () => {
  const { sqlite } = sqliteD1();
  const io = transport();
  const normal = io.request;
  io.request = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).endsWith("/query")) return normal(input, init);
      const body = JSON.parse(String(init?.body));
      const results = sqlite.query(body.sql).all(...body.params);
      return Response.json({
        success: true,
        result: [{ success: true, results }],
      });
    },
    { preconnect: fetch.preconnect },
  );
  try {
    const result = await inspectFeeOperations({
      account: "a".repeat(32),
      token: secret,
      database: "b".repeat(36),
      versionId: "c".repeat(36),
      ...io,
    });
    expect(result.database.locks).toEqual([]);
    expect(result.database.gas).toEqual([]);
    expect(result.database.attempts).toEqual([]);
  } finally {
    sqlite.close();
  }
});

test("tail cleanup checks provider success even on HTTP 200", async () => {
  const io = transport();
  const normal = io.request;
  io.request = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "DELETE"
        ? Response.json({ success: false, errors: [{ message: secret }] })
        : normal(input, init),
    { preconnect: fetch.preconnect },
  );
  await expect(
    inspectFeeOperations({
      account: "a".repeat(32),
      token: secret,
      database: "b".repeat(36),
      versionId: "c".repeat(36),
      ...io,
    }),
  ).rejects.toMatchObject({
    stage: "tail-delete",
    message: "Fee operational inspection failed",
    completedReads: { expectedEveryMinute: true },
  });
});

test("RPC refusals cannot masquerade as a lease failure", () => {
  expect(
    feeErrorCategory("Solana getAccountInfo: Please use another endpoint"),
  ).toBe("rpc-unavailable");
  expect(feeErrorCategory("Solana getAccountInfo: IP blocked")).toBe(
    "rpc-blocked",
  );
  expect(feeErrorCategory("Solana getBalance: HTTP 403 forbidden")).toBe(
    "authentication",
  );
  expect(feeErrorCategory("Solana getBalance: 429 rate limit")).toBe(
    "rpc-rate-limit",
  );
  expect(feeErrorCategory("Fee conversion lock lost, lease expired")).toBe(
    "lease",
  );
});

test("RPC method diagnostic returns only an enumerated exact client prefix", () => {
  expect(feeRpcMethod("Solana getAccountInfo: Please retry " + secret)).toBe(
    "getAccountInfo",
  );
  expect(feeRpcMethod("Solana privateMethod: " + secret)).toBeUndefined();
  expect(feeRpcMethod(secret + " Solana getAccountInfo:")).toBeUndefined();
  const result = sanitizeFeeTail({
    scriptName: "slop-fee-converter",
    logs: [
      {
        message: [
          JSON.stringify({
            event: "fee_claim_error",
            network: "solana",
            error: "Solana getAccountInfo: IP blocked " + secret,
          }),
        ],
      },
    ],
  });
  expect(result?.records).toEqual([
    {
      event: "fee_claim_error",
      network: "solana",
      errorCategory: "rpc-blocked",
      rpcMethod: "getAccountInfo",
    },
  ]);
  expect(JSON.stringify(result)).not.toContain(secret);
});
