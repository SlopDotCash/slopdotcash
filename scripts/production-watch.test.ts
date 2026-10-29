import { expect, test } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { runProductionWatch } from "./production-watch";

// Response bodies trimmed from the live slop.cash shapes of 28 October 2026:
// the registry's escrow.deployments and the vault route's snapshots,
// staleAfterMs and servedAt fields.
const ORIGIN = "https://slop.cash";
const SLOPBOT = "https://slopbot.slop.cash/health";
const IDENTITY = "https://identity.slop.cash/v1/oauth/authorize";
const NOW = new Date("2026-10-28T17:00:00.000Z");
const BASE_VAULT = "0x6c1297c3b96a00347cb501f572cb5811c2a8ed36";
const SOLANA_VAULT = "6NhxSaed6SF3uCAgzQViCZixETGpvxuFzo5eRGiaGM7";

function registry() {
  return {
    schemaVersion: "1",
    projects: [
      {
        schemaVersion: "1",
        id: "slopdotcash",
        listingTier: "featured",
        status: "active",
        escrow: {
          deployments: [
            {
              network: "base-mainnet",
              factory: "0xe51abf8c6dbb3ca6e9ad09f2dc6ef141d7364aab",
              vault: BASE_VAULT,
              asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            },
          ],
        },
      },
      {
        schemaVersion: "1",
        id: "asi",
        listingTier: "community",
        status: "paused",
        escrow: { deployments: [] },
      },
      { schemaVersion: "1", id: "canonry", status: "paused" },
    ],
    restrictions: [],
  };
}

function vault(observedAt: string | null | undefined) {
  return {
    projectId: "slopdotcash",
    snapshots:
      observedAt === undefined
        ? []
        : [
            {
              projectId: "slopdotcash",
              network: "base-mainnet",
              chain: "base",
              vault: BASE_VAULT,
              assetDecimals: 6,
              totalDeposited: "1001000000",
              freeBalance: "1000000000",
              blockNumber: "53207989",
              blockTime: "2026-10-28T16:35:25.000Z",
              observedAt,
            },
          ],
    staleAfterMs: 1_800_000,
    servedAt: NOW.toISOString(),
  };
}

type Route = { status?: number; body?: unknown; error?: Error };

function site(overrides: Record<string, Route> = {}) {
  const routes: Record<string, Route> = {
    [`${ORIGIN}/`]: { body: "<!doctype html>" },
    [SLOPBOT]: { body: { service: "slopbot", ok: true } },
    [IDENTITY]: { status: 400, body: { error: "invalid_request" } },
    [`${ORIGIN}/api/v1/projects`]: { body: registry() },
    [`${ORIGIN}/api/v1/payments/projects/slopdotcash/vault`]: {
      body: vault("2026-10-28T16:55:59.635Z"),
    },
    ...overrides,
  };
  const requested: string[] = [];
  const fetcher = async (url: string) => {
    requested.push(url);
    const route = routes[url];
    if (!route) return new Response("not found", { status: 404 });
    if (route.error) throw route.error;
    return new Response(
      typeof route.body === "string" ? route.body : JSON.stringify(route.body),
      { status: route.status ?? 200 },
    );
  };
  return { fetcher, requested };
}

async function run(overrides?: Record<string, Route>) {
  const { fetcher, requested } = site(overrides);
  const results = await runProductionWatch({ fetcher, now: () => NOW });
  return { results, requested, failed: results.filter((r) => !r.ok) };
}

test("a fresh registered vault and healthy endpoints pass; vaultless projects are skipped", async () => {
  const { results, failed, requested } = await run();
  expect(failed).toEqual([]);
  expect(results.map((r) => r.check)).toEqual([
    "site home",
    "identity sign-in",
    "slopbot health",
    "registry api",
    `vault slopdotcash base-mainnet ${BASE_VAULT}`,
  ]);
  expect(requested.filter((url) => url.includes("/vault"))).toEqual([
    `${ORIGIN}/api/v1/payments/projects/slopdotcash/vault`,
  ]);
});

test("a snapshot older than the published staleAfterMs fails", async () => {
  const { failed } = await run({
    [`${ORIGIN}/api/v1/payments/projects/slopdotcash/vault`]: {
      body: vault("2026-10-28T13:34:36.204Z"),
    },
  });
  expect(failed).toHaveLength(1);
  expect(failed[0].detail).toStartWith(
    "stale: observed 2026-10-28T13:34:36.204Z",
  );
});

test("the limit is the staleAfterMs the response publishes, not a local constant", async () => {
  const body = { ...vault("2026-10-28T16:55:59.635Z"), staleAfterMs: 60_000 };
  const { failed } = await run({
    [`${ORIGIN}/api/v1/payments/projects/slopdotcash/vault`]: { body },
  });
  expect(failed.map((r) => r.detail)).toEqual([
    "stale: observed 2026-10-28T16:55:59.635Z, age 4 min (limit 1 min)",
  ]);
});

test("a missing snapshot or observation time fails instead of reading as fresh", async () => {
  for (const observedAt of [undefined, null, ""]) {
    const { failed } = await run({
      [`${ORIGIN}/api/v1/payments/projects/slopdotcash/vault`]: {
        body: vault(observedAt),
      },
    });
    expect(failed).toHaveLength(1);
    expect(failed[0].check).toBe(
      `vault slopdotcash base-mainnet ${BASE_VAULT}`,
    );
  }
  const { failed } = await run({
    [`${ORIGIN}/api/v1/payments/projects/slopdotcash/vault`]: {
      body: { ...vault("2026-10-28T16:55:59.635Z"), staleAfterMs: undefined },
    },
  });
  expect(failed.map((r) => r.detail)).toEqual([
    "response publishes no staleAfterMs",
  ]);
});

test("a failed registry fetch fails and checks no vault", async () => {
  for (const route of [
    { status: 503, body: "unavailable" },
    { body: "not json" },
    { body: { schemaVersion: "1", projects: [] } },
    {
      body: {
        ...registry(),
        projects: [
          ...registry().projects,
          {
            schemaVersion: "1",
            id: "thenetwork",
            escrow: { deployments: [{ network: "robinhood-mainnet" }] },
          },
        ],
      },
    },
  ]) {
    const { failed, requested } = await run({
      [`${ORIGIN}/api/v1/projects`]: route,
    });
    expect(failed.map((r) => r.check)).toEqual(["registry api"]);
    expect(requested.some((url) => url.includes("/vault"))).toBe(false);
  }
});

test("a non-2xx or unreachable endpoint fails its check", async () => {
  const home = await run({
    [`${ORIGIN}/`]: { status: 502, body: "bad gateway" },
  });
  expect(home.failed.map((r) => [r.check, r.detail.split(" (")[0]])).toEqual([
    ["site home", "HTTP 502"],
  ]);
  const slopbot = await run({ [SLOPBOT]: { error: new TypeError("refused") } });
  expect(slopbot.failed.map((r) => [r.check, r.detail])).toEqual([
    ["slopbot health", "request failed"],
  ]);
  const unhealthy = await run({
    [SLOPBOT]: { body: { service: "slopbot", ok: false } },
  });
  expect(unhealthy.failed.map((r) => r.check)).toEqual(["slopbot health"]);
  const vaultDown = await run({
    [`${ORIGIN}/api/v1/payments/projects/slopdotcash/vault`]: {
      status: 500,
      body: "error",
    },
  });
  expect(vaultDown.failed.map((r) => r.check)).toEqual([
    `vault slopdotcash base-mainnet ${BASE_VAULT}`,
  ]);
});

test("an identity outage fails the watch even while the site and vault stay healthy", async () => {
  let status = 503;
  let body = { error: "unavailable" };
  let calls = 0;
  const identity = createServer((_request, response) => {
    calls += 1;
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) =>
    identity.listen(0, "127.0.0.1", resolve),
  );
  const { port } = identity.address() as AddressInfo;
  const identityProbeUrl = `http://127.0.0.1:${port}/v1/oauth/authorize`;
  const runWatch = () =>
    runProductionWatch({
      now: () => NOW,
      fetcher: (url, init) =>
        url === identityProbeUrl ? fetch(url, init) : site().fetcher(url),
      identityProbeUrl,
    });
  try {
    const unavailable = await runWatch();
    expect(
      unavailable.filter((result) => !result.ok).map((r) => r.check),
    ).toEqual(["identity sign-in"]);
    status = 400;
    body = { error: "invalid_request" };
    expect((await runWatch()).every((result) => result.ok)).toBe(true);
    for (const invalidStatus of [200, 400]) {
      status = invalidStatus;
      body = { error: "unavailable" };
      expect(
        (await runWatch()).filter((r) => !r.ok).map((r) => r.check),
      ).toEqual(["identity sign-in"]);
    }
    expect(calls).toBe(4);
  } finally {
    identity.closeAllConnections();
    await new Promise<void>((resolve) => identity.close(() => resolve()));
  }
});

test("a request that exceeds the bound times out as a failure, without retry", async () => {
  let calls = 0;
  // Stall the home request on a real connection that never answers, as a
  // stalled network does. A promise that only waits for the abort event
  // leaves no other pending work, and Bun 1.3.14 on Windows then never fires
  // AbortSignal.timeout: the test stops progressing at full CPU.
  const stalled = createServer(() => {});
  await new Promise<void>((resolve) => stalled.listen(0, "127.0.0.1", resolve));
  const { port } = stalled.address() as AddressInfo;
  try {
    const results = await runProductionWatch({
      now: () => NOW,
      timeoutMs: 20,
      fetcher: async (url, init) => {
        if (url !== `${ORIGIN}/`) return site().fetcher(url);
        calls += 1;
        return await fetch(`http://127.0.0.1:${port}/`, init);
      },
    });
    expect(calls).toBe(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, check: "site home", detail: "timed out after 20 ms" },
    ]);
  } finally {
    stalled.closeAllConnections();
    await new Promise<void>((resolve) => stalled.close(() => resolve()));
  }
});

test("an inactive network's old snapshot passes, but it must still exist", async () => {
  const solana = (observedAt: string | undefined) => ({
    projectId: "eliza",
    snapshots:
      observedAt === undefined
        ? []
        : [
            {
              projectId: "eliza",
              network: "solana-mainnet",
              chain: "solana",
              vault: SOLANA_VAULT,
              observedAt,
            },
          ],
    staleAfterMs: 1_800_000,
    servedAt: NOW.toISOString(),
  });
  const withEliza = registry();
  withEliza.projects.push({
    schemaVersion: "1",
    id: "eliza",
    listingTier: "featured",
    status: "active",
    escrow: {
      deployments: [
        {
          network: "solana-mainnet",
          factory: "",
          vault: SOLANA_VAULT,
          asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        },
      ],
    },
  });
  const route = (observedAt: string | undefined) => ({
    [`${ORIGIN}/api/v1/projects`]: { body: withEliza },
    [`${ORIGIN}/api/v1/payments/projects/eliza/vault`]: {
      body: solana(observedAt),
    },
  });
  const old = await run(route("2026-10-28T13:34:34.541Z"));
  expect(old.failed).toEqual([]);
  expect(
    old.results.find((r) => r.check.includes("solana-mainnet"))?.detail,
  ).toBe(
    "network not activated, no refresh expected; last observed 2026-10-28T13:34:34.541Z",
  );
  const missing = await run(route(undefined));
  expect(missing.failed.map((r) => [r.check, r.detail])).toEqual([
    [
      `vault eliza solana-mainnet ${SOLANA_VAULT}`,
      "no cached snapshot for this vault",
    ],
  ]);
});

test("a Solana snapshot that differs only by vault case does not stand in for the registered vault", async () => {
  const flipped = `6nhxSaed6SF3uCAgzQViCZixETGpvxuFzo5eRGiaGM7`;
  const withEliza = registry();
  withEliza.projects.push({
    schemaVersion: "1",
    id: "eliza",
    listingTier: "featured",
    status: "active",
    escrow: {
      deployments: [
        {
          network: "solana-mainnet",
          factory: "",
          vault: SOLANA_VAULT,
          asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        },
      ],
    },
  });
  const { failed } = await run({
    [`${ORIGIN}/api/v1/projects`]: { body: withEliza },
    [`${ORIGIN}/api/v1/payments/projects/eliza/vault`]: {
      body: {
        projectId: "eliza",
        snapshots: [
          {
            projectId: "eliza",
            network: "solana-mainnet",
            chain: "solana",
            vault: flipped,
            observedAt: "2026-10-28T16:59:00.000Z",
          },
        ],
        staleAfterMs: 1_800_000,
        servedAt: NOW.toISOString(),
      },
    },
  });
  expect(failed.map((r) => [r.check, r.detail])).toEqual([
    [
      `vault eliza solana-mainnet ${SOLANA_VAULT}`,
      "no cached snapshot for this vault",
    ],
  ]);
});

test("an EVM snapshot in checksummed case still matches the registered vault", async () => {
  const checksummed = await run({
    [`${ORIGIN}/api/v1/payments/projects/slopdotcash/vault`]: {
      body: {
        ...vault("2026-10-28T16:55:59.635Z"),
        snapshots: [
          {
            projectId: "slopdotcash",
            network: "base-mainnet",
            chain: "base",
            vault: "0x6C1297C3B96A00347CB501F572CB5811C2A8ED36",
            observedAt: "2026-10-28T16:55:59.635Z",
          },
        ],
      },
    },
  });
  expect(checksummed.failed).toEqual([]);
});
