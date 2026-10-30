import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeLeaderboardParts } from "../src/lib/leaderboard-transport.mjs";
import { downloadLeaderboard } from "./download-leaderboard";

const url = "https://slop.cash/data/leaderboard.json";
const options = { retryDelayMs: 0, attemptTimeoutMs: 1_000 };
const legacy = new TextEncoder().encode('{ "retained": "unchanged é" }\n');
const large = new TextEncoder().encode(
  JSON.stringify({ retained: "x".repeat(26 * 1024 * 1024), label: "é" }) + "\n",
);
const publication = encodeLeaderboardParts(large);

async function withOutput(
  action: (output: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "slop-download-"));
  try {
    await action(join(directory, "leaderboard.json"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function publishedRequest(override?: (path: string) => Response | undefined) {
  const calls: string[] = [];
  const request = (async (input: RequestInfo | URL) => {
    const parsed = new URL(String(input));
    expect(parsed.origin).toBe("https://slop.cash");
    calls.push(parsed.pathname);
    const changed = override?.(parsed.pathname);
    if (changed) return changed;
    if (parsed.pathname === "/data/leaderboard.json")
      return new Response(new Uint8Array(publication.root).buffer);
    const part = publication.parts.find((p) => p.path === parsed.pathname);
    return part
      ? new Response(new Uint8Array(part.bytes).buffer)
      : new Response(null, { status: 404 });
  }) as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  return { request, calls };
}

test("legacy download keeps its exact bytes, whitespace and digest input", async () => {
  await withOutput(async (output) => {
    const request = (async () => new Response(legacy)) as (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => Promise<Response>;
    expect(
      await downloadLeaderboard(url, output, { ...options, request }),
    ).toBe(legacy.length);
    expect(new Uint8Array(await readFile(output))).toEqual(legacy);
  });
});

test("oversized publication downloads bounded parts into the original snapshot bytes", async () => {
  await withOutput(async (output) => {
    const source = publishedRequest();
    expect(
      await downloadLeaderboard(url, output, { ...options, ...source }),
    ).toBe(large.length);
    expect(new Uint8Array(await readFile(output))).toEqual(large);
    expect(source.calls).toEqual([
      "/data/leaderboard.json",
      ...publication.parts.map((p) => p.path),
    ]);
  });
});

test("missing or corrupted parts never replace the prior complete snapshot", async () => {
  for (const status of [404, 503, 200]) {
    await withOutput(async (output) => {
      await writeFile(output, legacy);
      const first = publication.parts[0].path;
      const source = publishedRequest((path) =>
        path === first ? new Response("corrupt", { status }) : undefined,
      );
      await expect(
        downloadLeaderboard(url, output, { ...options, ...source }),
      ).rejects.toThrow();
      expect(new Uint8Array(await readFile(output))).toEqual(legacy);
      expect(source.calls.filter((path) => path === first)).toHaveLength(
        status === 200 ? 1 : 3,
      );
    });
  }
});

test("a stalled request retries once recovered, and a total deadline leaves the old file intact", async () => {
  await withOutput(async (output) => {
    let attempts = 0;
    const request = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (++attempts > 1) return new Response(legacy);
      await new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason),
        );
      });
      throw new Error("unreachable");
    }) as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    await downloadLeaderboard(url, output, {
      request,
      attemptTimeoutMs: 10,
      totalTimeoutMs: 1_000,
      retryDelayMs: 0,
    });
    expect(attempts).toBe(2);
    expect(new Uint8Array(await readFile(output))).toEqual(legacy);
    const unavailable = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      await new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason),
        );
      });
      throw new Error("unreachable");
    }) as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    await expect(
      downloadLeaderboard(url, output, {
        request: unavailable,
        attemptTimeoutMs: 1_000,
        totalTimeoutMs: 10,
        retryDelayMs: 0,
      }),
    ).rejects.toThrow();
    expect(new Uint8Array(await readFile(output))).toEqual(legacy);
  });
});

test("off-origin part paths and unsupported roots are refused without remote reads", async () => {
  await withOutput(async (output) => {
    let calls = 0;
    const bad = JSON.parse(new TextDecoder().decode(publication.root));
    bad.parts[0].path = "https://other.invalid/part";
    const request = (async () => {
      calls++;
      return Response.json(bad);
    }) as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    await expect(
      downloadLeaderboard(url, output, { ...options, request }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
    await expect(
      downloadLeaderboard("http://slop.cash/data/leaderboard.json", output, {
        request,
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

test("parts over the retained byte limit fail without retry or partial output", async () => {
  await withOutput(async (output) => {
    const first = publication.parts[0].path;
    const source = publishedRequest((path) =>
      path === first
        ? new Response(new Uint8Array(8 * 1024 * 1024 + 1))
        : undefined,
    );
    await expect(
      downloadLeaderboard(url, output, { ...options, ...source }),
    ).rejects.toThrow();
    expect(source.calls.filter((path) => path === first)).toHaveLength(1);
    expect(await Bun.file(output).exists()).toBe(false);
  });
});
