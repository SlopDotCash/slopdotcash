import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { bashCommand } from "./bash-command";

const workflow = await readFile(
  new URL("../.github/workflows/deploy.yml", import.meta.url),
  "utf8",
);
const step = (name: string) =>
  workflow.split(`      - name: ${name}\n`)[1].split("\n      - name:")[0];
const publishedDataGuard = step(
  "Require manual main release for published data",
).split("        run: |\n")[1];
for (const [name, event, ref, bootstrap, accepted] of [
  ["manual main", "workflow_dispatch", "refs/heads/main", "false", true],
  ["main push", "push", "refs/heads/main", "false", false],
  [
    "manual staging",
    "workflow_dispatch",
    "refs/heads/development",
    "false",
    false,
  ],
  ["staging bootstrap", "workflow_dispatch", "refs/heads/main", "true", false],
] as const) {
  test(`published data release ${accepted ? "accepts" : "refuses"} ${name}`, async () => {
    const process = Bun.spawn([bashCommand(), "-euc", publishedDataGuard], {
      env: {
        ...Bun.env,
        GITHUB_EVENT_NAME: event,
        GITHUB_REF: ref,
        BOOTSTRAP_STAGING_PROFILES: bootstrap,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await process.exited).toBe(accepted ? 0 : 1);
  });
}
const generation = step("Generate live contribution data");
const downloads = generation.match(
  /curl --fail --silent --show-error[^\n]*(?:\n {14}[^\n]*)*/g,
);
if (downloads?.length !== 2) {
  throw new Error("Expected profile and fallback leaderboard downloads");
}
// Pull-request checks read the largest snapshot from the same public origin.
const pullRequestLedger = step(
  "Load deployed public ledger for pull-request checks",
).match(/curl --fail --silent --show-error \\(?:\n {12}[^\n]*)*/)?.[0];
if (!pullRequestLedger) {
  throw new Error("Expected the pull-request ledger download");
}

for (const [name, download] of [
  ["profile history", downloads[0]],
  ["fallback leaderboard", downloads[1]],
  ["pull-request ledger", pullRequestLedger],
] as const) {
  for (const failure of [
    "timeout",
    "disconnect",
    "unavailable",
    "missing",
  ] as const) {
    const recovers = failure === "timeout" || failure === "disconnect";
    test(`${name}: ${recovers ? `recovers a ${failure} and decodes the complete snapshot` : `refuses a persistently ${failure} snapshot`}`, async () => {
      const directory = await mkdtemp(join(tmpdir(), "slop-snapshot-"));
      const output = join(directory, "snapshot.json");
      const snapshot = JSON.stringify({
        history: "retained record ".repeat(1000),
      });
      let attempts = 0;
      const compressed = gzipSync(snapshot);
      const server = createServer(async (request, response) => {
        attempts++;
        if (failure === "missing" || failure === "unavailable") {
          response.writeHead(failure === "missing" ? 404 : 503);
          response.end(failure);
          return;
        }
        if (attempts === 1 && failure === "timeout") {
          // A stalled origin must not permanently block the release.
          await Bun.sleep(1500);
        }
        expect(request.headers["accept-encoding"]).toContain("gzip");
        response.writeHead(200, {
          "Content-Encoding": "gzip",
          "Content-Length": compressed.length,
        });
        if (attempts === 1 && failure === "disconnect") {
          response.write(compressed.subarray(0, compressed.length / 2));
          setTimeout(() => response.destroy(), 20);
        } else response.end(compressed);
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing test server port");
      try {
        // Run the workflow's actual curl command. Only substitute local HTTP
        // transport, output paths and shorter deadlines for this fixture.
        // The output path goes through the environment, as in the workflow,
        // so bash never parses it. An unquoted Windows path loses its
        // backslashes and curl writes into the working directory.
        // One healthy local attempt can take about 100 ms on Windows, so it
        // gets a full second. A retry delay of 0 selects curl's default
        // backoff (1 s, then 2 s), so 1 s is the shortest fixed delay.
        // On Windows, System32 curl lacks zlib/compression and shadows Git's curl.
        // Fall back to Git for Windows' curl when the selected curl rejects --compressed.
        const win32Prefix =
          globalThis.process.platform === "win32"
            ? 'if ! curl --compressed --version >/dev/null 2>&1 && [ -x /mingw64/bin/curl.exe ] && /mingw64/bin/curl.exe --compressed --version >/dev/null 2>&1; then export PATH="/mingw64/bin:$PATH"; fi; '
            : "";
        const command =
          win32Prefix +
          download
            .replaceAll("$profile_origin", `http://127.0.0.1:${address.port}`)
            .replaceAll("https://slop.cash", `http://127.0.0.1:${address.port}`)
            .replaceAll("public/data/leaderboard.json", '"$previous_profiles"')
            .replace("'=https'", "'=http'")
            .replace(/--max-time \d+/, "--max-time 1")
            .replace(/--retry-delay \d+/, "--retry-delay 1")
            .replace(/--retry-max-time \d+/, "--retry-max-time 5");
        const process = Bun.spawn([bashCommand(), "-euc", command], {
          env: { ...Bun.env, previous_profiles: output, ledger_file: output },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [code] = await Promise.all([
          process.exited,
          new Response(process.stdout).text(),
          new Response(process.stderr).text(),
        ]);
        if (recovers) {
          expect(code).toBe(0);
          expect(attempts).toBe(2);
          expect(await readFile(output, "utf8")).toBe(snapshot);
        } else {
          expect(code).not.toBe(0);
          expect(attempts).toBe(3);
        }
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
}
