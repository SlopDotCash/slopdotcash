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
test("retained and fresh preparation have separate lanes, fresh main collections share one, with one production lock", () => {
  const prepare = workflow
    .split("  prepare:\n")[1]
    .split("    # The public elizaOS")[0];
  const group =
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions expression bytes.
    "group: slop-quality-${{ github.event.pull_request.number || github.ref }}-${{ github.ref == 'refs/heads/main' && github.event_name != 'pull_request' && (inputs.use_published_data == true && 'retained' || inputs.parallel_collection == true && 'collect-parallel' || 'collect') || github.event_name }}";
  const cancellation =
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions expression bytes.
    "cancel-in-progress: ${{ github.event_name == 'pull_request' }}";
  expect(prepare).toContain(group);
  expect(prepare).toContain(cancellation);
  expect(workflow.match(/^ {6}group: slop-production$/gm)).toHaveLength(1);
  const deployment = workflow.split("  deploy:\n")[1];
  expect(
    deployment.indexOf("Refuse older retained production data"),
  ).toBeLessThan(deployment.indexOf("Require scoped Cloudflare credentials"));
  const freshness = deployment
    .split("      - name: Refuse older retained production data\n")[1]
    .split("\n      - name:")[0];
  expect(freshness).toContain("inputs.use_published_data == true");
  expect(freshness).toContain("(inputs.rotate_robinhood_rpc_from || '') == ''");
  expect(freshness).toContain("(inputs.rotate_solana_rpc_from || '') == ''");
});
const step = (name: string) =>
  workflow.split(`      - name: ${name}\n`)[1].split("\n      - name:")[0];
const reserveHostedCollection = step(
  "Reserve checked bundle time for hosted main collection",
);
const liveCollection = step("Generate live contribution data").split(
  "        run: |\n",
)[1];

test("only fresh hosted main releases reserve the hosted collection deadline", () => {
  expect(reserveHostedCollection).toContain(
    "if: github.ref == 'refs/heads/main' && github.event_name != 'pull_request' && inputs.use_published_data != true && runner.environment == 'github-hosted'",
  );
});

for (const scenario of [
  {
    name: "hosted retry keeps the original absolute deadline",
    ref: "main",
    hosted: true,
    setupTime: 500,
    firstRunTime: 700,
    status: 0,
    lines: [
      "timeout 20420",
      "collect 120820000",
      "sleep 60",
      "timeout 19660",
      "collect 120820000",
    ],
  },
  {
    name: "hosted deadline refuses a retry that cannot fit",
    ref: "main",
    hosted: true,
    setupTime: 500,
    firstRunTime: 20270,
    status: 0,
    lines: [
      "timeout 20420",
      "collect 120820000",
      "fallback https://slop.cash/data/leaderboard.json",
    ],
  },
  {
    name: "hosted deadline refuses to start collection after setup exhausts the budget",
    ref: "main",
    hosted: true,
    setupTime: 20820,
    firstRunTime: 0,
    status: 1,
    lines: [],
  },
  {
    name: "dedicated collector retains its twenty-hour window and retry allowance",
    ref: "main",
    hosted: false,
    setupTime: 500,
    firstRunTime: 700,
    status: 0,
    lines: [
      "timeout 72100",
      "collect 172500000",
      "sleep 60",
      "timeout 72100",
      "collect 172500000",
    ],
  },
  {
    name: "staging retains the existing unwrapped retry",
    ref: "development",
    hosted: false,
    setupTime: 500,
    firstRunTime: 700,
    status: 0,
    lines: ["collect", "sleep 60", "collect"],
  },
] as const) {
  test(scenario.name, async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "slop-collection-deadline-"),
    );
    try {
      const script = `
        clock=100000
        calls=0
        date() { echo "$clock"; }
        sleep() { echo "sleep $1"; clock=$((clock + $1)); }
        timeout() { echo "timeout $3"; shift 3; "$@"; }
        bun() {
          case "$1" in
            run)
              [ "$2" = leaderboard:generate ] || return 1
              echo "collect $SLOP_DISCUSSION_DEADLINE_MS"
              calls=$((calls + 1))
              if [ "$calls" -eq 1 ]; then
                clock=$((clock + FIRST_RUN_TIME))
                return 75
              fi
              ;;
            scripts/download-leaderboard.ts)
              echo "fallback $2"
              echo '{}' > "$3"
              ;;
            *) return 1 ;;
          esac
        }
        if [ "$HOSTED" = true ]; then
          ${reserveHostedCollection.split("        run: |\n")[1]}
          source "$GITHUB_ENV"
        fi
        clock=$((clock + SETUP_TIME))
        ${liveCollection}
      `;
      const child = Bun.spawn([bashCommand(), "-euc", script], {
        cwd: directory,
        env: {
          ...Bun.env,
          GITHUB_ENV: join(directory, "github-env"),
          GITHUB_REF: `refs/heads/${scenario.ref}`,
          RUNNER_TEMP: directory,
          VITE_SLOP_ENVIRONMENT:
            scenario.ref === "main" ? "production" : "staging",
          SLOP_DISCUSSION_DEADLINE_MS: "",
          SLOP_PREPARE_COLLECT_UNTIL_SECONDS: "",
          SLOP_COLLECTION_DEADLINE_S:
            scenario.ref === "main" && !scenario.hosted ? "72000" : "18000",
          HOSTED: String(scenario.hosted),
          SETUP_TIME: String(scenario.setupTime),
          FIRST_RUN_TIME: String(scenario.firstRunTime),
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(stderr).toBe("");
      expect(code).toBe(scenario.status);
      expect(
        stdout
          .split("\n")
          .filter((line) => line && !line.startsWith("::"))
          .map((line) => line.trimEnd()),
      ).toEqual([...scenario.lines]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

const publishedDataGuard = step(
  "Require manual main or development release for published data",
).split("        run: |\n")[1];
for (const [name, event, ref, bootstrap, accepted] of [
  ["manual main", "workflow_dispatch", "refs/heads/main", "false", true],
  ["main push", "push", "refs/heads/main", "false", false],
  [
    "manual staging",
    "workflow_dispatch",
    "refs/heads/development",
    "false",
    true,
  ],
  ["staging push", "push", "refs/heads/development", "false", false],
  [
    "manual feature branch",
    "workflow_dispatch",
    "refs/heads/feature",
    "false",
    false,
  ],
  ["staging bootstrap", "workflow_dispatch", "refs/heads/main", "true", false],
  [
    "staging bootstrap on development",
    "workflow_dispatch",
    "refs/heads/development",
    "true",
    false,
  ],
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
const generation = step("Generate live contributor profiles");
const downloads = generation.match(
  /curl --fail --silent --show-error[^\n]*(?:\n {14}[^\n]*)*/g,
);
if (downloads?.length !== 1) {
  throw new Error("Expected profile history download");
}
for (const [name, download] of [["profile history", downloads[0]]] as const) {
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

test("no leaderboard workflow consumer fetches the published snapshot with raw curl", async () => {
  const escrow = await readFile(
    new URL("../.github/workflows/escrow-tests.yml", import.meta.url),
    "utf8",
  );
  for (const source of [workflow, escrow]) {
    expect(source).not.toMatch(
      /curl[\s\S]{0,400}https:\/\/slop\.cash\/data\/leaderboard\.json/,
    );
  }
});
