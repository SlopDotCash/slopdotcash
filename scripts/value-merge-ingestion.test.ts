import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { publicGitProcess } from "./value-merge-ingestion";

const execute = promisify(execFile);

// An executable fixture sends an actual signal. The isolated parent gives only
// this Git invocation a different PATH, so other tests still use normal Git.
const gitFixture = `#!/bin/sh
fixture_directory=$(dirname "$0")
attempt=0
if [ -f "$fixture_directory/attempts" ]; then
  read -r attempt < "$fixture_directory/attempts"
fi
attempt=$((attempt + 1))
printf '%s\\n' "$attempt" > "$fixture_directory/attempts"
printf '%s\\n' "$@" > "$fixture_directory/args-$attempt"
case "$(cat "$fixture_directory/behavior"):$attempt" in
  recover:1|pipe:*)
    printf 'partial %s\\n' "$attempt"
    trap - PIPE
    kill -PIPE "$$"
    exit 91
    ;;
  term:*)
    kill -TERM "$$"
    exit 92
    ;;
  exit:*)
    printf 'invalid object\\n' >&2
    exit 128
    ;;
esac
printf 'verified object\\n'
printf 'verification detail\\n' >&2
`;

const child = `
  import { runPublicGit } from ${JSON.stringify(new URL("./value-merge-ingestion.ts", import.meta.url).href)};
  try {
    const result = await runPublicGit(
      process.env.GIT_FIXTURE_DIR,
      JSON.parse(process.env.GIT_FIXTURE_ARGS),
      4096,
    );
    console.log(JSON.stringify({ result }));
  } catch ({ code, signal, stdout, stderr }) {
    console.log(JSON.stringify({ error: { code, signal, stdout, stderr } }));
  }
`;

for (const [operation, behavior, attempts, result] of [
  [
    "rev-list",
    "recover",
    2,
    {
      result: { stdout: "verified object\n", stderr: "verification detail\n" },
    },
  ],
  [
    "rev-list",
    "pipe",
    2,
    {
      error: {
        code: null,
        signal: "SIGPIPE",
        stdout: "partial 2\n",
        stderr: "",
      },
    },
  ],
  [
    "rev-list",
    "term",
    1,
    { error: { code: null, signal: "SIGTERM", stdout: "", stderr: "" } },
  ],
  [
    "rev-list",
    "exit",
    1,
    {
      error: {
        code: 128,
        signal: null,
        stdout: "",
        stderr: "invalid object\n",
      },
    },
  ],
  [
    "fetch",
    "pipe",
    1,
    {
      error: {
        code: null,
        signal: "SIGPIPE",
        stdout: "partial 1\n",
        stderr: "",
      },
    },
  ],
  [
    "update-ref",
    "pipe",
    1,
    {
      error: {
        code: null,
        signal: "SIGPIPE",
        stdout: "partial 1\n",
        stderr: "",
      },
    },
  ],
] as const) {
  test(`native Git ${operation} with ${behavior} uses ${attempts} attempt(s)`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "slop-native-git-retry-"));
    try {
      await writeFile(join(directory, "git"), gitFixture, { mode: 0o755 });
      await writeFile(join(directory, "behavior"), behavior);
      const args = [operation, "--", "fixture arguments"];
      const { stdout } = await execute(process.execPath, ["--eval", child], {
        env: {
          PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
          GIT_FIXTURE_DIR: directory,
          GIT_FIXTURE_ARGS: JSON.stringify(args),
        },
      });
      expect(JSON.parse(stdout)).toEqual(result);
      const argv = `${publicGitProcess(directory, args).args.join("\n")}\n`;
      const files = (await readdir(directory)).filter((name) =>
        name.startsWith("args-"),
      );
      expect(files).toHaveLength(attempts);
      for (const name of files)
        expect(await readFile(join(directory, name), "utf8")).toBe(argv);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
}
