import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const workflow = await readFile(
  new URL("../.github/workflows/deploy.yml", import.meta.url),
  "utf8",
);
const generation = workflow
  .split("      - name: Generate live contribution data\n")[1]
  .split("\n      - name:")[0];
const downloads = generation.match(
  /curl --fail --silent --show-error[^\n]*(?:\n {14}[^\n]*)*/g,
);
if (downloads?.length !== 2) {
  throw new Error("Expected profile and fallback leaderboard downloads");
}

for (const [index, download] of downloads.entries()) {
  const name = index === 0 ? "profile history" : "fallback leaderboard";
  for (const failure of ["timeout", "unavailable", "missing"] as const) {
    test(`${name}: ${failure === "timeout" ? "retries a stalled transfer and decodes the complete snapshot" : `refuses a persistently ${failure} snapshot`}`, async () => {
      const directory = await mkdtemp(join(tmpdir(), "slop-snapshot-"));
      const output = join(directory, "snapshot.json");
      const snapshot = JSON.stringify({
        history: "retained record ".repeat(1000),
      });
      let attempts = 0;
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          attempts++;
          if (failure === "missing")
            return new Response("missing", { status: 404 });
          if (failure === "unavailable")
            return new Response("unavailable", { status: 503 });
          if (attempts === 1) {
            // A stalled origin must not permanently block the release.
            await Bun.sleep(300);
          }
          expect(request.headers.get("accept-encoding")).toContain("gzip");
          return new Response(gzipSync(snapshot), {
            headers: { "Content-Encoding": "gzip" },
          });
        },
      });
      try {
        // Run the workflow's actual curl command. Only substitute local HTTP
        // transport, output paths and shorter deadlines for this fixture.
        const command = download
          .replaceAll("$profile_origin", server.url.origin)
          .replaceAll("$previous_profiles", output)
          .replaceAll("public/data/leaderboard.json", output)
          .replace("'=https'", "'=http'")
          .replace(/--max-time \d+/, "--max-time 0.1")
          .replace(/--retry-delay \d+/, "--retry-delay 0")
          .replace(/--retry-max-time \d+/, "--retry-max-time 5");
        const process = Bun.spawn(["bash", "-euc", command], {
          stdout: "pipe",
          stderr: "pipe",
        });
        const [code] = await Promise.all([
          process.exited,
          new Response(process.stdout).text(),
          new Response(process.stderr).text(),
        ]);
        if (failure === "timeout") {
          expect(code).toBe(0);
          expect(attempts).toBe(2);
          expect(await readFile(output, "utf8")).toBe(snapshot);
        } else {
          expect(code).not.toBe(0);
          expect(attempts).toBe(failure === "missing" ? 1 : 3);
        }
      } finally {
        server.stop(true);
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
}
