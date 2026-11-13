import { expect, test } from "bun:test";
import {
  type PagesMetadata,
  pagesMetadata,
  requireReviewedPagesProject,
  SCANNER_PUBLIC_KEYS,
  scannerPagesConfiguration,
} from "./prepare-vetting-public-key";

const env = {
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  CLOUDFLARE_API_TOKEN: "private-test-token",
};
const metadata: PagesMetadata = {
  name: "eliza-computer",
  production_branch: "main",
  deployment_configs: {
    production: {
      env_vars: { EXISTING: { type: "plain_text", value: "retained" } },
    },
  },
};
function reader(outcomes: (() => Response)[]) {
  let calls = 0;
  const signals: (AbortSignal | null | undefined)[] = [];
  const waits: number[] = [];
  const transport = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(String(input)).toBe(
        `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/eliza-computer`,
      );
      expect(init?.method ?? "GET").toBe("GET");
      expect(init?.redirect).toBe("error");
      expect(init?.headers).toEqual({
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      });
      signals.push(init?.signal);
      return outcomes[Math.min(calls++, outcomes.length - 1)]();
    },
    { preconnect: fetch.preconnect },
  );
  return {
    read: () =>
      pagesMetadata("production", env, transport, async (milliseconds) => {
        waits.push(milliseconds);
      }),
    calls: () => calls,
    signals,
    waits,
  };
}
const accepted = () => Response.json({ success: true, result: metadata });

test("a transient Pages metadata response recovers without losing existing configuration", async () => {
  const r = reader([
    () => new Response("private-provider-body", { status: 503 }),
    accepted,
  ]);
  const remote = await r.read();
  expect(remote).toEqual(metadata);
  expect(
    scannerPagesConfiguration(
      {
        name: "eliza-computer",
        vars: { PUBLIC_SITE_URL: "https://slop.cash" },
      },
      remote,
      {
        schema: "slop-scanner-public-key-v1",
        target: "production",
        sourceSha: "b".repeat(40),
        publicKey: "public-key",
        sha256: "c".repeat(64),
      },
    ).vars,
  ).toMatchObject({
    EXISTING: "retained",
    [SCANNER_PUBLIC_KEYS]: "public-key",
  });
  expect(r.calls()).toBe(2);
  expect(r.waits).toEqual([1_000]);
});

test("the release preflight uses recovered metadata and still refuses another project or branch", async () => {
  const r = reader([
    () => new Response("temporary", { status: 503 }),
    accepted,
  ]);
  const remote = await r.read();
  expect(() => requireReviewedPagesProject(remote, "production")).not.toThrow();
  expect(() =>
    requireReviewedPagesProject(
      { ...remote, name: "slop-staging" },
      "production",
    ),
  ).toThrow("The reviewed Pages project contract drifted");
  expect(() =>
    requireReviewedPagesProject(
      { ...remote, production_branch: "development" },
      "production",
    ),
  ).toThrow("The reviewed Pages project contract drifted");
  expect(() =>
    requireReviewedPagesProject({ ...remote, name: undefined }, "production"),
  ).toThrow("The reviewed Pages project contract drifted");
});

test("network and rate-limit failures retry with a fresh timeout signal", async () => {
  const r = reader([
    () => {
      throw new Error("private-transport-detail");
    },
    () => new Response("private-provider-body", { status: 429 }),
    accepted,
  ]);
  expect(await r.read()).toEqual(metadata);
  expect(r.waits).toEqual([1_000, 2_000]);
  expect(new Set(r.signals).size).toBe(3);
  expect(r.signals.every((signal) => signal && !signal.aborted)).toBe(true);
});

test("failure to discard an unavailable response body does not block the next read", async () => {
  const r = reader([
    () =>
      new Response(
        new ReadableStream({
          cancel() {
            throw new Error("private-transport-detail");
          },
        }),
        { status: 503 },
      ),
    accepted,
  ]);
  expect(await r.read()).toEqual(metadata);
  expect(r.calls()).toBe(2);
});

for (const status of [401, 403, 404, 503]) {
  test(`HTTP ${status} stops at the permitted read bound and exposes only its status`, async () => {
    const r = reader([() => new Response("private-provider-body", { status })]);
    await expect(r.read()).rejects.toThrow(
      `Pages configuration could not be read (HTTP ${status})`,
    );
    expect(r.calls()).toBe(status === 503 ? 3 : 1);
    expect(r.waits).toEqual(status === 503 ? [1_000, 2_000] : []);
  });
}

test("repeated network failures stop without exposing transport details", async () => {
  const r = reader([
    () => {
      throw new Error("private-transport-detail");
    },
  ]);
  await expect(r.read()).rejects.toThrow(
    "Pages configuration could not be read after 3 attempts",
  );
  expect(r.calls()).toBe(3);
  expect(r.waits).toEqual([1_000, 2_000]);
});

test("invalid metadata does not become successful after a retry", async () => {
  const r = reader([
    () => Response.json({ success: true, result: {} }),
    accepted,
  ]);
  await expect(r.read()).rejects.toThrow("Pages configuration is unavailable");
  expect(r.calls()).toBe(1);
});

test("a recovered read cannot authorize a different scanner key", async () => {
  const r = reader([
    () => new Response("temporary", { status: 502 }),
    () =>
      Response.json({
        success: true,
        result: {
          ...metadata,
          deployment_configs: {
            production: {
              env_vars: {
                [SCANNER_PUBLIC_KEYS]: { type: "plain_text", value: "old-key" },
              },
            },
          },
        },
      }),
  ]);
  const remote = await r.read();
  expect(() =>
    scannerPagesConfiguration(
      {
        name: "eliza-computer",
        vars: { PUBLIC_SITE_URL: "https://slop.cash" },
      },
      remote,
      {
        schema: "slop-scanner-public-key-v1",
        target: "production",
        sourceSha: "b".repeat(40),
        publicKey: "new-key",
        sha256: "c".repeat(64),
      },
    ),
  ).toThrow("Existing scanner public keys differ; rotation is not authorized");
});
