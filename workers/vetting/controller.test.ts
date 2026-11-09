// Source-only regression definitions; not executed in this audit. These use
// ephemeral local keys and synthetic HTTP bodies, not a deployed runner.
import { expect, test } from "bun:test";
import {
  MAX_CONTROLLER_BRIDGE_BYTES,
  readControllerBridgeHealth,
} from "./controller";
import type { VettingConnection, VettingServiceSigner } from "./service";

const revision = "a".repeat(40);
const imageSha256 = "b".repeat(64);
const healthy = { ok: true, revision, imageSha256 };
const keys = async (): Promise<VettingServiceSigner> =>
  (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
const connection = (
  signer: VettingServiceSigner,
  fetcher: typeof fetch,
): VettingConnection => ({
  ...signer,
  origin: "https://scanner.example",
  fetch: fetcher,
  now: () => new Date("2026-11-09T12:00:00.000Z"),
});

test("controller reads one signed runner-health body without following redirects", async () => {
  const signer = await keys();
  let calls = 0;
  const response = Response.json(healthy);
  const result = await readControllerBridgeHealth(
    connection(signer, (async (url, init) => {
      calls++;
      expect(String(url)).toBe(
        "https://scanner.example/api/v1/vetting/sandbox",
      );
      expect(init?.method).toBe("GET");
      expect(init?.body).toBeUndefined();
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).has("x-slop-vetting-signature")).toBe(
        true,
      );
      return response;
    }) as typeof fetch),
  );
  expect(result).toEqual(healthy);
  expect(response.bodyUsed).toBe(true);
  expect(calls).toBe(1);
});

test("a failed bridge request returns no fabricated health or response body", async () => {
  const signer = await keys();
  const failure = new Error("Synthetic transport failure");
  await expect(
    readControllerBridgeHealth(
      connection(signer, (async () => {
        throw failure;
      }) as typeof fetch),
    ),
  ).rejects.toBe(failure);
});

test("untrusted health fields cannot become truthy typed readiness values", async () => {
  const signer = await keys();
  expect(
    await readControllerBridgeHealth(
      connection(signer, (async () =>
        Response.json({
          ok: "true",
          revision: 123,
          imageSha256: { value: imageSha256 },
        })) as typeof fetch),
    ),
  ).toEqual({ ok: false, revision: null, imageSha256: null });
  // A string still needs the wrapper's exact revision and digest checks.
  expect(
    await readControllerBridgeHealth(
      connection(signer, (async () =>
        Response.json({
          ok: true,
          revision: "wrong revision",
          imageSha256: "wrong digest",
        })) as typeof fetch),
    ),
  ).toEqual({
    ok: true,
    revision: "wrong revision",
    imageSha256: "wrong digest",
  });
});

test("non-object readiness cannot qualify as a matching runner", async () => {
  const signer = await keys();
  for (const value of [null, true, "healthy", []]) {
    expect(
      await readControllerBridgeHealth(
        connection(signer, (async () => Response.json(value)) as typeof fetch),
      ),
    ).toEqual({ ok: false, revision: null, imageSha256: null });
  }
});

test("controller cancels refused bridge bodies before reporting unavailable", async () => {
  const signer = await keys();
  for (const status of [401, 503]) {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      { status },
    );
    await expect(
      readControllerBridgeHealth(
        connection(signer, (async () => response) as typeof fetch),
      ),
    ).rejects.toThrow("Deployed scanner bridge is unavailable");
    expect(cancelled).toBe(true);
  }
});

test("bridge cancellation failure preserves the original readiness refusal", async () => {
  const signer = await keys();
  const response = new Response(
    new ReadableStream({
      cancel() {
        throw new Error("Synthetic cancellation failure");
      },
    }),
    { status: 503 },
  );
  await expect(
    readControllerBridgeHealth(
      connection(signer, (async () => response) as typeof fetch),
    ),
  ).rejects.toThrow("Deployed scanner bridge is unavailable");
});

test("an oversized declared readiness body is cancelled before reading", async () => {
  const signer = await keys();
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
    {
      headers: { "content-length": String(MAX_CONTROLLER_BRIDGE_BYTES + 1) },
    },
  );
  await expect(
    readControllerBridgeHealth(
      connection(signer, (async () => response) as typeof fetch),
    ),
  ).rejects.toBeInstanceOf(RangeError);
  expect(cancelled).toBe(true);
});

test("the actual readiness stream is bounded even without a content length", async () => {
  const signer = await keys();
  let cancelled = false;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_CONTROLLER_BRIDGE_BYTES + 1));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  await expect(
    readControllerBridgeHealth(
      connection(signer, (async () => response) as typeof fetch),
    ),
  ).rejects.toBeInstanceOf(RangeError);
  expect(cancelled).toBe(true);
});

test("missing, malformed, non-UTF8 and interrupted health bodies cannot be accepted", async () => {
  const signer = await keys();
  for (const response of [
    new Response(null),
    new Response("not-json"),
    new Response(new Uint8Array([255])),
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("Synthetic body interruption"));
        },
      }),
    ),
  ]) {
    await expect(
      readControllerBridgeHealth(
        connection(signer, (async () => response) as typeof fetch),
      ),
    ).rejects.toThrow();
  }
});
