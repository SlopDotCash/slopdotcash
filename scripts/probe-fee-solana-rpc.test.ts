import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import {
  probeFeeSolanaRpc,
  requireSolanaProbeCandidate,
  safeProbeFailure,
  safeSolanaProbeResult,
  solanaProbeWorker,
} from "./probe-fee-solana-rpc";

const candidate =
  "https://mainnet.helius-rpc.com/?api-key=PRIVATE_CANDIDATE_KEY";
const envelope = (result: unknown) => Response.json({ success: true, result });
function result() {
  return {
    schemaVersion: 1,
    rows: ["candidate", "recovery"].map((provider) => ({
      provider,
      mainnet: true,
      finalizedSlot: 10,
      finalizedBlock: true,
      mintVerified: true,
      firstAvailableSlot: 0,
      reads: [
        "getGenesisHash",
        "getSlot",
        "getBlock",
        "getAccountInfo",
        "getFirstAvailableBlock",
      ].map((method) => ({ method, ok: true, httpStatus: 200, rpcCode: null })),
    })),
  };
}

test("candidate is an HTTPS Helius endpoint without userinfo or fragments", () => {
  expect(requireSolanaProbeCandidate(candidate)).toBe(candidate);
  for (const value of [
    "http://mainnet.helius-rpc.com",
    "https://private.invalid",
    `${candidate}#secret`,
    "https://user@mainnet.helius-rpc.com/",
  ])
    expect(() => requireSolanaProbeCandidate(value)).toThrow();
});

test("remote preview issues only fixed reads and never returns endpoint or account bytes", async () => {
  const calls: { endpoint: string; method: string; params: unknown[] }[] = [];
  const handler = runInNewContext(
    solanaProbeWorker.replace("export default", "globalThis.probe ="),
    {
      Response,
      URL,
      AbortSignal,
      atob,
      fetch: async (endpoint: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        calls.push({ endpoint, ...body });
        const responses: Record<string, unknown> = {
          getGenesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
          getSlot: 10,
          getBlock: { blockhash: "hash", previousBlockhash: "parent" },
          getAccountInfo: {
            value: {
              owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
              executable: false,
              data: [Buffer.alloc(82).toString("base64"), "base64"],
            },
          },
          getFirstAvailableBlock: 0,
        };
        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: responses[body.method],
        });
      },
    },
  );
  const response = await handler.fetch(
    new Request("https://probe.invalid/probe", {
      method: "POST",
      body: JSON.stringify({ candidate }),
    }),
  );
  const value = await response.json();
  const safe = safeSolanaProbeResult(value);
  expect(calls).toHaveLength(10);
  expect(calls.map((call) => call.method)).toEqual([
    ...Object.keys({
      getGenesisHash: 1,
      getSlot: 1,
      getBlock: 1,
      getAccountInfo: 1,
      getFirstAvailableBlock: 1,
    }),
    ...Object.keys({
      getGenesisHash: 1,
      getSlot: 1,
      getBlock: 1,
      getAccountInfo: 1,
      getFirstAvailableBlock: 1,
    }),
  ]);
  expect(JSON.stringify(safe)).not.toContain("PRIVATE_CANDIDATE_KEY");
  expect(JSON.stringify(safe)).not.toContain("helius");
  expect(
    safe.rows.every(
      (row: { mainnet: boolean; mintVerified: boolean }) =>
        row.mainnet && row.mintVerified,
    ),
  ).toBe(true);
  const bad = await handler.fetch(
    new Request("https://probe.invalid/probe", {
      method: "POST",
      body: JSON.stringify({ candidate, method: "sendTransaction" }),
    }),
  );
  expect(bad.status).toBe(400);
  expect(calls).toHaveLength(10);
});

test("preview transport never deploys or attaches a persistent binding", async () => {
  const calls: { url: string; method: string }[] = [];
  const request = Object.assign(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, method: init.method ?? "GET" });
      if (url.endsWith("/workers/subdomain"))
        return envelope({ subdomain: "fixture" });
      if (
        url.endsWith(
          "/workers/scripts/slop-fee-rpc-read-probe/subdomain/edge-preview",
        )
      )
        return envelope({ token: "PRIVATE_PREVIEW_SESSION" });
      if (url.endsWith("/edge-preview")) {
        const form = init.body as FormData;
        const metadata = JSON.parse(String(form.get("metadata")));
        expect(metadata.bindings).toEqual([]);
        expect(metadata.main_module).toBe("probe.js");
        expect(String(form.get("metadata"))).not.toContain(
          "PRIVATE_CANDIDATE_KEY",
        );
        expect(await (form.get("probe.js") as File).text()).toBe(
          solanaProbeWorker,
        );
        return envelope({ preview_token: "PRIVATE_PREVIEW_TOKEN" });
      }
      expect(url).toBe(
        "https://slop-fee-rpc-read-probe.fixture.workers.dev/probe",
      );
      expect(
        (init.headers as Record<string, string>)["cf-workers-preview-token"],
      ).toBe("PRIVATE_PREVIEW_TOKEN");
      expect(JSON.parse(String(init.body))).toEqual({ candidate });
      return Response.json({ ...result(), private: "PRIVATE_PREVIEW_TOKEN" });
    },
    { preconnect: fetch.preconnect },
  );
  const report = await probeFeeSolanaRpc({
    account: "a".repeat(32),
    token: "PRIVATE_CLOUDFLARE",
    candidate,
    request,
  });
  expect(calls.map((c) => c.method)).toEqual(["GET", "GET", "POST", "POST"]);
  expect(
    calls.every(
      (c) => !c.url.includes("/deployments") && !c.url.includes("/versions"),
    ),
  ).toBe(true);
  expect(JSON.stringify(report)).not.toContain("PRIVATE");
  expect(report.persistentBindings).toBe(0);
});

test("safe response rejects unknown RPC methods and drops arbitrary fields", () => {
  const value = result();
  (value as any).secret = candidate;
  expect(JSON.stringify(safeSolanaProbeResult(value))).not.toContain(candidate);
  value.rows[0].reads[0].method = "sendTransaction";
  expect(() => safeSolanaProbeResult(value)).toThrow();
});

test("remote refusal retains status only and never marks the candidate ready", async () => {
  const handler = runInNewContext(
    solanaProbeWorker.replace("export default", "globalThis.probe ="),
    {
      Response,
      URL,
      AbortSignal,
      atob,
      fetch: async () =>
        Response.json(
          {
            jsonrpc: "2.0",
            id: 1,
            error: { code: -32005, message: "PRIVATE_PROVIDER_RESPONSE" },
          },
          { status: 403 },
        ),
    },
  );
  const response = await handler.fetch(
    new Request("https://probe.invalid/probe", {
      method: "POST",
      body: JSON.stringify({ candidate }),
    }),
  );
  const safe = safeSolanaProbeResult(await response.json());
  expect(
    safe.rows.every(
      (row) => !row.mainnet && !row.mintVerified && !row.finalizedBlock,
    ),
  ).toBe(true);
  expect(
    safe.rows
      .flatMap((row) => row.reads)
      .every(
        (read) =>
          read.httpStatus === 403 && read.rpcCode === -32005 && !read.ok,
      ),
  ).toBe(true);
  expect(JSON.stringify(safe)).not.toContain("PRIVATE_PROVIDER_RESPONSE");
});

test("probe transport refusal returns only operation and numeric API codes", async () => {
  const secret = "private-endpoint-and-response";
  const request = Object.assign(
    async () =>
      Response.json(
        { success: false, errors: [{ code: 10000, message: secret }] },
        { status: 403 },
      ),
    { preconnect: fetch.preconnect },
  );
  let caught;
  try {
    await probeFeeSolanaRpc({
      account: "a".repeat(32),
      token: secret,
      candidate,
      request,
    });
  } catch (error) {
    caught = error;
  }
  expect(safeProbeFailure(caught)).toEqual({
    operation: "subdomain-read",
    httpStatus: 403,
    cloudflareCode: 10000,
  });
  expect(JSON.stringify(safeProbeFailure(caught))).not.toContain(secret);
});

test("probe transport errors never return external messages", async () => {
  const request = Object.assign(
    async () => {
      throw Error(candidate);
    },
    { preconnect: fetch.preconnect },
  );
  let caught;
  try {
    await probeFeeSolanaRpc({
      account: "a".repeat(32),
      token: "token",
      candidate,
      request,
    });
  } catch (error) {
    caught = error;
  }
  expect(safeProbeFailure(caught)).toEqual({
    operation: "subdomain-read",
    httpStatus: null,
    cloudflareCode: null,
  });
  expect(safeProbeFailure(Error(candidate))).toEqual({
    operation: "unknown",
    httpStatus: null,
    cloudflareCode: null,
  });
});

test("current Wrangler session path derives preview host and preserves fallback token", async () => {
  const calls: string[] = [];
  const request = Object.assign(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/workers/subdomain"))
        return envelope({ subdomain: "fallback" });
      if (url.endsWith("/subdomain/edge-preview"))
        return envelope({
          token: "ORIGINAL_TOKEN",
          exchange_url:
            "https://exchange.preview.cloudflareworkers.com/exchange",
        });
      if (url.includes("/exchange"))
        return new Response("PRIVATE_BODY", { status: 400 });
      if (url.endsWith("/edge-preview")) {
        expect((init.headers as any)["cf-preview-upload-config-token"]).toBe(
          "ORIGINAL_TOKEN",
        );
        return envelope({ preview_token: "PREVIEW_TOKEN" });
      }
      expect(url).toBe(
        "https://slop-fee-rpc-read-probe.preview.cloudflareworkers.com/probe",
      );
      return Response.json(result());
    },
    { preconnect: fetch.preconnect },
  );
  await probeFeeSolanaRpc({
    account: "a".repeat(32),
    token: "CF",
    candidate,
    request,
  });
  expect(calls[1]).toContain(
    "/workers/scripts/slop-fee-rpc-read-probe/subdomain/edge-preview",
  );
});

test("untrusted exchange host refuses before credential-bearing preview invocation", async () => {
  const calls: string[] = [];
  const request = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      return url.endsWith("/workers/subdomain")
        ? envelope({ subdomain: "fallback" })
        : envelope({
            token: "SECRET",
            exchange_url: "https://untrusted.invalid/exchange",
          });
    },
    { preconnect: fetch.preconnect },
  );
  let caught;
  try {
    await probeFeeSolanaRpc({
      account: "a".repeat(32),
      token: "CF",
      candidate,
      request,
    });
  } catch (error) {
    caught = error;
  }
  expect(safeProbeFailure(caught)).toEqual({
    operation: "session-exchange",
    httpStatus: null,
    cloudflareCode: null,
  });
  expect(calls).toHaveLength(2);
});

test("native Worker executes fixed RPC reads and preserves response refusal status", async () => {
  const calls: string[] = [];
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: "2026-09-14",
      script: solanaProbeWorker,
      outboundService: async (request: Request) => {
        const body = (await request.json()) as { method: string };
        calls.push(body.method);
        if (body.method === "getAccountInfo")
          return new Response("private provider refusal", { status: 403 });
        const result: Record<string, unknown> = {
          getGenesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
          getSlot: 10,
          getBlock: { blockhash: "block", previousBlockhash: "parent" },
          getFirstAvailableBlock: 0,
        };
        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: result[body.method],
        });
      },
    }),
  );
  try {
    const response = await runtime.dispatchFetch(
      "https://probe.invalid/probe",
      { method: "POST", body: JSON.stringify({ candidate }) },
    );
    const value = safeSolanaProbeResult(await response.json());
    expect(calls).toHaveLength(10);
    expect(value.rows.every((row) => row.mainnet && row.finalizedBlock)).toBe(
      true,
    );
    expect(
      value.rows.every(
        (row) =>
          row.reads.find((read) => read.method === "getAccountInfo")
            ?.httpStatus === 403,
      ),
    ).toBe(true);
    expect(value.rows.every((row) => row.mintVerified === false)).toBe(true);
    expect(
      value.rows.every(
        (row) =>
          row.reads.find((read) => read.method === "getAccountInfo")
            ?.errorCategory === "invalid-json",
      ),
    ).toBe(true);
    expect(JSON.stringify(value)).not.toContain("private provider refusal");
  } finally {
    await runtime.dispose();
  }
}, 30000);

test("probe exceptions and redirect bodies retain only fixed diagnostic categories", async () => {
  const handler = runInNewContext(
    solanaProbeWorker.replace("export default", "globalThis.probe ="),
    {
      Response,
      URL,
      AbortSignal,
      atob,
      fetch: async () => {
        throw new TypeError(candidate);
      },
    },
  );
  const response = await handler.fetch(
    new Request("https://probe.invalid/probe", {
      method: "POST",
      body: JSON.stringify({ candidate }),
    }),
  );
  const value = safeSolanaProbeResult(await response.json());
  expect(
    value.rows.every((row) =>
      row.reads.every((read) => read.errorCategory === "TypeError"),
    ),
  ).toBe(true);
  expect(JSON.stringify(value)).not.toContain(candidate);
});
