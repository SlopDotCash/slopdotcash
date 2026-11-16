import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import {
  probeFeeSolanaRpc,
  requireSolanaProbeCandidate,
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
      if (url.endsWith("/workers/subdomain/edge-preview"))
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
