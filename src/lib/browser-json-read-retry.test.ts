import { afterEach, expect, test } from "bun:test";
import { fetchReadWithRetry } from "./browser-json";

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

function answers(...statuses: (number | Error)[]) {
  const seen: (string | undefined)[] = [];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    seen.push(init?.method);
    const next = statuses.shift();
    if (next === undefined) throw new Error("Unexpected extra request");
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify({ status: next }), { status: next });
  }) as typeof fetch;
  return seen;
}

test("a read the server failed is asked once more and the second answer is used", async () => {
  for (const failed of [500, 502, 503]) {
    const seen = answers(failed, 200);
    const response = await fetchReadWithRetry("/api/v1/x", {}, 1_000, 1);
    expect(response.status).toBe(200);
    expect(seen).toHaveLength(2);
  }
});

test("a second failure is returned as it is, with no third request", async () => {
  const seen = answers(500, 503);
  const response = await fetchReadWithRetry("/api/v1/x", {}, 1_000, 1);
  expect(response.status).toBe(503);
  expect(seen).toHaveLength(2);
});

test("answers that are not a server failure are never repeated", async () => {
  for (const status of [200, 401, 403, 404, 409, 429, 504]) {
    const seen = answers(status);
    expect((await fetchReadWithRetry("/api/v1/x", {}, 1_000, 1)).status).toBe(
      status,
    );
    expect(seen).toHaveLength(1);
  }
});

test("a write is never repeated", async () => {
  for (const method of ["POST", "PUT", "DELETE"]) {
    const seen = answers(500);
    expect(
      (await fetchReadWithRetry("/api/v1/x", { method }, 1_000, 1)).status,
    ).toBe(500);
    expect(seen).toEqual([method]);
  }
});

test("a cancelled read is not repeated", async () => {
  const controller = new AbortController();
  const seen = answers(500, 200);
  const pending = fetchReadWithRetry(
    "/api/v1/x",
    { signal: controller.signal },
    1_000,
    50,
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  await expect(pending).rejects.toThrow();
  expect(seen).toHaveLength(1);
});

test("a network failure is not repeated", async () => {
  const seen = answers(new TypeError("Failed to fetch"));
  await expect(fetchReadWithRetry("/api/v1/x", {}, 1_000, 1)).rejects.toThrow(
    "Failed to fetch",
  );
  expect(seen).toHaveLength(1);
});
