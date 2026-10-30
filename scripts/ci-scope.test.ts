import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const selector = resolve("scripts/ci-scope.mjs");
for (const path of [
  "skills/slop/SKILL.md",
  "src/lib/project-skill.mjs",
  "src/lib/project-skill-publication.mjs",
  "src/lib/install-command.ts",
  "scripts/skill-source-matches-commit.mjs",
  "scripts/skill-python.mjs",
  "scripts/skill-validation/quick_validate.py",
  "README.md",
]) {
  test(`installer coverage follows ${path}`, () => {
    const root = mkdtempSync(join(tmpdir(), "slop-ci-scope-"));
    try {
      const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
      git("init", "-q");
      git("config", "user.name", "CI fixture");
      git("config", "user.email", "fixture@example.invalid");
      git("commit", "--allow-empty", "-qm", "base");
      const base = git("rev-parse", "HEAD");
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), "fixture\n");
      git("add", ".");
      git("commit", "-qm", "affected source");
      const event = join(root, "event.json");
      const output = join(root, "output");
      writeFileSync(
        event,
        JSON.stringify({
          pull_request: {
            base: { ref: "development", sha: base },
            head: { ref: "fixture", sha: git("rev-parse", "HEAD") },
          },
        }),
      );
      execFileSync("node", [selector], {
        cwd: root,
        env: {
          ...process.env,
          GITHUB_EVENT_PATH: event,
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_OUTPUT: output,
        },
      });
      const lines = readFileSync(output, "utf8").split("\n");
      expect(lines).toContain(`installer=${path !== "README.md"}`);
      if (path === "skills/slop/SKILL.md") {
        const matrix = lines.find((line) => line.startsWith("browser_matrix="));
        if (!matrix) throw new Error("Browser matrix output is missing");
        expect(
          JSON.parse(matrix.slice("browser_matrix=".length)).include,
        ).toContainEqual({
          lane: "pages",
          server: "pages",
          browsers: "chromium",
          shard: "1/1",
          grep: "",
        });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

function git(cwd: string, ...args: string[]) {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=CI scope test",
      "-c",
      "user.email=ci-scope@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.autocrlf=false",
      ...args,
    ],
    { cwd, encoding: "utf8" },
  ).trim();
}

/** Runs the real selector for a contributor PR that changes `files`. */
function scopeFor(files: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), "slop-ci-scope-"));
  const repository = join(directory, "repository");
  try {
    mkdirSync(repository);
    git(repository, "init", "--quiet");
    writeFileSync(join(repository, "README.md"), "base\n");
    git(repository, "add", "-A");
    git(repository, "commit", "--quiet", "-m", "base");
    const base = git(repository, "rev-parse", "HEAD");
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(repository, path)), { recursive: true });
      writeFileSync(join(repository, path), content);
    }
    git(repository, "add", "-A");
    git(repository, "commit", "--quiet", "-m", "change");
    const head = git(repository, "rev-parse", "HEAD");
    const event = join(directory, "event.json");
    const output = join(directory, "output");
    writeFileSync(
      event,
      JSON.stringify({
        pull_request: {
          base: {
            ref: "development",
            sha: base,
            repo: { full_name: "SlopDotCash/slopdotcash" },
          },
          head: {
            ref: "fix/example",
            sha: head,
            repo: { full_name: "contributor/slopdotcash" },
          },
        },
      }),
    );
    execFileSync("node", [selector], {
      cwd: repository,
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_EVENT_PATH: event,
        GITHUB_OUTPUT: output,
      },
      stdio: "pipe",
    });
    return Object.fromEntries(
      readFileSync(output, "utf8")
        .trim()
        .split("\n")
        .map((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator), line.slice(separator + 1)];
        }),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function browserLanes(files: Record<string, string>) {
  const { include } = JSON.parse(scopeFor(files).browser_matrix);
  return (include as { lane: string }[]).map(({ lane }) => lane);
}

for (const path of [
  "workers/fee-converter/evm.ts",
  "backend/fee-conversions/handler.ts",
  "backend/payments/handler.ts",
]) {
  test(`native EVM accounting coverage follows ${path}`, () => {
    expect(scopeFor({ [path]: "export {};\n" }).evm).toBe("true");
  });
}

test("unrelated documentation does not select native EVM accounting", () => {
  expect(scopeFor({ "README.md": "Updated documentation.\n" }).evm).toBe(
    "false",
  );
});

const registryLanes = (lanes: string[]) =>
  lanes.filter((lane) => lane.startsWith("registry-"));

test("a changed registry-only browser test selects the registry lanes that run it", () => {
  // scripts/run-e2e.mjs runs @registry tests only in the registry phase; the
  // preview phase excludes them with --grep-invert.
  const lanes = browserLanes({
    "tests/e2e/evidence-download.spec.ts":
      'test("large private evidence downloads with a single-use browser grant @registry", async () => {});\n',
  });
  expect(registryLanes(lanes)).toEqual(["registry-1", "registry-2"]);
});

test("a changed registry runner or fixture server selects the registry lanes", () => {
  const files = [
    "scripts/run-e2e.mjs",
    "scripts/prepare-e2e-fixture.mjs",
    "playwright.config.ts",
    "tests/github-api-fixture.mjs",
  ];
  expect(
    Object.fromEntries(
      files.map((file) => [
        file,
        registryLanes(browserLanes({ [file]: "export {};\n" })),
      ]),
    ),
  ).toEqual(
    Object.fromEntries(
      files.map((file) => [file, ["registry-1", "registry-2"]]),
    ),
  );
});

test("a changed preview-only browser test keeps the preview and Pages lanes only", () => {
  expect(
    browserLanes({
      "tests/e2e/login.spec.ts":
        'test("serves GitHub login on direct navigation", async () => {});\n',
    }),
  ).toEqual(["preview-1", "preview-2", "pages"]);
});
