/** Restore complete published snapshot bytes from either supported transport. */
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readBoundedBytes } from "../src/lib/browser-json";
import {
  MAX_LEADERBOARD_BYTES,
  MAX_LEADERBOARD_PART_BYTES,
  readLeaderboardBytes,
} from "../src/lib/leaderboard-transport.mjs";

type DownloadOptions = {
  request?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  attemptTimeoutMs?: number;
  totalTimeoutMs?: number;
  retryDelayMs?: number;
};

export async function downloadLeaderboard(
  source: string,
  output: string,
  options: DownloadOptions = {},
): Promise<number> {
  const root = new URL(source);
  if (
    !["https://slop.cash", "https://staging.slop.cash"].includes(root.origin) ||
    root.pathname !== "/data/leaderboard.json" ||
    root.username ||
    root.password ||
    root.hash
  )
    throw new Error("Use the published production or staging leaderboard");
  // Avoid a cached manifest referring to parts from the previous deployment.
  root.searchParams.set("snapshot", randomUUID());
  const request = options.request ?? fetch;
  const total = AbortSignal.timeout(options.totalTimeoutMs ?? 600_000);
  const read = async (url: URL, maximum: number): Promise<Uint8Array> => {
    for (let attempt = 0; ; attempt++) {
      total.throwIfAborted();
      try {
        const response = await request(url, {
          redirect: "error",
          cache: "no-store",
          headers: { Accept: "application/json, application/octet-stream" },
          signal: AbortSignal.any([
            total,
            AbortSignal.timeout(options.attemptTimeoutMs ?? 180_000),
          ]),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`Published leaderboard returned ${response.status}`);
        }
        return await readBoundedBytes(response, maximum, "leaderboard");
      } catch (error) {
        if (total.aborted || attempt === 2 || error instanceof RangeError)
          throw error;
      }
      await new Promise<void>((done, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(total.reason);
        };
        const timer = setTimeout(() => {
          total.removeEventListener("abort", abort);
          done();
        }, options.retryDelayMs ?? 2_000);
        total.addEventListener("abort", abort, { once: true });
        if (total.aborted) abort();
      });
    }
  };
  const bytes = await readLeaderboardBytes(
    await read(root, MAX_LEADERBOARD_BYTES),
    async (path: string) => {
      const part = new URL(path, root);
      if (part.origin !== root.origin)
        throw new Error("Leaderboard part changed origin");
      return read(part, MAX_LEADERBOARD_PART_BYTES);
    },
  );
  // Keep exact reconstructed bytes: Points and monthly bases hash this source.
  const target = resolve(output);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
  return bytes.byteLength;
}

if (import.meta.main) {
  if (process.argv.length !== 4)
    throw new Error("Usage: download-leaderboard.ts <published URL> <output>");
  const bytes = await downloadLeaderboard(process.argv[2], process.argv[3]);
  console.log(`[Slop] restored ${bytes} published leaderboard bytes`);
}
