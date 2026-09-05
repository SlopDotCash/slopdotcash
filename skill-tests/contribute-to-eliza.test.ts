/**
 * Verifies the bundled contributor skill, its local references, and its
 * read-only GitHub report using deterministic API fixtures.
 */

import assert from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  acquireLiveReportLock,
  auditCommentDisclosures,
  auditPrEvidence,
  CLAIM_RECENCY_DAYS,
  closingIssueNumbers,
  collectLiveReport,
  completeReviewEpoch,
  createGhCommandBudget,
  createReviewEpoch,
  ensureLiveReportLockRoot,
  isBotAccount,
  LiveInventoryChangedError,
  MAX_ACTIVITY_CONNECTION_ITEMS,
  MAX_API_READS,
  MAX_REVIEW_EPOCH_CANDIDATES,
  MIN_REST_ACTIVITY_REQUESTS,
  MIN_SEARCH_ACTIVITY_REQUESTS,
  MISSION_READY_LABEL,
  parseCliArguments,
  parseModelDisclosure,
  parsePaginatedJson,
  REQUIRED_EVIDENCE_ROWS,
  readGhAuthenticatedIdentity,
  readGhOpenActivity,
  readGhPages,
  readLivePullHead,
  readLiveReportProcessIdentity,
  readProjectSelectionPolicy,
  recheckReviewEpochCandidate,
  renderMarkdown,
  retryChangedLiveInventory,
} from "../skills/contribute-to-eliza/scripts/live-report.mjs";
import {
  isRepositoryRoot,
  normalizeSessionReport,
  usageDelta,
} from "../skills/contribute-to-eliza/scripts/run-receipt.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const skillDir = join(testDir, "..", "skills", "contribute-to-eliza");
const skillPath = join(skillDir, "SKILL.md");
const liveReportPath = join(skillDir, "scripts", "live-report.mjs");
const runReceiptPath = join(skillDir, "scripts", "run-receipt.mjs");
const NOW = new Date("2026-01-20T12:00:00.000Z");
const HEAD_SHA = "a".repeat(40);
const PRIOR_SHA = "b".repeat(40);

const configuredNodeExecutable = process.env.SLOP_TEST_NODE ?? "node";
const nodeExecutable = configuredNodeExecutable;
let pinnedNodeRuntimeChecked = false;

function assertPinnedNodeRuntime(): void {
  if (pinnedNodeRuntimeChecked) return;
  const configuredNodeRuntime = spawnSync(
    configuredNodeExecutable,
    [
      "-p",
      "JSON.stringify({ executable: process.execPath, version: process.versions.node })",
    ],
    { encoding: "utf8" },
  );
  assert.strictEqual(
    configuredNodeRuntime.status,
    0,
    configuredNodeRuntime.stderr,
  );
  const nodeRuntime = JSON.parse(configuredNodeRuntime.stdout) as {
    version: string;
  };
  assert.strictEqual(nodeRuntime.version, "24.15.0");
  pinnedNodeRuntimeChecked = true;
}

function createLiveReportGhFixture() {
  assertPinnedNodeRuntime();
  const root = mkdtempSync(join(tmpdir(), "slop-live-report-lock-test-"));
  const identityId = Number.parseInt(randomBytes(6).toString("hex"), 16);
  const shimDirectory = join(root, "bin");
  const logPath = join(root, "gh-commands.ndjson");
  const readyPath = join(root, "discovery-ready");
  const releasePath = join(root, "discovery-release");
  const donePath = join(root, "discovery-done");
  const pidPath = join(root, "discovery-pid");
  const scriptPath = join(shimDirectory, "gh-fixture.mjs");
  mkdirSync(shimDirectory);
  writeFileSync(
    scriptPath,
    `#!/usr/bin/env node
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const identityId = Number(process.env.SLOP_GH_ID);
const restGraphqlRemaining = Number(process.env.SLOP_GH_REST_GRAPHQL_REMAINING ?? "5000");
const directGraphqlRemaining = Number(process.env.SLOP_GH_DIRECT_GRAPHQL_REMAINING ?? "5000");
appendFileSync(process.env.SLOP_GH_LOG, \`\${JSON.stringify(args)}\\n\`);
if (args.at(-1) === "user") {
  process.stdout.write(\`\${JSON.stringify({ id: identityId, login: "fixture-user" })}\\n\`);
} else if (args.at(-1) === "rate_limit") {
  if (process.env.SLOP_GH_HOLD === "1") {
    writeFileSync(process.env.SLOP_GH_PID, \`\${process.pid}\\n\`);
    writeFileSync(process.env.SLOP_GH_READY, "ready\\n");
    const sleeper = new Int32Array(new SharedArrayBuffer(4));
    while (!existsSync(process.env.SLOP_GH_RELEASE)) {
      Atomics.wait(sleeper, 0, 0, 10);
    }
    writeFileSync(process.env.SLOP_GH_DONE, "done\\n");
  }
  if (process.env.SLOP_GH_FAIL_RATE === "1") {
    process.stderr.write("fixture rate-limit failure\\n");
    process.exit(9);
  }
  process.stdout.write(JSON.stringify({ resources: {
    graphql: { limit: 5000, remaining: restGraphqlRemaining, reset: 1800000000 },
    core: { limit: 5000, remaining: 5000, reset: 1800000000 },
    search: { limit: 30, remaining: 30, reset: 1800000000 }
  } }));
} else if (args.some((value) => value.includes("SlopActivityRateLimit"))) {
  process.stdout.write(\`\${JSON.stringify({ limit: 5000, remaining: directGraphqlRemaining, resetAt: "2027-01-15T08:00:00.000Z" })}\\n\`);
}
`,
  );
  const shimPath = join(
    shimDirectory,
    process.platform === "win32" ? "gh.cmd" : "gh",
  );
  if (process.platform === "win32") {
    writeFileSync(shimPath, `@node "%~dp0\\gh-fixture.mjs" %*\r\n`);
  } else {
    symlinkSync(scriptPath, shimPath);
    chmodSync(scriptPath, 0o755);
  }
  return {
    root,
    logPath,
    readyPath,
    releasePath,
    donePath,
    environment: {
      ...process.env,
      PATH: `${shimDirectory}${delimiter}${dirname(nodeExecutable)}${delimiter}${process.env.PATH ?? ""}`,
      SLOP_GH_LOG: logPath,
      SLOP_GH_READY: readyPath,
      SLOP_GH_RELEASE: releasePath,
      SLOP_GH_DONE: donePath,
      SLOP_GH_ID: String(identityId),
      SLOP_GH_PID: pidPath,
      TMPDIR: root,
      TEMP: root,
      TMP: root,
    },
    identityId,
    pidPath,
  };
}

function collectChild(child: ReturnType<typeof spawn>) {
  return new Promise<{
    status: number | null;
    signal: NodeJS.Signals | null;
    stderr: string;
    stdout: string;
  }>((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status, signal) => {
      resolvePromise({ status, signal, stderr, stdout });
    });
  });
}

async function waitForFixturePath(path: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) assert.fail(`timed out waiting for ${path}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
}

async function waitForProcessExit(
  pid: number,
  expectedIdentity: string,
  timeoutMs = 5_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (readLiveReportProcessIdentity(pid) === expectedIdentity) {
    if (Date.now() >= deadline) assert.fail(`timed out waiting for PID ${pid}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
}

function liveReportLockPath(root: string, identityId: number) {
  const key = createHash("sha256")
    .update(`github.com:${identityId}`)
    .digest("hex");
  return join(root, `${key}.lock`);
}

function createStaleLiveReportLockFixture() {
  const root = mkdtempSync(join(tmpdir(), "slop-live-report-reclaim-test-"));
  const identity = { host: "github.com", id: 42, login: "fixture-user" };
  const lockPath = liveReportLockPath(root, identity.id);
  const ownerPath = join(lockPath, "owner.json");
  const scriptPath = join(root, "reclaimer.mjs");
  const readyPath = join(root, "reclaim-ready");
  const resumePath = join(root, "reclaim-resume");
  const acquiredPath = join(root, "acquired");
  const releasePath = join(root, "release");
  mkdirSync(join(lockPath, "commands"), { recursive: true, mode: 0o700 });
  const currentIdentity = readLiveReportProcessIdentity(process.pid);
  assert.ok(currentIdentity);
  writeFileSync(
    ownerPath,
    JSON.stringify({
      schemaVersion: 2,
      pid: process.pid,
      processIdentity:
        currentIdentity === "0".repeat(64) ? "1".repeat(64) : "0".repeat(64),
      ownerToken: randomBytes(16).toString("hex"),
    }),
    { mode: 0o600 },
  );
  writeFileSync(
    scriptPath,
    `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const [reportUrl, root, lockPath, ready, resume, acquired, release, role] = process.argv.slice(2);
const rename = fs.renameSync.bind(fs);
const sleeper = new Int32Array(new SharedArrayBuffer(4));
fs.renameSync = (source, target) => {
  if (role === "paused" && source === lockPath && target.includes(".stale-")) {
    fs.writeFileSync(ready, "ready");
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(resume)) {
      if (Date.now() > deadline) throw new Error("reclaimer resume timed out");
      Atomics.wait(sleeper, 0, 0, 10);
    }
  }
  return rename(source, target);
};
syncBuiltinESMExports();
const { acquireLiveReportLock } = await import(reportUrl);
try {
  const lock = acquireLiveReportLock({ host: "github.com", id: 42, login: "fixture-user" }, { rootPath: root });
  if (role === "paused") {
    fs.writeFileSync(acquired, "acquired");
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(release)) {
      if (Date.now() > deadline) throw new Error("report release timed out");
      Atomics.wait(sleeper, 0, 0, 10);
    }
  }
  lock.release();
} catch (error) {
  process.stderr.write(error.message);
  process.exitCode = 2;
}
`,
  );
  return {
    root,
    identity,
    lockPath,
    ownerPath,
    readyPath,
    resumePath,
    acquiredPath,
    releasePath,
    arguments(role: string, reportPath = liveReportPath) {
      return [
        scriptPath,
        pathToFileURL(reportPath).href,
        root,
        lockPath,
        readyPath,
        resumePath,
        acquiredPath,
        releasePath,
        role,
      ];
    },
  };
}

function account(login: string, type = "User") {
  const id = [...login.toLowerCase()].reduce(
    (value, character) => (value * 31 + character.charCodeAt(0)) % 1_000_000,
    17,
  );
  return { id, login, type };
}

function comment(
  id: number,
  author: string,
  body: string | null,
  kind = "User",
  createdAt = "2026-01-18T12:00:00.000Z",
  authorAssociation = "MEMBER",
) {
  return {
    id,
    html_url: `https://github.com/elizaOS/eliza/comments/${id}`,
    user: account(author, kind),
    body,
    created_at: createdAt,
    author_association: authorAssociation,
  };
}

type CommentFixture = Omit<ReturnType<typeof comment>, "user"> & {
  user: ReturnType<typeof account> | null;
};

function review(
  id: number,
  author: string | null,
  state: string,
  commitId = HEAD_SHA,
  submittedAt = "2026-01-18T12:00:00.000Z",
) {
  return {
    id,
    html_url: `https://github.com/elizaOS/eliza/pull/1#pullrequestreview-${id}`,
    user: author === null ? null : account(author),
    body: "Substantive review findings.",
    submitted_at: submittedAt,
    state,
    commit_id: commitId,
  };
}

function pullRequest(number: number, overrides: Record<string, unknown> = {}) {
  return {
    number,
    title: `Pull request ${number}`,
    html_url: `https://github.com/elizaOS/eliza/pull/${number}`,
    user: account(`author-${number}`),
    labels: [],
    assignees: [],
    draft: false,
    body: evidenceBody(),
    requested_reviewers: [],
    requested_teams: [],
    created_at: "2026-01-18T12:00:00.000Z",
    updated_at: "2026-01-18T12:00:00.000Z",
    head: { sha: HEAD_SHA },
    ...overrides,
  };
}

function evidenceBody() {
  const rows = REQUIRED_EVIDENCE_ROWS.map(
    (id) =>
      `<!-- evidence-row:${id} -->\n- [x] ${id}: N/A - no affected ${id} surface.`,
  ).join("\n\n");
  return `${rows}\n\nAI provider/model: OpenAI / gpt-5.6-codex`;
}

function pagedStdout(args: string[], records: unknown[]) {
  const endpoint = args.at(-1);
  assert.strictEqual(typeof endpoint, "string");
  const pageMatch = endpoint.match(/[?&]page=(\d+)$/);
  assert.ok(pageMatch, `missing explicit page in ${endpoint}`);
  const start = (Number(pageMatch[1]) - 1) * 100;
  const page = records.slice(start, start + 100);
  return page.length === 0
    ? ""
    : `${page.map((value) => JSON.stringify(value)).join("\n")}\n`;
}

describe("contribute-to-eliza skill structure", () => {
  it("has valid, trigger-rich frontmatter and no scaffold placeholders", () => {
    const source = readFileSync(skillPath, "utf8");
    const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(frontmatter, "SKILL.md must begin with YAML frontmatter");
    const keys = frontmatter[1]
      .split(/\r?\n/)
      .map((line) => line.match(/^([a-z-]+):/)?.[1])
      .filter((key): key is string => key !== undefined);
    const name = frontmatter[1].match(/^name:\s*(.+)$/m)?.[1];
    const description = frontmatter[1].match(
      /^description:\s*"?(.+?)"?$/m,
    )?.[1];

    assert.deepStrictEqual(keys.sort(), ["description", "name"]);
    assert.strictEqual(name, "contribute-to-eliza");
    assert.match(String(description), /elizaOS\/eliza/i);
    assert.match(String(description), /finish.*review|review.*finish/i);
    assert.doesNotMatch(source, /\[TODO[:\]]/);
  });

  it("encodes outcome modes, measured runs, security, sync, proof, and authority", () => {
    const source = readFileSync(skillPath, "utf8");

    assert.match(source, /\*\*Review and test every current PR\*\*/);
    assert.match(source, /\*\*Finish every existing issue without a PR\*\*/);
    assert.match(source, /\*\*Restore `develop` workflow health\*\*/);
    assert.match(source, /\*\*Validate\*\*/);
    assert.match(source, /run-receipt\.mjs start/);
    assert.match(source, /run-receipt\.mjs finish/);
    assert.match(source, /gpt-5\.6-sol/);
    assert.match(source, /Grok and Kimi/);
    assert.match(source, /Slop marker/i);
    assert.match(source, /device signature/i);
    assert.match(source, /updates only to GitHub-authorized bytes/i);
    assert.match(source, /SECURITY\.md/);
    assert.match(source, /origin\/develop/);
    assert.match(source, /nearest `AGENTS\.md` or\s+`CLAUDE\.md`/);
    assert.match(source, /Open and inspect every artifact/i);
    assert.match(source, /Never self-approve,\s+self-merge/i);
    assert.match(source, /--no-ext-diff --no-textconv/);
    assert.match(source, /worktree is not isolation/i);
    assert.match(source, /network denied by\s+default/i);
    assert.match(source, /bun install --frozen-lockfile --ignore-scripts/);
    assert.match(source, /operator approval/i);
    assert.match(source, /single-use least-privilege credential/i);
    assert.match(source, /normal `gh` config/i);
  });

  it("documents the signed Eliza last-line alias without duplicating the Slop receipt", () => {
    const source = readFileSync(skillPath, "utf8");

    assert.match(source, /slop-contribution-attribution:v1/);
    assert.match(source, /eliza-computer-attribution:v1/);
    assert.match(source, /elizaos-contribution-attribution:v2/);
    assert.match(source, /check-agent-comment-attribution\.mjs/);
    assert.match(source, /at most one\s+attribution marker per source/i);
    assert.match(
      source,
      /preserve the complete visible\s+footer and exact signed JSON payload/i,
    );
    assert.match(source, /marker name is outside the signed\s+payload/i);
    assert.match(source, /Do not remove the `run` object/i);
    assert.match(source, /generate the unsigned\s+legacy marker/i);
    assert.match(source, /formal `APPROVE` or `REQUEST_CHANGES` event/);
    assert.match(source, /`submittedAt` is after `mergedAt`/);
    assert.match(
      source,
      /does not\s+require the reviewed commit to become the final merged head/,
    );
    assert.match(source, /Do not put both markers in the same\s+source/i);
    assert.doesNotMatch(source, /ss251 gets \+50|give ss251 extra points/i);
  });

  it("rejects contribution spam and gates work on the primary Eliza mission", () => {
    const source = readFileSync(skillPath, "utf8");
    const mission = readFileSync(
      join(skillDir, "references", "mission-priorities.md"),
      "utf8",
    );

    assert.match(source, /Do not create an issue during a self-directed/i);
    assert.match(
      source,
      /Never apply, request, suggest applying, or automate/i,
    );
    assert.match(source, /exact\s+repository label `mission-ready`/i);
    assert.match(source, /issue explicitly selected by the\s+operator/i);
    assert.match(source, /Keep at most one active implementation or review/i);
    assert.match(source, /Never\s+mirror a PR title into an issue/i);
    assert.match(source, /Prefer one complete fix to\s+several small PRs/i);
    assert.match(source, /Ignore leaderboard position/i);
    const reviewPriority = source.indexOf(
      "**Review and test every current PR**",
    );
    const implementPriority = source.indexOf(
      "**Finish every existing issue without a PR**",
    );
    const workflowPriority = source.indexOf(
      "**Restore `develop` workflow health**",
    );
    const auditPriority = source.indexOf(
      "**Audit only after the three gates are clear**",
    );
    assert.ok(reviewPriority >= 0);
    assert.ok(implementPriority > reviewPriority);
    assert.ok(workflowPriority > implementPriority);
    assert.ok(auditPriority > workflowPriority);
    assert.match(
      source,
      /\*\*security weaknesses\*\*.*\*\*reproducible bugs\*\*.*\*\*incorrect or stale\s+documentation and code comments\*\*.*\*\*important behavior that lacks real\s+tests\*\*/is,
    );
    assert.match(
      source,
      /every current PR has a current-head review and disposition[\s\S]*every existing issue[\s\S]*every required `develop` workflow/iu,
    );
    assert.match(mission, /Eliza app/);
    assert.match(mission, /Eliza Cloud/);
    assert.match(mission, /Core agent runtime/);
    assert.match(mission, /Primary capabilities/);
    assert.match(mission, /New niche plugins.*outside the mission/is);
    assert.match(
      mission,
      /splitting one outcome into multiple issues or pull requests/i,
    );
    assert.match(mission, /Recommend closure rather than repairs/i);
    assert.deepStrictEqual(readProjectSelectionPolicy().eligibleIssueLabels, [
      "mission-ready",
    ]);
  });

  it("states the reward without letting tokens or projections promise payment", () => {
    const source = readFileSync(skillPath, "utf8");

    assert.match(source, /\$10,000 monthly digital-dollar pool/);
    assert.match(source, /projection is not a payment promise/i);
    assert.match(source, /token volume alone never earns/i);
    assert.match(source, /private key/i);
    assert.match(
      source,
      /signature proves byte\s+integrity.*not truthful logs/is,
    );
  });

  it("suppresses an untrusted postinstall and sanitizes a test fixture environment", {
    timeout: 30_000,
  }, () => {
    const fixtureRoot = mkdtempSync(
      join(tmpdir(), "contribute-to-eliza-untrusted-pr-"),
    );
    const isolatedHome = join(fixtureRoot, "isolated-home");
    const postinstallSentinel = join(fixtureRoot, "postinstall-executed");
    const testProbe = join(fixtureRoot, "test-environment.json");
    try {
      mkdirSync(isolatedHome);
      writeFileSync(
        join(fixtureRoot, "package.json"),
        `${JSON.stringify(
          {
            name: "malicious-pr-fixture",
            private: true,
            scripts: {
              postinstall:
                'node -e "require(\\"node:fs\\").writeFileSync(\\"postinstall-executed\\", process.env.GITHUB_TOKEN || \\"executed\\")"',
              test: "node probe.mjs",
            },
          },
          null,
          2,
        )}\n`,
      );
      writeFileSync(
        join(fixtureRoot, "probe.mjs"),
        `
import { writeFileSync } from "node:fs";

const sensitiveNames = Object.keys(process.env).filter((name) =>
  /^(?:GH_|GITHUB_|AWS_|CLOUDFLARE_|ANTHROPIC_|OPENAI_)/u.test(name),
);
writeFileSync(
  "test-environment.json",
  JSON.stringify({
    sensitiveNames,
    home: process.env.HOME,
    gitConfigGlobal: process.env.GIT_CONFIG_GLOBAL,
    gitConfigSystem: process.env.GIT_CONFIG_SYSTEM,
  }),
);
`,
      );
      const safeEnvironment = {
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
        HOME: isolatedHome,
        PATH: process.env.PATH ?? "",
        TMPDIR: fixtureRoot,
      };
      const install = spawnSync(
        "bun",
        ["install", "--ignore-scripts", "--offline"],
        {
          cwd: fixtureRoot,
          encoding: "utf8",
          env: safeEnvironment,
        },
      );
      assert.strictEqual(install.status, 0, install.stderr);
      assert.strictEqual(existsSync(postinstallSentinel), false);

      const frozenInstall = spawnSync(
        "bun",
        ["install", "--frozen-lockfile", "--ignore-scripts", "--offline"],
        {
          cwd: fixtureRoot,
          encoding: "utf8",
          env: safeEnvironment,
        },
      );
      assert.strictEqual(frozenInstall.status, 0, frozenInstall.stderr);
      assert.strictEqual(existsSync(postinstallSentinel), false);

      const testRun = spawnSync("bun", ["run", "test"], {
        cwd: fixtureRoot,
        encoding: "utf8",
        env: safeEnvironment,
      });
      assert.strictEqual(testRun.status, 0, testRun.stderr);
      const observed = JSON.parse(readFileSync(testProbe, "utf8")) as {
        sensitiveNames: string[];
        home: string;
        gitConfigGlobal: string;
        gitConfigSystem: string;
      };
      assert.deepStrictEqual(observed, {
        sensitiveNames: [],
        home: isolatedHome,
        gitConfigGlobal: "/dev/null",
        gitConfigSystem: "/dev/null",
      });
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it("links only existing local references and ships UI metadata", () => {
    const source = readFileSync(skillPath, "utf8");
    const references = [...source.matchAll(/\]\((references\/[^)]+)\)/g)].map(
      (match) => match[1],
    );

    assert.deepStrictEqual(references.sort(), [
      "references/evidence-review-rubric.md",
      "references/mission-priorities.md",
      "references/repository-contract.md",
    ]);
    for (const reference of references) {
      assert.ok(existsSync(join(skillDir, reference)), reference);
    }

    const openaiYaml = readFileSync(
      join(skillDir, "agents", "openai.yaml"),
      "utf8",
    );
    assert.match(openaiYaml, /display_name: "Contribute to Eliza"/);
    assert.match(openaiYaml, /default_prompt: "Use \$contribute-to-eliza/);
    assert.match(openaiYaml, /review and test every current PR first/);
    assert.match(openaiYaml, /existing issues through PRs second/);
    assert.match(openaiYaml, /develop workflows third/);
    assert.match(openaiYaml, /elizaOS\/eliza/);
  });
});

describe("live report parsing", () => {
  it("runs the CLI when its entrypoint reaches the module through a symlink", () => {
    const fixtureRoot = mkdtempSync(
      join(tmpdir(), "contribute-to-eliza-live-report-"),
    );
    const linkedEntrypoint = join(fixtureRoot, "live-report.mjs");
    try {
      symlinkSync(liveReportPath, linkedEntrypoint);
      assert.notStrictEqual(linkedEntrypoint, realpathSync(linkedEntrypoint));

      const result = spawnSync(process.execPath, [linkedEntrypoint, "--help"], {
        encoding: "utf8",
      });

      assert.strictEqual(result.status, 0, result.stderr);
      assert.match(result.stdout, /^Usage: node scripts\/live-report\.mjs/m);
      assert.strictEqual(result.stderr, "");
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it("rejects options that the selected receipt command would ignore", () => {
    const cases = [
      ["start", "--trajectory", "proof.json"],
      ["start", "--run", `run_${"0".repeat(26)}`],
      ["doctor", "--lane", "ignored-lane"],
      ["preview", "--model", "ignored-model"],
      ["preview", "--usage-unavailable"],
      ["status", "--repo-root", "/tmp"],
      ["status", "--usage-unavailable"],
      ["trace", "--usage-unavailable"],
    ];
    for (const argumentsValue of cases) {
      const result = spawnSync(
        process.execPath,
        [runReceiptPath, ...argumentsValue],
        { encoding: "utf8" },
      );
      assert.strictEqual(result.status, 1);
      assert.match(result.stderr, /is not valid with/u);
    }
  });

  it("requires one explicit usage mode for every measured command", () => {
    const identity = [
      "--repo-root",
      ".",
      "--client",
      "codex",
      "--provider",
      "openai",
      "--model",
      "gpt-5.6-sol",
    ];
    const commands = [
      ["doctor", ...identity],
      ["start", ...identity, "--lane", "parser-test", "--allow-local-usage"],
      [
        "finish",
        ...identity,
        "--lane",
        "parser-test",
        "--run",
        `run_${"0".repeat(26)}`,
        "--trajectory",
        "proof.json",
        "--trace-server-run",
        "server_parser_test",
        "--trace-object-id",
        `sha256:${"0".repeat(64)}`,
      ],
    ];

    for (const command of commands) {
      const missing = spawnSync(
        process.execPath,
        [runReceiptPath, ...command],
        {
          encoding: "utf8",
        },
      );
      assert.strictEqual(missing.status, 1);
      assert.match(missing.stderr, /requires exactly one of/u);

      const ambiguous = spawnSync(
        process.execPath,
        [
          runReceiptPath,
          ...command,
          "--allow-package-execution",
          "--usage-unavailable",
        ],
        { encoding: "utf8" },
      );
      assert.strictEqual(ambiguous.status, 1);
      assert.match(ambiguous.stderr, /choose exactly one/u);
    }
  });

  it("reads newline-delimited gh output and fails closed on malformed records", () => {
    assert.deepStrictEqual(parsePaginatedJson('{"number":1}\n{"number":2}\n'), [
      { number: 1 },
      { number: 2 },
    ]);
    // A blank body is a valid empty collection, not a failure.
    assert.deepStrictEqual(parsePaginatedJson("\n   \n"), []);
    // Windows gh builds may terminate records with CRLF.
    assert.deepStrictEqual(parsePaginatedJson('{"number":1}\r\n{"number":2}'), [
      { number: 1 },
      { number: 2 },
    ]);
    // Truncated or malformed records must fail closed with endpoint context
    // rather than silently returning a short inventory.
    assert.throws(
      () => parsePaginatedJson('{"number":1}\n{"number"', "repos/o/r/issues"),
      /malformed JSON for repos\/o\/r\/issues at output line 2/,
    );
    assert.throws(
      () => parsePaginatedJson(undefined),
      /did not return text output/,
    );
  });

  it("batches open issue and pull activity through two bounded GraphQL reads", () => {
    const actor = {
      __typename: "User",
      databaseId: 42,
      id: "U_42",
      login: "reviewer",
    };
    const graphqlComment = {
      databaseId: 10,
      url: "https://github.com/elizaOS/eliza/issues/1#issuecomment-10",
      body: "AI assistance: no — human-only claim\nAttribution status: self-reported",
      createdAt: "2026-01-18T12:00:00.000Z",
      authorAssociation: "MEMBER",
      author: actor,
    };
    const issueNode = {
      number: 1,
      comments: { totalCount: 1, nodes: [graphqlComment] },
    };
    const pullNode = {
      number: 2,
      comments: { totalCount: 0, nodes: [] },
      reviews: {
        totalCount: 1,
        nodes: [
          {
            databaseId: 20,
            url: "https://github.com/elizaOS/eliza/pull/2#pullrequestreview-20",
            body: "Substantive review.",
            submittedAt: "2026-01-18T12:00:00.000Z",
            state: "APPROVED",
            commit: { oid: HEAD_SHA },
            author: actor,
          },
        ],
      },
      reviewThreads: {
        totalCount: 1,
        nodes: [{ comments: { totalCount: 1, nodes: [graphqlComment] } }],
      },
    };
    const calls: Array<{
      args: string[];
      options: import("node:child_process").SpawnSyncOptionsWithStringEncoding;
    }> = [];
    const activity = readGhOpenActivity(
      "elizaOS/eliza",
      (command, args, options) => {
        assert.strictEqual(command, "gh");
        calls.push({ args, options });
        const selector = args.at(-1);
        return {
          status: 0,
          stderr: "",
          stdout: `${JSON.stringify(
            selector?.includes(".issues.") ? issueNode : pullNode,
          )}\n`,
        };
      },
    );

    assert.strictEqual(calls.length, 2);
    assert.ok(calls.every(({ args }) => args.includes("graphql")));
    assert.ok(calls.every(({ args }) => args.includes("--paginate")));
    assert.ok(
      calls.every(({ args }) => args[args.indexOf("--method") + 1] === "POST"),
    );
    assert.ok(
      calls.every(({ args }) => {
        const query = args.find((argument) => argument.startsWith("query="));
        return query?.includes("query(") && !/\bmutation\b/i.test(query);
      }),
    );
    assert.ok(
      calls.every(({ options }) => options.maxBuffer === 256 * 1024 * 1024),
    );
    assert.strictEqual(activity.issues.get(1)?.[0].user.id, 42);
    assert.strictEqual(activity.pulls.get(2)?.reviews[0].commit_id, HEAD_SHA);
    assert.strictEqual(activity.pulls.get(2)?.inlineComments.length, 1);
  });

  it("audits the current 1,097-item pull queue without truncation", () => {
    const pullNodes = Array.from({ length: 1_097 }, (_, index) => ({
      number: index + 1,
      comments: { totalCount: 0, nodes: [] },
      reviews: { totalCount: 0, nodes: [] },
      reviewThreads: { totalCount: 0, nodes: [] },
    }));

    const activity = readGhOpenActivity("elizaOS/eliza", (_command, args) => ({
      status: 0,
      stderr: "",
      stdout: args.at(-1)?.includes(".pullRequests.")
        ? `${pullNodes.map((node) => JSON.stringify(node)).join("\n")}\n`
        : "",
    }));

    assert.strictEqual(activity.issues.size, 0);
    assert.strictEqual(activity.pulls.size, 1_097);
    assert.ok(activity.pulls.has(1));
    assert.ok(activity.pulls.has(1_097));
  });

  it("uses bounded REST activity when GraphQL cannot afford the scan", () => {
    const issueComment = {
      ...comment(10, "reviewer", "Issue comment"),
      issue_url: "https://api.github.com/repos/elizaOS/eliza/issues/1",
    };
    const pullComment = {
      ...comment(20, "reviewer", "Pull comment"),
      issue_url: "https://api.github.com/repos/elizaOS/eliza/issues/2",
    };
    const inlineComment = {
      ...comment(30, "reviewer", "Inline comment"),
      pull_request_url: "https://api.github.com/repos/elizaOS/eliza/pulls/2",
      commit_id: HEAD_SHA,
    };
    const calls: string[][] = [];

    const activity = readGhOpenActivity(
      "elizaOS/eliza",
      (_command, args) => {
        calls.push(args);
        if (args.at(-1) === "rate_limit") {
          return {
            status: 0,
            stderr: "",
            stdout: JSON.stringify({
              resources: {
                graphql: {
                  limit: 5_000,
                  remaining: 999,
                  reset: 1_800_000_000,
                },
                core: {
                  limit: 5_000,
                  remaining: 4_943,
                  reset: 1_800_000_000,
                },
                search: { limit: 30, remaining: 30, reset: 1_800_000_000 },
              },
            }),
          };
        }
        if (args.includes("graphql")) {
          return {
            status: 0,
            stderr: "",
            stdout: JSON.stringify({
              limit: 5_000,
              remaining: 354,
              resetAt: "2027-01-15T08:00:00.000Z",
            }),
          };
        }
        const endpoint = args.at(-1) ?? "";
        if (endpoint.includes("/issues?state=open")) {
          return {
            status: 0,
            stderr: "",
            stdout: `${JSON.stringify({ number: 1, created_at: "2026-01-18T12:00:00.000Z" })}\n${JSON.stringify({ number: 2, created_at: "2026-01-19T12:00:00.000Z", pull_request: {} })}\n`,
          };
        }
        if (endpoint.includes("/pulls?state=open")) {
          return {
            status: 0,
            stderr: "",
            stdout: `${JSON.stringify({ number: 2, created_at: "2026-01-19T12:00:00.000Z" })}\n`,
          };
        }
        if (endpoint.includes("/issues/comments?")) {
          return {
            status: 0,
            stderr: "",
            stdout: `${JSON.stringify(issueComment)}\n${JSON.stringify(pullComment)}\n`,
          };
        }
        if (endpoint.includes("/pulls/comments?")) {
          return {
            status: 0,
            stderr: "",
            stdout: `${JSON.stringify(inlineComment)}\n`,
          };
        }
        if (
          args.includes("q=repo:elizaOS/eliza is:pr is:open review:approved")
        ) {
          return {
            status: 0,
            stderr: "",
            stdout: `${JSON.stringify({ number: 2 })}\n`,
          };
        }
        if (
          args.includes(
            "q=repo:elizaOS/eliza is:pr is:open review:changes_requested",
          )
        ) {
          return { status: 0, stderr: "", stdout: "" };
        }
        assert.fail(`unexpected GitHub command: ${args.join(" ")}`);
      },
      { preflight: true },
    );

    assert.strictEqual(calls[0].at(-1), "rate_limit");
    assert.strictEqual(
      calls.filter((args) => args.includes("graphql")).length,
      1,
    );
    assert.strictEqual(activity.rateLimits.graphqlRemaining, 354);
    assert.strictEqual(
      activity.rateLimits.graphqlBudgetSource,
      "direct-graphql",
    );
    assert.ok(
      calls
        .filter((args) => args.at(-1)?.includes("/comments?"))
        .every((args) =>
          args.at(-1)?.includes("since=2026-01-18T12%3A00%3A00.000Z"),
        ),
    );
    assert.strictEqual(activity.issues.get(1)?.[0].id, 10);
    assert.strictEqual(activity.pulls.get(2)?.issueComments[0].id, 20);
    assert.strictEqual(activity.pulls.get(2)?.inlineComments[0].id, 30);
    assert.strictEqual(activity.pulls.get(2)?.reviewStatus, "approved");

    const report = collectLiveReport(
      "elizaOS/eliza",
      (endpoint) => {
        if (endpoint.includes("/issues?state=open")) {
          return [
            {
              number: 1,
              title: "Issue 1",
              html_url: "https://github.com/elizaOS/eliza/issues/1",
              user: account("issue-author"),
              labels: [{ name: MISSION_READY_LABEL }],
              assignees: [],
              comments: 1,
            },
          ];
        }
        if (endpoint.includes("/pulls?state=open")) return [pullRequest(2)];
        assert.fail(`unexpected endpoint: ${endpoint}`);
      },
      NOW,
      () => {},
      activity,
      [MISSION_READY_LABEL],
    );

    assert.strictEqual(report.reviewablePullRequests.length, 0);
    assert.deepStrictEqual(
      report.filtered.reviewedPullRequests.map((pull) => pull.number),
      [2],
    );
  });

  it("uses REST when the direct GraphQL budget probe is rate-limited", () => {
    const calls: string[][] = [];
    const activity = readGhOpenActivity(
      "elizaOS/eliza",
      (_command, args) => {
        calls.push(args);
        if (args.at(-1) === "rate_limit") {
          return {
            status: 0,
            stderr: "",
            stdout: JSON.stringify({
              resources: {
                graphql: {
                  limit: 5_000,
                  remaining: 5_000,
                  reset: 1_800_000_000,
                },
                core: {
                  limit: 5_000,
                  remaining: 5_000,
                  reset: 1_800_000_000,
                },
                search: { limit: 30, remaining: 30, reset: 1_800_000_000 },
              },
            }),
          };
        }
        if (args.includes("graphql")) {
          return {
            status: 1,
            stderr: "gh: API rate limit already exceeded",
            stdout: "",
          };
        }
        return { status: 0, stderr: "", stdout: "" };
      },
      { preflight: true },
    );

    assert.strictEqual(activity.source, "rest");
    assert.strictEqual(activity.rateLimits.graphqlRemaining, 0);
    assert.strictEqual(
      activity.rateLimits.graphqlBudgetSource,
      "direct-probe-rate-limited",
    );
    assert.strictEqual(
      calls.filter((args) => args.includes("graphql")).length,
      1,
    );
  });

  it("fails closed with both budgets when no complete activity path is affordable", () => {
    assert.throws(
      () =>
        readGhOpenActivity(
          "elizaOS/eliza",
          (_command, args) => {
            if (args.at(-1) === "rate_limit") {
              return {
                status: 0,
                stderr: "",
                stdout: JSON.stringify({
                  resources: {
                    graphql: {
                      limit: 5_000,
                      remaining: 5_000,
                      reset: 1_800_000_000,
                    },
                    core: {
                      limit: 5_000,
                      remaining: MIN_REST_ACTIVITY_REQUESTS - 1,
                      reset: 1_800_000_000,
                    },
                    search: {
                      limit: 30,
                      remaining: MIN_SEARCH_ACTIVITY_REQUESTS - 1,
                      reset: 1_800_000_000,
                    },
                  },
                }),
              };
            }
            return args.includes("graphql")
              ? {
                  status: 0,
                  stderr: "",
                  stdout: JSON.stringify({
                    limit: 5_000,
                    remaining: 354,
                    resetAt: "2027-01-15T08:00:00.000Z",
                  }),
                }
              : { status: 0, stderr: "", stdout: "" };
          },
          { preflight: true },
        ),
      /cannot afford either complete GraphQL or REST activity discovery/,
    );
  });

  it("uses GraphQL when its direct budget probe is healthy", () => {
    const calls: string[][] = [];
    const activity = readGhOpenActivity(
      "elizaOS/eliza",
      (_command, args) => {
        calls.push(args);
        if (args.at(-1) === "rate_limit") {
          return {
            status: 0,
            stderr: "",
            stdout: JSON.stringify({
              resources: {
                graphql: {
                  limit: 5_000,
                  remaining: 5_000,
                  reset: 1_800_000_000,
                },
                core: {
                  limit: 5_000,
                  remaining: 5_000,
                  reset: 1_800_000_000,
                },
                search: { limit: 30, remaining: 30, reset: 1_800_000_000 },
              },
            }),
          };
        }
        if (
          args.includes("graphql") &&
          args.some((argument) => argument.includes("SlopActivityRateLimit"))
        ) {
          return {
            status: 0,
            stderr: "",
            stdout: JSON.stringify({
              limit: 5_000,
              remaining: 4_500,
              resetAt: "2027-01-15T08:00:00.000Z",
            }),
          };
        }
        return { status: 0, stderr: "", stdout: "" };
      },
      { preflight: true },
    );

    assert.strictEqual(activity.source, "graphql");
    assert.strictEqual(activity.rateLimits.graphqlRemaining, 4_500);
    assert.strictEqual(
      calls.filter((args) => args.includes("graphql")).length,
      3,
    );
  });

  it("paginates overflowing issue activity through bounded GET-only REST", () => {
    const actor = {
      __typename: "User",
      databaseId: 42,
      id: "U_42",
      login: "reviewer",
    };
    const graphqlComments = Array.from({ length: 100 }, (_, index) => ({
      databaseId: index + 1,
      url: `https://github.com/elizaOS/eliza/issues/1#issuecomment-${index + 1}`,
      body: `Comment ${index + 1}`,
      createdAt: "2026-01-18T12:00:00.000Z",
      authorAssociation: "MEMBER",
      author: actor,
    }));
    const restComments = Array.from({ length: 351 }, (_, index) => ({
      id: index + 1,
      html_url: `https://github.com/elizaOS/eliza/issues/1#issuecomment-${index + 1}`,
      body: `Comment ${index + 1}`,
      created_at: "2026-01-18T12:00:00.000Z",
      author_association: "MEMBER",
      user: { id: 42, login: "reviewer", type: "User" },
    }));
    const calls: string[][] = [];
    const commandBudget = createGhCommandBudget((_command, args) => {
      calls.push(args);
      if (args.includes("graphql")) {
        return {
          status: 0,
          stderr: "",
          stdout: args.at(-1)?.includes(".issues.")
            ? `${JSON.stringify({
                number: 1,
                comments: { totalCount: 351, nodes: graphqlComments },
              })}\n`
            : "",
        };
      }
      assert.ok(args.includes("--method"));
      assert.strictEqual(args[args.indexOf("--method") + 1], "GET");
      assert.ok(!args.includes("--paginate"));
      assert.ok(
        args
          .at(-1)
          ?.startsWith(
            "repos/elizaOS/eliza/issues/1/comments?per_page=100&page=",
          ),
      );
      return {
        status: 0,
        stderr: "",
        stdout: pagedStdout(args, restComments),
      };
    });
    const activity = readGhOpenActivity("elizaOS/eliza", commandBudget.run);

    assert.strictEqual(calls.length, 6);
    assert.strictEqual(commandBudget.count, 6);
    assert.strictEqual(activity.issues.get(1)?.length, 351);
    assert.strictEqual(activity.issues.get(1)?.at(-1)?.id, 351);
  });

  it("paginates every overflowing pull-request activity surface", () => {
    const actor = {
      __typename: "User",
      databaseId: 42,
      id: "U_42",
      login: "reviewer",
    };
    const graphqlComment = (id: number) => ({
      databaseId: id,
      url: `https://github.com/elizaOS/eliza/pull/2#issuecomment-${id}`,
      body: `Comment ${id}`,
      createdAt: "2026-01-18T12:00:00.000Z",
      authorAssociation: "MEMBER",
      author: actor,
    });
    const restComment = (id: number) => ({
      id,
      html_url: `https://github.com/elizaOS/eliza/pull/2#comment-${id}`,
      body: `Comment ${id}`,
      created_at: "2026-01-18T12:00:00.000Z",
      author_association: "MEMBER",
      user: { id: 42, login: "reviewer", type: "User" },
    });
    const graphqlReview = (id: number) => ({
      databaseId: id,
      url: `https://github.com/elizaOS/eliza/pull/2#pullrequestreview-${id}`,
      body: `Review ${id}`,
      submittedAt: "2026-01-18T12:00:00.000Z",
      state: "COMMENTED",
      commit: { oid: HEAD_SHA },
      author: actor,
    });
    const restReview = (id: number) => ({
      id,
      html_url: `https://github.com/elizaOS/eliza/pull/2#pullrequestreview-${id}`,
      body: `Review ${id}`,
      submitted_at: "2026-01-18T12:00:00.000Z",
      state: "COMMENTED",
      commit_id: HEAD_SHA,
      user: { id: 42, login: "reviewer", type: "User" },
    });
    const pullNode = {
      number: 2,
      comments: {
        totalCount: 101,
        nodes: Array.from({ length: 100 }, (_, index) =>
          graphqlComment(index + 1),
        ),
      },
      reviews: {
        totalCount: 102,
        nodes: Array.from({ length: 100 }, (_, index) =>
          graphqlReview(index + 1),
        ),
      },
      reviewThreads: {
        totalCount: 101,
        nodes: Array.from({ length: 100 }, (_, index) => ({
          comments: {
            totalCount: 1,
            nodes: [graphqlComment(index + 1)],
          },
        })),
      },
    };
    const calls: string[][] = [];
    const activity = readGhOpenActivity("elizaOS/eliza", (_command, args) => {
      calls.push(args);
      if (args.includes("graphql")) {
        return {
          status: 0,
          stderr: "",
          stdout: args.at(-1)?.includes(".pullRequests.")
            ? `${JSON.stringify(pullNode)}\n`
            : "",
        };
      }
      const endpoint = args.at(-1) ?? "";
      let records: Array<Record<string, unknown>>;
      if (
        endpoint.startsWith(
          "repos/elizaOS/eliza/issues/2/comments?per_page=100&page=",
        )
      ) {
        records = Array.from({ length: 101 }, (_, index) =>
          restComment(index + 1),
        );
      } else if (
        endpoint.startsWith(
          "repos/elizaOS/eliza/pulls/2/reviews?per_page=100&page=",
        )
      ) {
        records = Array.from({ length: 102 }, (_, index) =>
          restReview(index + 1),
        );
      } else {
        assert.ok(
          endpoint.startsWith(
            "repos/elizaOS/eliza/pulls/2/comments?per_page=100&page=",
          ),
        );
        records = Array.from({ length: 151 }, (_, index) =>
          restComment(index + 1),
        );
      }
      return {
        status: 0,
        stderr: "",
        stdout: pagedStdout(args, records),
      };
    });

    assert.strictEqual(calls.length, 8);
    assert.strictEqual(activity.pulls.get(2)?.issueComments.length, 101);
    assert.strictEqual(activity.pulls.get(2)?.reviews.length, 102);
    assert.strictEqual(activity.pulls.get(2)?.inlineComments.length, 151);
  });

  it("paginates a single overflowing review thread through flat REST", () => {
    const actor = {
      __typename: "User",
      databaseId: 42,
      id: "U_42",
      login: "reviewer",
    };
    const graphqlComment = (id: number) => ({
      databaseId: id,
      url: `https://github.com/elizaOS/eliza/pull/2#discussion_r${id}`,
      body: `Comment ${id}`,
      createdAt: "2026-01-18T12:00:00.000Z",
      authorAssociation: "MEMBER",
      author: actor,
    });
    const restComments = Array.from({ length: 101 }, (_, index) => ({
      id: index + 1,
      html_url: `https://github.com/elizaOS/eliza/pull/2#discussion_r${index + 1}`,
      body: `Comment ${index + 1}`,
      created_at: "2026-01-18T12:00:00.000Z",
      author_association: "MEMBER",
      user: { id: 42, login: "reviewer", type: "User" },
    }));
    const calls: string[][] = [];
    const activity = readGhOpenActivity("elizaOS/eliza", (_command, args) => {
      calls.push(args);
      if (args.includes("graphql")) {
        return {
          status: 0,
          stderr: "",
          stdout: args.at(-1)?.includes(".pullRequests.")
            ? `${JSON.stringify({
                number: 2,
                comments: { totalCount: 0, nodes: [] },
                reviews: { totalCount: 0, nodes: [] },
                reviewThreads: {
                  totalCount: 1,
                  nodes: [
                    {
                      comments: {
                        totalCount: 101,
                        nodes: Array.from({ length: 100 }, (_, index) =>
                          graphqlComment(index + 1),
                        ),
                      },
                    },
                  ],
                },
              })}\n`
            : "",
        };
      }
      assert.ok(
        args
          .at(-1)
          ?.startsWith(
            "repos/elizaOS/eliza/pulls/2/comments?per_page=100&page=",
          ),
      );
      return {
        status: 0,
        stderr: "",
        stdout: pagedStdout(args, restComments),
      };
    });

    assert.strictEqual(calls.length, 4);
    assert.strictEqual(activity.pulls.get(2)?.inlineComments.length, 101);
  });

  it("fails closed when nested GraphQL activity exceeds the bounded fallback", () => {
    assert.throws(
      () =>
        readGhOpenActivity("elizaOS/eliza", (_command, args) => ({
          status: 0,
          stderr: "",
          stdout: args.at(-1)?.includes(".issues.")
            ? `${JSON.stringify({
                number: 1,
                comments: {
                  totalCount: MAX_ACTIVITY_CONNECTION_ITEMS + 1,
                  nodes: Array.from({ length: 100 }, () => ({})),
                },
              })}\n`
            : "",
        })),
      /exceeds the complete 1000-record activity bound/,
    );
  });

  it("fails closed on an incomplete initial GraphQL activity page", () => {
    assert.throws(
      () =>
        readGhOpenActivity("elizaOS/eliza", (_command, args) => ({
          status: 0,
          stderr: "",
          stdout: args.at(-1)?.includes(".issues.")
            ? `${JSON.stringify({
                number: 1,
                comments: {
                  totalCount: 351,
                  nodes: Array.from({ length: 99 }, () => ({})),
                },
              })}\n`
            : "",
        })),
      /returned 99 of the expected 100 initial activity records/,
    );
  });

  it("fails closed when paginated REST activity exceeds the bound", () => {
    const restComments = Array.from(
      { length: MAX_ACTIVITY_CONNECTION_ITEMS + 1 },
      (_, index) => ({ id: index + 1 }),
    );
    const calls: string[][] = [];

    assert.throws(
      () =>
        readGhOpenActivity("elizaOS/eliza", (_command, args) => {
          calls.push(args);
          if (args.includes("graphql")) {
            return {
              status: 0,
              stderr: "",
              stdout: args.at(-1)?.includes(".pullRequests.")
                ? `${JSON.stringify({
                    number: 2,
                    comments: { totalCount: 0, nodes: [] },
                    reviews: { totalCount: 0, nodes: [] },
                    reviewThreads: {
                      totalCount: 101,
                      nodes: Array.from({ length: 100 }, () => ({})),
                    },
                  })}\n`
                : "",
            };
          }
          return {
            status: 0,
            stderr: "",
            stdout: pagedStdout(args, restComments),
          };
        }),
      /exceeds the complete 1000-record activity bound/,
    );
    assert.strictEqual(calls.length, 13);
    assert.match(calls.at(-1)?.at(-1) ?? "", /[?&]page=11$/);
  });

  it("fails closed when paginated REST activity disagrees with GraphQL", () => {
    const graphqlComments = Array.from({ length: 100 }, (_, index) => ({
      databaseId: index + 1,
      url: `https://github.com/elizaOS/eliza/issues/1#issuecomment-${index + 1}`,
      body: "",
      createdAt: "2026-01-18T12:00:00.000Z",
      authorAssociation: "MEMBER",
      author: null,
    }));
    const restComments = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
    }));

    assert.throws(
      () =>
        readGhOpenActivity("elizaOS/eliza", (_command, args) => ({
          status: 0,
          stderr: "",
          stdout: args.includes("graphql")
            ? args.at(-1)?.includes(".issues.")
              ? `${JSON.stringify({
                  number: 1,
                  comments: { totalCount: 101, nodes: graphqlComments },
                })}\n`
              : ""
            : pagedStdout(args, restComments),
        })),
      /returned 100 records after reporting 101/,
    );
  });

  it("rejects the seventeenth GitHub command before spawning it", () => {
    let invocations = 0;
    const commandBudget = createGhCommandBudget(() => {
      invocations += 1;
      return { status: 0, stderr: "", stdout: "" };
    });
    for (let index = 0; index < 16; index += 1) {
      commandBudget.run("gh", ["api", "endpoint"], { encoding: "utf8" });
    }
    assert.strictEqual(commandBudget.count, 16);
    assert.strictEqual(invocations, 16);
    assert.throws(
      () =>
        commandBudget.run("gh", ["api", "endpoint"], {
          encoding: "utf8",
        }),
      /exceeds the 16-command safety bound/,
    );
    assert.strictEqual(commandBudget.count, 16);
    assert.strictEqual(invocations, 16);
  });

  it("accepts exact provider/model pairs and rejects placeholders", () => {
    assert.deepStrictEqual(
      parseModelDisclosure("**AI provider/model:** OpenAI / gpt-5.6-codex"),
      { provider: "OpenAI", model: "gpt-5.6-codex" },
    );
    assert.deepStrictEqual(
      parseModelDisclosure(
        "AI provider/model: OpenRouter / anthropic/claude-opus-4.1",
      ),
      {
        provider: "OpenRouter",
        model: "anthropic/claude-opus-4.1",
      },
    );
    assert.strictEqual(
      parseModelDisclosure("AI provider/model: unknown / model"),
      null,
    );
    assert.strictEqual(
      parseModelDisclosure("AI provider/model: AI / gpt-5.4"),
      null,
    );
    assert.strictEqual(
      parseModelDisclosure("AI provider/model: None / gpt-5.4"),
      null,
    );
    for (const generic of [
      "AI provider/model: N_A / gpt-5.4",
      "AI provider/model: OpenAI / N/A",
      "AI provider/model: OpenRouter / anthropic/gpt",
    ]) {
      assert.strictEqual(parseModelDisclosure(generic), null, generic);
    }
    assert.strictEqual(
      parseModelDisclosure("AI provider/model: OpenAI/gpt-5"),
      null,
    );
    for (const policyDiscussion of [
      "The `AI provider/model:` field in your comment is malformed.",
      "> AI provider/model: quoted / example",
      "```text\nAI provider/model: example / example-model\n```",
    ]) {
      assert.strictEqual(parseModelDisclosure(policyDiscussion), null);
    }
  });

  it("accepts only trusted category-scoped evidence or a specific N/A reason", () => {
    assert.strictEqual(auditPrEvidence(evidenceBody()).ok, true);

    const trustedRows = new Map([
      [
        "before-screenshots",
        "https://github.com/user-attachments/assets/11111111-1111-1111-1111-111111111111",
      ],
      [
        "after-screenshots",
        "https://github.com/user-attachments/assets/22222222-2222-2222-2222-222222222222",
      ],
      [
        "walkthrough-video",
        "https://github.com/user-attachments/assets/33333333-3333-3333-3333-333333333333",
      ],
      [
        "backend-logs",
        `https://github.com/elizaOS/eliza/blob/${HEAD_SHA}/evidence/backend.log`,
      ],
      [
        "frontend-logs",
        "https://github.com/elizaOS/eliza/actions/runs/123456/artifacts/7890",
      ],
      [
        "llm-trajectory",
        `https://raw.githubusercontent.com/elizaOS/eliza/${HEAD_SHA}/trajectory.json`,
      ],
      ["domain-artifacts", `https://etherscan.io/tx/0x${"c".repeat(64)}`],
    ]);
    const trustedBody = REQUIRED_EVIDENCE_ROWS.map(
      (id) =>
        `<!-- evidence-row:${id} -->\n- [x] ${id}: ${trustedRows.get(id)}`,
    ).join("\n\n");
    assert.strictEqual(auditPrEvidence(trustedBody).ok, true);

    const placeholderBody = REQUIRED_EVIDENCE_ROWS.map(
      (id) =>
        `<!-- evidence-row:${id} -->\n- [ ] ${id}, or marked N/A - <reason>.`,
    ).join("\n\n");
    const audit = auditPrEvidence(placeholderBody);
    assert.strictEqual(audit.ok, false);
    assert.ok(
      audit.findings.every((finding) => finding.status === "unsatisfied"),
    );

    for (const untrusted of [
      "https://example.com/proof.png",
      "https://github.com/elizaOS/eliza/issues/123",
      "https://github.com/elizaOS/eliza/blob/develop/evidence/proof.json",
      `https://etherscan.io/tx/0x${"d".repeat(64)}`,
    ]) {
      const body = REQUIRED_EVIDENCE_ROWS.map(
        (id) => `<!-- evidence-row:${id} -->\n- [x] ${id}: ${untrusted}`,
      ).join("\n\n");
      const findings = auditPrEvidence(body).findings;
      if (untrusted.includes("etherscan.io")) {
        assert.ok(
          findings
            .filter((finding) => finding.id !== "domain-artifacts")
            .every((finding) => finding.status === "unsatisfied"),
        );
      } else {
        assert.ok(
          findings.every((finding) => finding.status === "unsatisfied"),
        );
      }
    }

    const vagueNa = REQUIRED_EVIDENCE_ROWS.map(
      (id) => `<!-- evidence-row:${id} -->\n- [ ] ${id}: N/A - none`,
    ).join("\n\n");
    assert.ok(
      auditPrEvidence(vagueNa).findings.every(
        (finding) => finding.status === "unsatisfied",
      ),
    );

    const missing = auditPrEvidence(
      evidenceBody().replace(
        /<!-- evidence-row:backend-logs -->[\s\S]*?(?=<!-- evidence-row:frontend-logs -->)/,
        "",
      ),
    );
    assert.strictEqual(
      missing.findings.find((finding) => finding.id === "backend-logs")?.status,
      "missing",
    );
  });

  it("accepts substantive inline details only for backend and frontend logs", () => {
    const withEvidenceRow = (target: string, value: string) =>
      REQUIRED_EVIDENCE_ROWS.map((id) =>
        id === target
          ? `<!-- evidence-row:${id} -->\n${value}`
          : `<!-- evidence-row:${id} -->\n- [x] ${id}: N/A - no affected ${id} surface.`,
      ).join("\n\n");
    const backendDetails = [
      "- [x] Backend logs from the exercised request:",
      "",
      "<details>",
      "<summary>Structured backend log output</summary>",
      "",
      "```text",
      "2026-01-18T12:00:00.100Z INFO [AgentRuntime] request started roomId=room-42 action=REPLY",
      "2026-01-18T12:00:00.480Z INFO [AgentRuntime] request completed roomId=room-42 status=success",
      "```",
      "</details>",
    ].join("\n");
    const frontendDetails = [
      "- [x] Frontend console and network output:",
      "<details>",
      "<summary>Browser output</summary>",
      "```text",
      "[2026-01-18T12:00:00.500Z] console.info [Slop] leaderboard loaded entries=25",
      "GET https://slop.cash/data/leaderboard.json 200 duration=84ms",
      "```",
      "</details>",
    ].join("\n");

    assert.strictEqual(
      auditPrEvidence(withEvidenceRow("backend-logs", backendDetails)).ok,
      true,
    );
    assert.strictEqual(
      auditPrEvidence(withEvidenceRow("frontend-logs", frontendDetails)).ok,
      true,
    );
    assert.strictEqual(
      auditPrEvidence(
        withEvidenceRow("frontend-logs", backendDetails),
      ).findings.find((finding) => finding.id === "frontend-logs")?.status,
      "unsatisfied",
    );
    assert.strictEqual(
      auditPrEvidence(
        withEvidenceRow("backend-logs", frontendDetails),
      ).findings.find((finding) => finding.id === "backend-logs")?.status,
      "unsatisfied",
    );

    for (const invalidDetails of [
      "- [x] Logs\n<details><summary>Logs</summary></details>",
      [
        "- [x] Logs",
        "<details>",
        "<summary>Logs</summary>",
        "```text",
        "<paste logs here>",
        "```",
        "</details>",
      ].join("\n"),
      [
        "- [x] Logs",
        "<details>",
        "<summary>Review notes</summary>",
        "This prose says that logs were captured and carefully reviewed.",
        "It contains no structured output from the exercised runtime path.",
        "</details>",
      ].join("\n"),
      [
        "- [x] Logs",
        "<details>",
        "<summary>Long prose in a code block</summary>",
        "```text",
        "The feature was opened in a browser and appeared to behave correctly.",
        "The reviewer checked the result twice but included no runtime output.",
        "```",
        "</details>",
      ].join("\n"),
    ]) {
      for (const rowId of ["backend-logs", "frontend-logs"]) {
        assert.strictEqual(
          auditPrEvidence(withEvidenceRow(rowId, invalidDetails)).findings.find(
            (finding) => finding.id === rowId,
          )?.status,
          "unsatisfied",
        );
      }
    }

    for (const rowId of [
      "before-screenshots",
      "after-screenshots",
      "walkthrough-video",
      "llm-trajectory",
      "domain-artifacts",
    ]) {
      assert.strictEqual(
        auditPrEvidence(withEvidenceRow(rowId, backendDetails)).findings.find(
          (finding) => finding.id === rowId,
        )?.status,
        "unsatisfied",
      );
    }
  });

  it("audits only claims or explicit AI provenance and accepts human-only claims", () => {
    const comments = [
      comment(1, "human", "Ordinary human discussion needs no footer."),
      comment(
        8,
        "policy-reviewer",
        "The `AI provider/model:` field in your comment is malformed.",
      ),
      comment(
        9,
        "quote-reviewer",
        "> AI provider/model: quoted / example\n\nThis is quoted policy text.",
      ),
      comment(
        10,
        "fence-reviewer",
        "```text\nAI provider/model: example / example-model\n```",
      ),
      comment(
        11,
        "fenced-claimer",
        "````text\nCLAIMING: policy example\n```\n````",
      ),
      comment(
        12,
        "indented-claimer",
        "    CLAIMING REVIEW: indented policy example",
      ),
      comment(
        2,
        "human-claimer",
        [
          "CLAIMING: documentation cleanup",
          "",
          "AI assistance: no - human-only claim",
          "Attribution status: self-reported",
        ].join("\n"),
      ),
      comment(3, "missing-claimer", "CLAIMING REVIEW: test coverage"),
      comment(
        4,
        "invalid-ai",
        "AI provider/model: unknown / model\nAttribution status: self-reported",
      ),
      comment(5, "valid-ai", "AI provider/model: OpenAI / gpt-5.6-codex"),
      comment(
        6,
        "nonterminal-human",
        [
          "CLAIMING LEVER: staging deployment",
          "AI assistance: no - human-only claim",
          "Attribution status: self-reported",
          "This text invalidates the terminal footer.",
        ].join("\n"),
      ),
      comment(
        7,
        "automation-bot",
        "CLAIMING: automated update without provenance",
        "Bot",
      ),
    ];

    assert.deepStrictEqual(
      auditCommentDisclosures(
        comments.map((value, index) => ({
          id: value.id,
          kind: "issue-comment",
          url: value.html_url,
          author: value.user.login,
          authorId: value.user.id,
          authorKnown: true,
          bot: value.user.type === "Bot",
          body: value.body ?? "",
          createdAt: value.created_at,
          index,
        })),
      ).map((finding: { id: number }) => finding.id),
      [3, 4, 6],
    );
  });

  it("classifies bot accounts and parses only supported CLI arguments", () => {
    assert.strictEqual(isBotAccount(account("dependabot[bot]", "Bot")), true);
    assert.strictEqual(isBotAccount(account("release-bot")), false);
    assert.strictEqual(isBotAccount(account("MLuber-bot")), false);
    assert.strictEqual(isBotAccount(account("github-actions", "Bot")), true);
    assert.strictEqual(isBotAccount(account("renovate", "Bot")), true);
    assert.strictEqual(isBotAccount(account("octocat")), false);
    assert.deepStrictEqual(
      parseCliArguments(["--repo", "elizaOS/eliza", "--json"]),
      { repo: "elizaOS/eliza", json: true, help: false },
    );
    assert.deepStrictEqual(parseCliArguments([]), {
      repo: "elizaOS/eliza",
      json: false,
      help: false,
    });
    assert.deepStrictEqual(parseCliArguments(["--epoch-only"]), {
      repo: "elizaOS/eliza",
      json: false,
      help: false,
      epochOnly: true,
    });
    assert.throws(
      () => parseCliArguments(["--epoch-only", "--json"]),
      /cannot be combined/,
    );
    assert.deepStrictEqual(
      parseCliArguments([
        "--complete-epoch",
        "report.json",
        "--dispositions",
        "dispositions.json",
      ]),
      {
        repo: "elizaOS/eliza",
        json: false,
        help: false,
        completeEpochPath: "report.json",
        dispositionsPath: "dispositions.json",
      },
    );
    assert.throws(
      () => parseCliArguments(["--complete-epoch", "report.json"]),
      /must be provided together/,
    );
    assert.throws(
      () =>
        parseCliArguments([
          "--recheck-pr",
          "1",
          "--expected-head",
          "a".repeat(40),
          "--complete-epoch",
          "report.json",
          "--dispositions",
          "dispositions.json",
        ]),
      /cannot be combined/,
    );
    assert.throws(
      () => parseCliArguments(["--repo", "invalid"]),
      /owner\/name/,
    );
    assert.throws(() => parseCliArguments(["--write"]), /Unknown argument/);
  });
});

describe("live report behavior", () => {
  it("retries one changed inventory snapshot without weakening other failures", () => {
    let attempts = 0;
    const retries: number[] = [];
    const report = retryChangedLiveInventory(
      () => {
        attempts += 1;
        if (attempts === 1) throw new LiveInventoryChangedError();
        return { coherent: true };
      },
      ({ attempt }) => retries.push(attempt),
    );

    assert.deepStrictEqual(report, { coherent: true });
    assert.strictEqual(attempts, 2);
    assert.deepStrictEqual(retries, [1]);
    assert.throws(
      () =>
        retryChangedLiveInventory(() => {
          throw new TypeError("malformed GitHub response");
        }),
      /malformed GitHub response/,
    );
    assert.throws(
      () =>
        retryChangedLiveInventory(() => {
          throw new LiveInventoryChangedError();
        }),
      /changed while collecting the live report after 2 attempts/,
    );
  });

  it("gives each changed-inventory attempt its own command budget", () => {
    const attemptBudgets: number[] = [];
    const report = retryChangedLiveInventory(
      ({ attempt, commandBudget }) => {
        for (let index = 0; index < MAX_API_READS; index += 1) {
          commandBudget.run("gh", ["api", `attempt-${attempt}-${index}`], {
            encoding: "utf8",
          });
        }
        attemptBudgets.push(commandBudget.count);
        if (attempt === 1) throw new LiveInventoryChangedError();
        return { coherent: true };
      },
      () => {},
      () =>
        createGhCommandBudget(() => ({
          status: 0,
          stdout: "",
          stderr: "",
        })),
    );

    assert.deepStrictEqual(report, { coherent: true });
    assert.deepStrictEqual(attemptBudgets, [MAX_API_READS, MAX_API_READS]);
  it("pins the authenticated identity lookup to github.com", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const identity = readGhAuthenticatedIdentity((command, args) => {
      calls.push({ command, args });
      return {
        status: 0,
        stderr: "",
        stdout: '{"id":42,"login":"fixture-user"}\n',
      };
    });

    assert.deepStrictEqual(identity, {
      host: "github.com",
      id: 42,
      login: "fixture-user",
    });
    assert.deepStrictEqual(calls, [
      {
        command: "gh",
        args: [
          "api",
          "--hostname",
          "github.com",
          "--method",
          "GET",
          "--jq",
          "{id: .id, login: .login}",
          "user",
        ],
      },
    ]);
  });

  it("keeps all four live-report implementations byte-identical", () => {
    const implementations = [
      "contribute-to-asi",
      "contribute-to-delta-star",
      "contribute-to-eliza",
      "contribute-to-heir-elements-sdk",
    ].map((skill) =>
      readFileSync(join(skillDir, "..", skill, "scripts", "live-report.mjs")),
    );

    for (const implementation of implementations.slice(1)) {
      assert.deepStrictEqual(implementation, implementations[0]);
    }
  });

  it("executes locked commands from an explicit secure root", () => {
    const fixture = createLiveReportGhFixture();
    const lockRoot = join(fixture.root, "locks");
    mkdirSync(lockRoot, { mode: 0o700 });
    const lock = acquireLiveReportLock(
      {
        host: "github.com",
        id: fixture.identityId,
        login: "fixture-user",
      },
      { rootPath: lockRoot },
    );
    try {
      const result = lock.spawn("gh", ["api", "user"], {
        encoding: "utf8",
        env: fixture.environment,
      });
      assert.strictEqual(result.status, 0, result.stderr);
      assert.deepStrictEqual(JSON.parse(result.stdout), {
        id: fixture.identityId,
        login: "fixture-user",
      });
    } finally {
      lock.release();
      rmSync(fixture.root, { force: true, recursive: true });
    }
  });

  it("reclaims a stale reused PID but preserves malformed lock evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "slop-live-report-metadata-test-"));
    const identity = {
      host: "github.com",
      id: Number.parseInt(randomBytes(6).toString("hex"), 16),
      login: "fixture-user",
    };
    const lockPath = liveReportLockPath(root, identity.id);
    const ownerPath = join(lockPath, "owner.json");
    try {
      mkdirSync(join(lockPath, "commands"), { recursive: true, mode: 0o700 });
      writeFileSync(ownerPath, "{malformed\n", { mode: 0o600 });
      const malformed = readFileSync(ownerPath);
      assert.throws(
        () => acquireLiveReportLock(identity, { rootPath: root }),
        SyntaxError,
      );
      assert.deepStrictEqual(readFileSync(ownerPath), malformed);

      rmSync(lockPath, { force: true, recursive: true });
      mkdirSync(join(lockPath, "commands"), { recursive: true, mode: 0o700 });
      const currentIdentity = readLiveReportProcessIdentity(process.pid);
      assert.ok(currentIdentity);
      const staleIdentity =
        currentIdentity === "0".repeat(64) ? "1".repeat(64) : "0".repeat(64);
      writeFileSync(
        ownerPath,
        `${JSON.stringify({
          schemaVersion: 2,
          pid: process.pid,
          processIdentity: staleIdentity,
          ownerToken: randomBytes(16).toString("hex"),
        })}\n`,
        { mode: 0o600 },
      );

      const recovered = acquireLiveReportLock(identity, { rootPath: root });
      recovered.release();
      assert.strictEqual(existsSync(lockPath), false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("rejects symlinked and group-readable lock roots", () => {
    const fixtureRoot = mkdtempSync(
      join(tmpdir(), "slop-live-report-root-test-"),
    );
    const target = join(fixtureRoot, "target");
    const symlink = join(fixtureRoot, "symlink");
    const permissive = join(fixtureRoot, "permissive");
    try {
      mkdirSync(target, { mode: 0o700 });
      symlinkSync(target, symlink);
      assert.throws(
        () => ensureLiveReportLockRoot(symlink),
        /must be a real directory/u,
      );
      assert.deepStrictEqual(readdirSync(target), []);

      mkdirSync(permissive, { mode: 0o700 });
      chmodSync(permissive, 0o755);
      if (process.platform !== "win32") {
        assert.throws(
          () => ensureLiveReportLockRoot(permissive),
          /permissions must/u,
        );
      }
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it("serializes stale reclaimers before they can rename a live replacement", {
    timeout: 15_000,
  }, async () => {
    const fixture = createStaleLiveReportLockFixture();
    const originalOwner = readFileSync(fixture.ownerPath);
    const child = spawn(nodeExecutable, fixture.arguments("paused"), {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const completion = collectChild(child);
    try {
      await waitForFixturePath(fixture.readyPath);
      const otherReport = join(
        skillDir,
        "..",
        "contribute-to-asi",
        "scripts",
        "live-report.mjs",
      );
      const contender = spawnSync(
        nodeExecutable,
        fixture.arguments("contender", otherReport),
        { encoding: "utf8", timeout: 5_000 },
      );
      assert.strictEqual(contender.status, 2, contender.stderr);
      assert.match(contender.stderr, /lock contention: transition guard/iu);
      assert.deepStrictEqual(readFileSync(fixture.ownerPath), originalOwner);

      writeFileSync(fixture.resumePath, "resume");
      await waitForFixturePath(fixture.acquiredPath);
      const replacementOwner = readFileSync(fixture.ownerPath);
      assert.notDeepStrictEqual(replacementOwner, originalOwner);
      assert.strictEqual(existsSync(`${fixture.lockPath}.transition`), false);
      assert.throws(
        () =>
          acquireLiveReportLock(fixture.identity, { rootPath: fixture.root }),
        /another report.*already discovering/iu,
      );
      assert.deepStrictEqual(readFileSync(fixture.ownerPath), replacementOwner);
      writeFileSync(fixture.releasePath, "release");
      const completed = await completion;
      assert.strictEqual(completed.status, 0, completed.stderr);
      assert.strictEqual(existsSync(fixture.lockPath), false);
    } finally {
      writeFileSync(fixture.resumePath, "resume");
      writeFileSync(fixture.releasePath, "release");
      await completion;
      rmSync(fixture.root, { force: true, recursive: true });
    }
  });

  it("preserves an interrupted transition guard and fails closed", {
    timeout: 15_000,
  }, async () => {
    const fixture = createStaleLiveReportLockFixture();
    const originalOwner = readFileSync(fixture.ownerPath);
    const child = spawn(nodeExecutable, fixture.arguments("paused"), {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const completion = collectChild(child);
    try {
      await waitForFixturePath(fixture.readyPath);
      child.kill("SIGKILL");
      await completion;
      assert.throws(
        () =>
          acquireLiveReportLock(fixture.identity, { rootPath: fixture.root }),
        /stop all local reports before manually removing this guard/iu,
      );
      assert.strictEqual(existsSync(`${fixture.lockPath}.transition`), true);
      assert.deepStrictEqual(readFileSync(fixture.ownerPath), originalOwner);
    } finally {
      child.kill("SIGKILL");
      await completion;
      rmSync(fixture.root, { force: true, recursive: true });
    }
  });

  it("keeps same-identity project reports out of simultaneous discovery", {
    timeout: 15_000,
  }, async () => {
    const fixture = createLiveReportGhFixture();
    const asiReportPath = join(
      skillDir,
      "..",
      "contribute-to-asi",
      "scripts",
      "live-report.mjs",
    );
    const first = spawn(
      nodeExecutable,
      [liveReportPath, "--repo", "alpha/one", "--json"],
      {
        env: { ...fixture.environment, SLOP_GH_HOLD: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const firstResult = collectChild(first);
    let testError: unknown = null;
    try {
      await waitForFixturePath(fixture.readyPath);
      const alternateTmp = join(fixture.root, "alternate-tmp");
      mkdirSync(alternateTmp, { mode: 0o700 });
      const second = spawnSync(
        nodeExecutable,
        [asiReportPath, "--repo", "beta/two", "--json"],
        {
          encoding: "utf8",
          env: {
            ...fixture.environment,
            TEMP: alternateTmp,
            TMP: alternateTmp,
            TMPDIR: alternateTmp,
          },
        },
      );
      assert.strictEqual(second.status, 2, second.stderr);
      assert.match(second.stderr, /live report lock contention/iu);
      const calls = readFileSync(fixture.logPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]);
      assert.strictEqual(
        calls.filter((args) => args.at(-1) === "rate_limit").length,
        1,
        "the contending report must stop before rate-budget discovery",
      );
    } catch (error) {
      testError = error;
    } finally {
      writeFileSync(fixture.releasePath, "release\n");
    }
    const completed = await firstResult;
    rmSync(fixture.root, { force: true, recursive: true });
    if (testError) throw testError;
    assert.strictEqual(completed.status, 0, completed.stderr);
  });

  it("releases the identity lock after a successful report", () => {
    const fixture = createLiveReportGhFixture();
    const deltaStarReportPath = join(
      skillDir,
      "..",
      "contribute-to-delta-star",
      "scripts",
      "live-report.mjs",
    );
    try {
      const first = spawnSync(nodeExecutable, [liveReportPath, "--json"], {
        encoding: "utf8",
        env: fixture.environment,
      });
      assert.strictEqual(first.status, 0, first.stderr);
      const second = spawnSync(
        nodeExecutable,
        [deltaStarReportPath, "--json"],
        {
          encoding: "utf8",
          env: {
            ...fixture.environment,
            SLOP_GH_DIRECT_GRAPHQL_REMAINING: "999",
          },
        },
      );
      assert.strictEqual(second.status, 0, second.stderr);
      assert.match(second.stderr, /GraphQL 999\/5000.*activity source rest/su);
      const calls = readFileSync(fixture.logPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]);
      assert.strictEqual(
        calls.filter((args) => args.at(-1) === "rate_limit").length,
        2,
      );
      assert.strictEqual(
        calls.filter((args) =>
          args.some((value) => value.includes("SlopActivityRateLimit")),
        ).length,
        2,
      );
    } finally {
      rmSync(fixture.root, { force: true, recursive: true });
    }
  });

  it("releases the identity lock after a handled discovery failure", () => {
    const fixture = createLiveReportGhFixture();
    const asiReportPath = join(
      skillDir,
      "..",
      "contribute-to-asi",
      "scripts",
      "live-report.mjs",
    );
    try {
      const failed = spawnSync(nodeExecutable, [liveReportPath, "--json"], {
        encoding: "utf8",
        env: { ...fixture.environment, SLOP_GH_FAIL_RATE: "1" },
      });
      assert.strictEqual(failed.status, 1);
      assert.match(failed.stderr, /fixture rate-limit failure/u);
      const recovered = spawnSync(nodeExecutable, [asiReportPath, "--json"], {
        encoding: "utf8",
        env: fixture.environment,
      });
      assert.strictEqual(recovered.status, 0, recovered.stderr);
      const calls = readFileSync(fixture.logPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]);
      assert.strictEqual(
        calls.filter((args) => args.at(-1) === "rate_limit").length,
        2,
      );
    } finally {
      rmSync(fixture.root, { force: true, recursive: true });
    }
  });

  it("recovers the identity lock after an interrupted report", {
    timeout: 15_000,
  }, async () => {
    const fixture = createLiveReportGhFixture();
    const heirReportPath = join(
      skillDir,
      "..",
      "contribute-to-heir-elements-sdk",
      "scripts",
      "live-report.mjs",
    );
    const interrupted = spawn(nodeExecutable, [liveReportPath, "--json"], {
      env: { ...fixture.environment, SLOP_GH_HOLD: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const interruptedResult = collectChild(interrupted);
    let heldGhPid: number | null = null;
    let heldGhIdentity: string | null = null;
    let discoveryStarted = false;
    let testError: unknown = null;
    try {
      await waitForFixturePath(fixture.readyPath);
      discoveryStarted = true;
      heldGhPid = Number(readFileSync(fixture.pidPath, "utf8").trim());
      assert.strictEqual(Number.isInteger(heldGhPid) && heldGhPid > 0, true);
      heldGhIdentity = readLiveReportProcessIdentity(heldGhPid);
      assert.ok(heldGhIdentity);
      assert.strictEqual(interrupted.kill("SIGKILL"), true);
      const killed = await interruptedResult;
      assert.strictEqual(killed.status, null);
      assert.strictEqual(killed.signal, "SIGKILL");
      assert.strictEqual(
        readLiveReportProcessIdentity(heldGhPid),
        heldGhIdentity,
      );
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_200));
      assert.strictEqual(
        readLiveReportProcessIdentity(heldGhPid),
        heldGhIdentity,
        "the held GitHub child must outlive the killed report owner",
      );

      const contending = spawnSync(nodeExecutable, [heirReportPath, "--json"], {
        encoding: "utf8",
        env: fixture.environment,
      });
      assert.strictEqual(contending.status, 2, contending.stderr);
      assert.match(contending.stderr, /live report lock contention/iu);
      const calls = readFileSync(fixture.logPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]);
      assert.strictEqual(
        calls.filter((args) => args.at(-1) === "rate_limit").length,
        1,
        "a surviving GitHub child must keep replacement discovery out",
      );
    } catch (error) {
      testError = error;
    } finally {
      if (interrupted.exitCode === null) interrupted.kill("SIGKILL");
      if (!existsSync(fixture.releasePath)) {
        writeFileSync(fixture.releasePath, "release\n");
      }
      if (discoveryStarted) await waitForFixturePath(fixture.donePath);
      if (heldGhPid !== null && heldGhIdentity !== null) {
        await waitForProcessExit(heldGhPid, heldGhIdentity);
      }
    }
    try {
      if (testError) throw testError;
      const recoveryDeadline = Date.now() + 5_000;
      let recovered: ReturnType<typeof spawnSync>;
      do {
        recovered = spawnSync(nodeExecutable, [heirReportPath, "--json"], {
          encoding: "utf8",
          env: fixture.environment,
        });
        if (recovered.status !== 2) break;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
      } while (Date.now() < recoveryDeadline);
      assert.strictEqual(recovered.status, 0, recovered.stderr);
      const calls = readFileSync(fixture.logPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]);
      assert.strictEqual(
        calls.filter((args) => args.at(-1) === "rate_limit").length,
        2,
      );
    } finally {
      rmSync(fixture.root, { force: true, recursive: true });
    }
  });

  it("freezes a finite oldest-first epoch and defers arrivals and overflow", () => {
    const candidates = Array.from(
      { length: MAX_REVIEW_EPOCH_CANDIDATES + 3 },
      (_, index) => ({
        number: index + 1,
        headSha: `${String(index + 1).padStart(2, "0")}${"a".repeat(38)}`,
        updatedAt: "2026-01-18T12:00:00.000Z",
      }),
    );
    candidates.push({
      number: 99,
      headSha: "f".repeat(40),
      updatedAt: "2026-01-20T12:00:01.000Z",
    });

    const epoch = createReviewEpoch(
      candidates,
      "2026-01-20T12:00:00.000Z",
      MAX_REVIEW_EPOCH_CANDIDATES,
    );

    assert.deepStrictEqual(
      epoch.candidates.map((candidate) => candidate.number),
      Array.from(
        { length: MAX_REVIEW_EPOCH_CANDIDATES },
        (_, index) => index + 1,
      ),
    );
    assert.deepStrictEqual(
      epoch.deferred.map((candidate) => [
        candidate.number,
        candidate.deferredReason,
      ]),
      [
        [21, "epoch-limit"],
        [22, "epoch-limit"],
        [23, "epoch-limit"],
        [99, "after-cutoff"],
      ],
    );
    assert.strictEqual(epoch.completion.allowsNextTier, false);
    assert.strictEqual(epoch.completion.maxNextTierOutcomes, 0);
    const incomplete = completeReviewEpoch(epoch, [
      {
        number: 1,
        expectedHeadSha: epoch.candidates[0].headSha,
        status: "merge",
        recommendationUrl:
          "https://github.com/elizaOS/eliza/pull/1#pullrequestreview-1",
      },
    ]);
    assert.strictEqual(incomplete.allowsNextTier, false);
    assert.strictEqual(incomplete.remainingCandidates.length, 19);
    const completed = completeReviewEpoch(
      epoch,
      epoch.candidates.map((candidate) => ({
        number: candidate.number,
        expectedHeadSha: candidate.headSha,
        status: "fix",
        recommendationUrl: `https://github.com/elizaOS/eliza/pull/${candidate.number}#pullrequestreview-${candidate.number}`,
      })),
    );
    assert.strictEqual(completed.complete, true);
    assert.strictEqual(completed.allowsNextTier, true);
    assert.strictEqual(completed.nextTier, "next-eligible-lower-tier");
    assert.strictEqual(completed.maxNextTierOutcomes, 1);
    assert.throws(
      () =>
        completeReviewEpoch(epoch, [
          {
            number: 1,
            expectedHeadSha: epoch.candidates[0].headSha,
            status: "reviewed",
          },
        ]),
      /not a terminal disposition/,
    );
    assert.throws(
      () =>
        completeReviewEpoch(epoch, [
          {
            number: 1,
            expectedHeadSha: epoch.candidates[0].headSha,
            status: "merge",
          },
        ]),
      /recommendationUrl/,
    );
    assert.throws(
      () =>
        completeReviewEpoch(epoch, [
          {
            number: 1,
            expectedHeadSha: epoch.candidates[0].headSha,
            status: "merge",
            recommendationUrl:
              "https://github.com/elizaOS/eliza/pull/2#pullrequestreview-2",
          },
        ]),
      /bounded public GitHub HTTPS URL/,
    );
  });

  it("emits an executable epoch completion record from saved JSON", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "slop-review-epoch-"));
    try {
      const epoch = createReviewEpoch(
        [
          {
            number: 7,
            headSha: "a".repeat(40),
            updatedAt: "2026-01-18T12:00:00.000Z",
          },
        ],
        "2026-01-20T12:00:00.000Z",
      );
      const reportPath = join(fixtureRoot, "report.json");
      const dispositionsPath = join(fixtureRoot, "dispositions.json");
      writeFileSync(reportPath, `${JSON.stringify(epoch)}\n`);
      writeFileSync(
        dispositionsPath,
        `${JSON.stringify([
          {
            number: 7,
            expectedHeadSha: "a".repeat(40),
            status: "close",
            recommendationUrl:
              "https://github.com/elizaOS/eliza/pull/7#pullrequestreview-7",
          },
        ])}\n`,
      );
      const result = spawnSync(
        process.execPath,
        [
          liveReportPath,
          "--complete-epoch",
          reportPath,
          "--dispositions",
          dispositionsPath,
        ],
        { encoding: "utf8" },
      );
      assert.strictEqual(result.status, 0, result.stderr);
      assert.deepStrictEqual(JSON.parse(result.stdout), {
        schemaVersion: 1,
        cutoff: "2026-01-20T12:00:00.000Z",
        complete: true,
        dispositionCount: 1,
        requiredCandidateCount: 1,
        remainingCandidates: [],
        dispositions: [
          {
            number: 7,
            expectedHeadSha: "a".repeat(40),
            status: "close",
            recommendationUrl:
              "https://github.com/elizaOS/eliza/pull/7#pullrequestreview-7",
          },
        ],
        allowsNextTier: true,
        nextTier: "next-eligible-lower-tier",
        maxNextTierOutcomes: 1,
      });

      writeFileSync(dispositionsPath, "[]\n");
      const incomplete = spawnSync(
        process.execPath,
        [
          liveReportPath,
          "--complete-epoch",
          reportPath,
          "--dispositions",
          dispositionsPath,
        ],
        { encoding: "utf8" },
      );
      assert.strictEqual(incomplete.status, 2, incomplete.stderr);
      assert.deepStrictEqual(
        JSON.parse(incomplete.stdout).remainingCandidates,
        [7],
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("requires an exact current head before publishing and defers churn", () => {
    const candidate = {
      number: 7,
      headSha: "a".repeat(40),
      updatedAt: "2026-01-18T12:00:00.000Z",
    };
    assert.deepStrictEqual(
      recheckReviewEpochCandidate(candidate, "A".repeat(40)),
      {
        number: 7,
        status: "current",
        publishable: true,
      },
    );
    assert.deepStrictEqual(
      recheckReviewEpochCandidate(candidate, "b".repeat(40)),
      {
        number: 7,
        status: "stale",
        publishable: false,
        currentHeadSha: "b".repeat(40),
        deferredReason: "head-changed",
      },
    );
    assert.deepStrictEqual(
      recheckReviewEpochCandidate(candidate, "c".repeat(40)),
      {
        number: 7,
        status: "stale",
        publishable: false,
        currentHeadSha: "c".repeat(40),
        deferredReason: "head-changed",
      },
    );
  });

  it("uses a read-only live GET as the publication head guard", () => {
    const calls: string[][] = [];
    const live = readLivePullHead("elizaOS/eliza", 7, (_command, args) => {
      calls.push(args);
      return {
        status: 0,
        stderr: "",
        stdout: JSON.stringify({
          number: 7,
          headSha: "b".repeat(40),
          updatedAt: "2026-01-20T12:00:01.000Z",
        }),
      };
    });
    assert.deepStrictEqual(live, {
      number: 7,
      headSha: "b".repeat(40),
      updatedAt: "2026-01-20T12:00:01.000Z",
    });
    assert.deepStrictEqual(calls[0].slice(0, 4), [
      "api",
      "--method",
      "GET",
      "--jq",
    ]);
    assert.ok(calls[0].at(-1)?.endsWith("/pulls/7"));
  });

  it("invokes gh only through paginated GET requests", () => {
    let invocation:
      | {
          command: string;
          args: string[];
          options: import("node:child_process").SpawnSyncOptionsWithStringEncoding;
        }
      | undefined;
    const pages = readGhPages(
      "repos/elizaOS/eliza/issues?state=open&per_page=100",
      (command, args, options) => {
        invocation = { command, args, options };
        return {
          status: 0,
          stdout: '{"number":1}\n{"number":2}\n',
          stderr: "",
        };
      },
    );

    assert.deepStrictEqual(pages, [{ number: 1 }, { number: 2 }]);
    assert.strictEqual(invocation?.command, "gh");
    // `--slurp` requires gh 2.48+; `--jq .[]` works on gh 2.45 and keeps the
    // request GET-only and fully paginated.
    assert.deepStrictEqual(invocation?.args.slice(0, 6), [
      "api",
      "--method",
      "GET",
      "--paginate",
      "--jq",
      ".[]",
    ]);
    assert.ok(
      !invocation?.args.some((argument) => /POST|PATCH|DELETE/.test(argument)),
    );
    assert.strictEqual(invocation?.options.maxBuffer, 256 * 1024 * 1024);
  });

  it("keeps issues with open closing PRs out of the first-priority queue", () => {
    assert.deepStrictEqual(
      closingIssueNumbers(
        "Fixes #3. Resolves elizaOS/eliza#3. Closes other/repo#22.\n\n> Fixes #30\n\n```text\nFixes #31\n```\n\n<!-- Fixes #32 -->",
        "elizaOS/eliza",
      ),
      [3],
    );

    const issues = [3, 22].map((number) => ({
      number,
      title: `Issue ${number}`,
      html_url: `https://github.com/elizaOS/eliza/issues/${number}`,
      user: account(`issue-author-${number}`),
      labels: [{ name: "mission-ready" }],
      assignees: [],
      comments: 0,
    }));
    const report = collectLiveReport(
      "elizaOS/eliza",
      (endpoint) => {
        if (endpoint.includes("/issues?state=open")) return issues;
        if (endpoint.includes("/pulls?state=open")) {
          return [pullRequest(10, { body: `${evidenceBody()}\n\nFixes #3` })];
        }
        if (endpoint.includes("/issues/10/comments")) return [];
        if (endpoint.includes("/pulls/10/comments")) return [];
        if (endpoint.includes("/pulls/10/reviews")) return [];
        assert.fail(`unexpected endpoint: ${endpoint}`);
      },
      NOW,
      () => {},
      null,
      [MISSION_READY_LABEL],
    );

    assert.deepStrictEqual(
      report.candidateIssues.map((issue) => issue.number),
      [22],
    );
    assert.deepStrictEqual(
      report.filtered.issuesWithOpenPullRequests.map((issue) => ({
        issue: issue.number,
        pulls: issue.closingPullRequests,
      })),
      [{ issue: 3, pulls: [10] }],
    );
    const markdown = renderMarkdown(report);
    assert.ok(markdown.indexOf("Priority 1") < markdown.indexOf("Priority 2"));
    assert.match(markdown, /open closing PR: #10/);
  });

  it("filters bots, sensitive or claimed work and audits disclosures and evidence", () => {
    const openIssues = [
      {
        number: 1,
        title: "Bot issue",
        html_url: "https://github.com/elizaOS/eliza/issues/1",
        user: account("dependabot[bot]", "Bot"),
        labels: [{ name: "good first issue" }],
        assignees: [],
        comments: 0,
      },
      {
        number: 2,
        title: "Claimed issue",
        html_url: "https://github.com/elizaOS/eliza/issues/2",
        user: account("human-one"),
        labels: [{ name: "mission-ready" }],
        assignees: [],
        comments: 1,
      },
      {
        number: 3,
        title: "Candidate issue",
        html_url: "https://github.com/elizaOS/eliza/issues/3",
        user: account("human-two"),
        labels: [{ name: "mission-ready" }],
        assignees: [],
        comments: 1,
      },
      {
        number: 4,
        title: "Sensitive report",
        html_url: "https://github.com/elizaOS/eliza/issues/4",
        user: account("human-three"),
        labels: [{ name: "security" }],
        assignees: [],
        comments: 0,
      },
      {
        number: 5,
        title: "Lane-labeled claim",
        html_url: "https://github.com/elizaOS/eliza/issues/5",
        user: account("human-four"),
        labels: [{ name: "mission-ready" }, { name: "claimed:shaw-codex" }],
        assignees: [],
        comments: 0,
      },
      {
        number: 6,
        title: "Blocked issue",
        html_url: "https://github.com/elizaOS/eliza/issues/6",
        user: account("human-five"),
        labels: [{ name: "mission-ready" }, { name: "status: blocked" }],
        assignees: [],
        comments: 0,
      },
      {
        number: 7,
        title: "Ghost-authored issue",
        html_url: "https://github.com/elizaOS/eliza/issues/7",
        user: null,
        labels: [],
        assignees: [],
        comments: 0,
      },
      {
        number: 8,
        title: "mission-ready typed in title is still a proposal",
        html_url: "https://github.com/elizaOS/eliza/issues/8",
        user: account("human-six"),
        labels: [],
        assignees: [],
        comments: 0,
      },
      {
        number: 9,
        title: "[Epic] Replace the whole contribution pipeline",
        html_url: "https://github.com/elizaOS/eliza/issues/9",
        user: account("human-seven"),
        labels: [{ name: "mission-ready" }],
        assignees: [],
        comments: 0,
      },
      {
        number: 19,
        title: "Decision reserved for a maintainer",
        html_url: "https://github.com/elizaOS/eliza/issues/19",
        user: account("human-eight"),
        labels: [
          { name: "mission-ready" },
          { name: "needs-human-verification" },
        ],
        assignees: [],
        comments: 0,
      },
      {
        number: 20,
        title: "Replace the whole contribution pipeline",
        html_url: "https://github.com/elizaOS/eliza/issues/20",
        user: account("human-nine"),
        labels: [{ name: "mission-ready" }, { name: "Epic 4" }],
        assignees: [],
        comments: 0,
      },
      {
        number: 21,
        title: "Proposal awaiting a decision",
        html_url: "https://github.com/elizaOS/eliza/issues/21",
        user: account("human-ten"),
        labels: [{ name: "mission-ready" }, { name: "status/proposal" }],
        assignees: [],
        comments: 0,
      },
      {
        number: 10,
        title: "PR shadow from issues endpoint",
        html_url: "https://github.com/elizaOS/eliza/pull/10",
        user: account("author"),
        labels: [],
        assignees: [],
        comments: 0,
        pull_request: {},
      },
    ];
    const openPulls = [
      pullRequest(10, { title: "Ready PR", user: account("author") }),
      pullRequest(11, {
        title: "Draft PR",
        user: account("draft-author"),
        draft: true,
        body: null,
      }),
      pullRequest(12, {
        title: "Claimed review",
        user: account("review-author"),
      }),
      pullRequest(13, {
        title: "Bot PR",
        user: account("renovate[bot]", "Bot"),
      }),
      pullRequest(14, {
        title: "Human-only PR",
        user: account("human-author"),
        body: evidenceBody().replace(
          "AI provider/model: OpenAI / gpt-5.6-codex",
          "- AI assistance: no - human-only contribution",
        ),
      }),
      pullRequest(15, {
        title: "Sensitive pull request",
        labels: [{ name: "credential-leak" }],
      }),
      pullRequest(16, {
        title: "Assigned review",
        assignees: [account("assigned-reviewer")],
      }),
      pullRequest(17, {
        title: "Lane-labeled review",
        labels: [{ name: "review-claimed:review-lane" }],
      }),
      pullRequest(18, {
        title: "Ghost-authored pull request",
        user: null,
      }),
    ];
    const calls: string[] = [];
    const responses = new Map<string, unknown[]>([
      [
        "repos/elizaOS/eliza/issues?state=open&per_page=100&sort=created&direction=asc",
        openIssues,
      ],
      [
        "repos/elizaOS/eliza/pulls?state=open&per_page=100&sort=created&direction=asc",
        openPulls,
      ],
      [
        "repos/elizaOS/eliza/issues/2/comments?per_page=100",
        [
          comment(
            20,
            "worker",
            "CLAIMING: scoped fix\n\nAI provider/model: OpenAI / gpt-5.6-codex",
          ),
        ],
      ],
      [
        "repos/elizaOS/eliza/issues/3/comments?per_page=100",
        [
          comment(
            30,
            "visitor",
            "Can reproduce this.\n\n~~~text\nCLAIMING: policy example only\n~~~",
          ),
        ],
      ],
      ["repos/elizaOS/eliza/issues/10/comments?per_page=100", []],
      ["repos/elizaOS/eliza/pulls/10/comments?per_page=100", []],
      ["repos/elizaOS/eliza/pulls/10/reviews?per_page=100", []],
      ["repos/elizaOS/eliza/issues/11/comments?per_page=100", []],
      ["repos/elizaOS/eliza/pulls/11/comments?per_page=100", []],
      ["repos/elizaOS/eliza/pulls/11/reviews?per_page=100", []],
      [
        "repos/elizaOS/eliza/issues/12/comments?per_page=100",
        [
          comment(
            120,
            "reviewer",
            "CLAIMING REVIEW: tests and evidence\n\nAI provider/model: Anthropic / claude-opus-4.1",
          ),
        ],
      ],
      ["repos/elizaOS/eliza/pulls/12/comments?per_page=100", []],
      ["repos/elizaOS/eliza/pulls/12/reviews?per_page=100", []],
      ["repos/elizaOS/eliza/issues/14/comments?per_page=100", []],
      ["repos/elizaOS/eliza/pulls/14/comments?per_page=100", []],
      ["repos/elizaOS/eliza/pulls/14/reviews?per_page=100", []],
      ["repos/elizaOS/eliza/issues/16/comments?per_page=100", []],
      ["repos/elizaOS/eliza/pulls/16/comments?per_page=100", []],
      ["repos/elizaOS/eliza/pulls/16/reviews?per_page=100", []],
      ["repos/elizaOS/eliza/issues/17/comments?per_page=100", []],
      ["repos/elizaOS/eliza/pulls/17/comments?per_page=100", []],
      ["repos/elizaOS/eliza/pulls/17/reviews?per_page=100", []],
    ]);

    const report = collectLiveReport(
      "elizaOS/eliza",
      (endpoint) => {
        calls.push(endpoint);
        const response = responses.get(endpoint);
        assert.ok(response, `unexpected endpoint: ${endpoint}`);
        return response;
      },
      NOW,
      () => {},
      null,
      [MISSION_READY_LABEL],
    );

    assert.deepStrictEqual(
      report.candidateIssues.map((issue) => issue.number),
      [3],
    );
    assert.deepStrictEqual(
      report.reviewablePullRequests.map((pull) => pull.number),
      [10, 14],
    );
    assert.deepStrictEqual(
      report.filtered.botIssues.map((issue) => issue.number),
      [1],
    );
    assert.deepStrictEqual(
      report.filtered.unknownAuthorIssues.map((issue) => issue.number),
      [7],
    );
    assert.deepStrictEqual(
      report.filtered.sensitiveIssues.map((issue) => issue.number),
      [4],
    );
    assert.deepStrictEqual(
      report.filtered.untriagedIssues.map((issue) => issue.number),
      [8, 9, 20],
    );
    assert.deepStrictEqual(
      report.filtered.claimedIssues.map((issue) => issue.number),
      [2, 5, 6, 19, 21],
    );
    assert.deepStrictEqual(
      report.filtered.draftPullRequests.map((pull) => pull.number),
      [11],
    );
    assert.deepStrictEqual(
      report.filtered.claimedPullRequests.map((pull) => pull.number),
      [12, 16, 17],
    );
    assert.deepStrictEqual(
      report.filtered.sensitivePullRequests.map((pull) => pull.number),
      [15],
    );
    assert.deepStrictEqual(
      report.filtered.botPullRequests.map((pull) => pull.number),
      [13],
    );
    assert.deepStrictEqual(
      report.filtered.unknownAuthorPullRequests.map((pull) => pull.number),
      [18],
    );
    assert.deepStrictEqual(
      report.audits.issueComments.map((issue) => issue.number),
      [],
    );
    assert.strictEqual(
      report.audits.pullRequests.find((pull) => pull.number === 10)?.evidence
        .ok,
      true,
    );
    assert.strictEqual(
      report.audits.pullRequests.find((pull) => pull.number === 11)
        ?.bodyProviderModel,
      null,
    );
    assert.strictEqual(
      report.audits.pullRequests.find((pull) => pull.number === 14)
        ?.bodyHumanOnly,
      true,
    );
    assert.ok(
      !calls.some((endpoint) => endpoint.includes("/13/")),
      "bot-authored PR detail endpoints should not be read",
    );
    assert.ok(
      !calls.some((endpoint) => endpoint.includes("/15/")),
      "security-sensitive PR detail endpoints should not be read",
    );
    assert.strictEqual(renderMarkdown(report), renderMarkdown(report));
    assert.match(
      renderMarkdown(report),
      /PR \[#11\].*lacks exact provider\/model/,
    );
    assert.doesNotMatch(
      renderMarkdown(report),
      /PR \[#14\].*lacks exact provider\/model/,
    );
    assert.match(
      renderMarkdown(report),
      /require one configured maintainer-controlled repository label \(mission-ready\)/i,
    );
  });

  it("expires comment claims after seven days but preserves durable issue state", () => {
    assert.strictEqual(CLAIM_RECENCY_DAYS, 7);
    assert.strictEqual(MISSION_READY_LABEL, "mission-ready");
    const issues = [
      {
        number: 20,
        title: "Recent comment claim",
        html_url: "https://github.com/elizaOS/eliza/issues/20",
        user: account("author-20"),
        labels: [{ name: "mission-ready" }],
        assignees: [],
        comments: 1,
      },
      {
        number: 21,
        title: "Expired comment claim",
        html_url: "https://github.com/elizaOS/eliza/issues/21",
        user: account("author-21"),
        labels: [{ name: "mission-ready" }],
        assignees: [],
        comments: 1,
      },
      {
        number: 22,
        title: "Durably assigned",
        html_url: "https://github.com/elizaOS/eliza/issues/22",
        user: account("author-22"),
        labels: [{ name: "mission-ready" }],
        assignees: [account("maintainer")],
        comments: 1,
      },
      {
        number: 23,
        title: "Durably labeled",
        html_url: "https://github.com/elizaOS/eliza/issues/23",
        user: account("author-23"),
        labels: [
          { name: "mission-ready" },
          { name: "  status: in-progress  " },
        ],
        assignees: [],
        comments: 1,
      },
      {
        number: 24,
        title: "Untrusted public claim",
        html_url: "https://github.com/elizaOS/eliza/issues/24",
        user: account("author-24"),
        labels: [{ name: "mission-ready" }],
        assignees: [],
        comments: 1,
      },
    ];
    const comments = new Map([
      [
        20,
        [
          comment(
            200,
            "worker",
            "CLAIMING: recent work",
            "User",
            "2026-01-14T12:00:01.000Z",
          ),
        ],
      ],
      [
        21,
        [
          comment(
            210,
            "worker",
            "CLAIMING: abandoned work",
            "User",
            "2026-01-13T11:59:59.000Z",
          ),
        ],
      ],
      [
        22,
        [
          comment(
            220,
            "worker",
            "CLAIMING: abandoned work",
            "User",
            "2026-01-01T00:00:00.000Z",
          ),
        ],
      ],
      [
        23,
        [
          comment(
            230,
            "worker",
            "CLAIMING: abandoned work",
            "User",
            "2026-01-01T00:00:00.000Z",
          ),
        ],
      ],
      [
        24,
        [
          comment(
            240,
            "outside-visitor",
            "CLAIMING: cannot reserve work without repository trust",
            "User",
            "2026-01-18T12:00:00.000Z",
            "NONE",
          ),
        ],
      ],
    ]);
    const report = collectLiveReport(
      "elizaOS/eliza",
      (endpoint) => {
        if (endpoint.includes("/issues?state=open")) return issues;
        if (endpoint.includes("/pulls?state=open")) return [];
        const number = Number(endpoint.match(/issues\/(\d+)\/comments/)?.[1]);
        const response = comments.get(number);
        assert.ok(response, `unexpected endpoint: ${endpoint}`);
        return response;
      },
      NOW,
    );

    assert.deepStrictEqual(
      report.candidateIssues.map((issue) => issue.number),
      [21, 24],
    );
    assert.deepStrictEqual(
      report.filtered.claimedIssues.map((issue) => issue.number),
      [20, 22, 23],
    );
    const assigneeClaim = report.filtered.claimedIssues.find(
      (issue) => issue.number === 22,
    );
    const labelClaim = report.filtered.claimedIssues.find(
      (issue) => issue.number === 23,
    );
    assert.ok(assigneeClaim);
    assert.ok(labelClaim);
    assert.match(assigneeClaim.claimReasons.join(" "), /assignees: maintainer/);
    assert.match(
      labelClaim.claimReasons.join(" "),
      /labels: status: in-progress/,
    );
  });

  it("treats live review requests as durable and uses current-head review state", () => {
    const pulls = [
      pullRequest(30, {
        requested_reviewers: [account("recent-reviewer")],
      }),
      pullRequest(31, {
        requested_reviewers: [account("stale-reviewer")],
      }),
      pullRequest(32),
      pullRequest(33),
      pullRequest(34),
      pullRequest(35, {
        requested_teams: [{ slug: "core-maintainers" }],
      }),
      pullRequest(36),
      pullRequest(37),
      pullRequest(38, {
        requested_reviewers: [account("automation-bot", "Bot")],
      }),
      pullRequest(39, {
        requested_reviewers: [account("recent-fallback")],
      }),
      pullRequest(40, {
        requested_reviewers: [account("stale-fallback")],
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      }),
      pullRequest(41),
      pullRequest(42),
      pullRequest(43),
      pullRequest(45),
      pullRequest(46),
      pullRequest(47),
      pullRequest(48),
      pullRequest(49, {
        assignees: [account("AUTHOR-49")],
      }),
      pullRequest(50),
      pullRequest(51),
      pullRequest(52),
      pullRequest(53),
    ];
    const issueComments = new Map<number, CommentFixture[]>([
      [
        36,
        [
          comment(
            360,
            "old-reviewer",
            "CLAIMING REVIEW: abandoned review",
            "User",
            "2026-01-01T00:00:00.000Z",
          ),
        ],
      ],
      [
        37,
        [
          comment(
            370,
            "active-reviewer",
            "CLAIMING REVIEW: current review",
            "User",
            "2026-01-18T00:00:00.000Z",
          ),
        ],
      ],
      [
        47,
        [
          comment(
            470,
            "AUTHOR-47",
            "CLAIMING REVIEW: self-review does not reserve the independent lane",
          ),
        ],
      ],
      [48, [comment(480, "empty-marker", "CLAIMING REVIEW:")]],
      [
        51,
        [
          {
            ...comment(
              510,
              "deleted-reviewer",
              "CLAIMING REVIEW: deleted authors cannot reserve work",
            ),
            user: null,
          },
        ],
      ],
      [
        52,
        [
          comment(
            520,
            "spaced-marker",
            "CLAIMING REVIEW : noncanonical marker",
          ),
        ],
      ],
    ]);
    const reviews = new Map<number, ReturnType<typeof review>[]>([
      [32, [review(320, "approver", "APPROVED")]],
      [33, [review(330, "requester", "CHANGES_REQUESTED")]],
      [34, [review(340, "past-reviewer", "APPROVED", PRIOR_SHA)]],
      [41, [review(410, null, "APPROVED")]],
      [
        42,
        [
          review(420, "tied-reviewer", "APPROVED"),
          review(421, "tied-reviewer", "CHANGES_REQUESTED"),
        ],
      ],
      [
        43,
        [
          {
            ...review(430, "github-actions", "CHANGES_REQUESTED"),
            user: account("github-actions"),
          },
        ],
      ],
      [
        45,
        [
          review(
            450,
            "commenting-reviewer",
            "CHANGES_REQUESTED",
            HEAD_SHA,
            "2026-01-18T12:00:00.000Z",
          ),
          review(
            451,
            "commenting-reviewer",
            "COMMENTED",
            HEAD_SHA,
            "2026-01-18T13:00:00.000Z",
          ),
        ],
      ],
      [
        46,
        [
          review(
            460,
            "dismissed-reviewer",
            "CHANGES_REQUESTED",
            HEAD_SHA,
            "2026-01-18T12:00:00.000Z",
          ),
          review(
            461,
            "dismissed-reviewer",
            "DISMISSED",
            HEAD_SHA,
            "2026-01-18T13:00:00.000Z",
          ),
        ],
      ],
      [
        53,
        [
          review(
            530,
            null,
            "CHANGES_REQUESTED",
            HEAD_SHA,
            "2026-01-18T12:00:00.000Z",
          ),
          review(531, null, "APPROVED", HEAD_SHA, "2026-01-18T13:00:00.000Z"),
        ],
      ],
    ]);
    const inlineComments = new Map<number, ReturnType<typeof comment>[]>([
      [
        50,
        [
          comment(
            500,
            "inline-reviewer",
            "CLAIMING REVIEW: inspecting this exact code path",
          ),
        ],
      ],
    ]);
    const report = collectLiveReport(
      "elizaOS/eliza",
      (endpoint) => {
        if (endpoint.includes("/issues?state=open")) return [];
        if (endpoint.includes("/pulls?state=open")) return pulls;
        const issueComment = endpoint.match(/issues\/(\d+)\/comments/);
        if (issueComment) {
          return issueComments.get(Number(issueComment[1])) ?? [];
        }
        const inlineComment = endpoint.match(/pulls\/(\d+)\/comments/);
        if (inlineComment) {
          return inlineComments.get(Number(inlineComment[1])) ?? [];
        }
        const reviewList = endpoint.match(/pulls\/(\d+)\/reviews/);
        if (reviewList) return reviews.get(Number(reviewList[1])) ?? [];
        assert.fail(`unexpected endpoint: ${endpoint}`);
      },
      NOW,
    );

    assert.deepStrictEqual(
      report.reviewablePullRequests.map((pull) => pull.number),
      [34, 36, 46, 47, 48, 49, 51, 52],
    );
    assert.deepStrictEqual(
      report.filtered.claimedPullRequests.map((pull) => pull.number),
      [30, 31, 35, 37, 38, 39, 40, 50],
    );
    assert.deepStrictEqual(
      report.filtered.reviewedPullRequests.map((pull) => pull.number),
      [32, 41],
    );
    assert.deepStrictEqual(
      report.filtered.changesRequestedPullRequests.map((pull) => pull.number),
      [33, 42, 43, 45, 53],
    );
    assert.deepStrictEqual(
      report.filtered.claimedPullRequests.find((pull) => pull.number === 31)
        ?.reviewState.activeRequests,
      ["stale-reviewer"],
    );
    assert.deepStrictEqual(
      report.reviewablePullRequests.find((pull) => pull.number === 34)
        ?.reviewState.currentHeadApprovals,
      [],
    );
    assert.doesNotMatch(renderMarkdown(report), /#31/);
    assert.match(renderMarkdown(report), /Claim comments expire after 7 days/);
    assert.match(
      renderMarkdown(report),
      /review requests persist until cleared/,
    );
  });

  it("rejects malformed review commit revisions", () => {
    assert.throws(
      () =>
        collectLiveReport(
          "elizaOS/eliza",
          (endpoint) => {
            if (endpoint.includes("/issues?state=open")) return [];
            if (endpoint.includes("/pulls?state=open")) {
              return [pullRequest(44)];
            }
            if (endpoint.includes("/issues/44/comments")) return [];
            if (endpoint.includes("/pulls/44/comments")) return [];
            if (endpoint.includes("/pulls/44/reviews")) {
              return [review(440, "reviewer", "APPROVED", "short-sha")];
            }
            assert.fail(`unexpected endpoint: ${endpoint}`);
          },
          NOW,
        ),
      /commit_id must be a full commit SHA or null/,
    );
  });

  it("ignores unreachable reviewed history but rejects missing review timestamps", () => {
    const report = collectLiveReport(
      "elizaOS/eliza",
      (endpoint) => {
        if (endpoint.includes("/issues?state=open")) return [];
        if (endpoint.includes("/pulls?state=open")) return [pullRequest(45)];
        if (endpoint.includes("/issues/45/comments")) return [];
        if (endpoint.includes("/pulls/45/comments")) return [];
        if (endpoint.includes("/pulls/45/reviews")) {
          return [{ ...review(450, "reviewer", "APPROVED"), commit_id: null }];
        }
        assert.fail(`unexpected endpoint: ${endpoint}`);
      },
      NOW,
    );
    assert.deepStrictEqual(
      report.reviewablePullRequests.map((pull) => pull.number),
      [45],
    );

    assert.throws(
      () =>
        collectLiveReport(
          "elizaOS/eliza",
          (endpoint) => {
            if (endpoint.includes("/issues?state=open")) return [];
            if (endpoint.includes("/pulls?state=open")) {
              return [pullRequest(46)];
            }
            if (endpoint.includes("/issues/46/comments")) return [];
            if (endpoint.includes("/pulls/46/comments")) return [];
            if (endpoint.includes("/pulls/46/reviews")) {
              return [
                {
                  ...review(451, "reviewer", "CHANGES_REQUESTED"),
                  submitted_at: null,
                },
              ];
            }
            assert.fail(`unexpected endpoint: ${endpoint}`);
          },
          NOW,
        ),
      /missing the timestamp for its CHANGES_REQUESTED decision/,
    );
  });
});

describe("run receipt CLI", () => {
  it("accepts the repository root without comparing path spellings", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "slop-windows-repo-root-"));
    const repositoryRoot = join(fixtureRoot, "repo");
    try {
      mkdirSync(repositoryRoot);
      runGit(repositoryRoot, ["init", "--quiet"]);
      assert.strictEqual(isRepositoryRoot(repositoryRoot), true);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  function runGit(cwd: string, args: string[]) {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.strictEqual(result.status, 0, result.stderr);
    return result.stdout.trim();
  }

  function runAsync(
    executable: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv },
  ) {
    return new Promise<{
      status: number | null;
      stderr: string;
      stdout: string;
    }>((resolvePromise) => {
      const child = spawn(executable, args, {
        env: options.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("close", (status) => {
        resolvePromise({ status, stderr, stdout });
      });
    });
  }

  async function waitForPath(path: string, timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs;
    while (!existsSync(path)) {
      if (Date.now() >= deadline) {
        assert.fail(`timed out waiting for ${path}`);
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    }
  }

  function encodedDirectoryName(path: string) {
    return path
      .replaceAll("\\", "/")
      .replace(/\/$/u, "")
      .replaceAll(/[^A-Za-z0-9]/gu, "-");
  }

  function session(
    sessionId: string,
    projectPath: string | null,
    totalTokens: number,
  ) {
    return {
      sessionId,
      ...(projectPath === null ? {} : { projectPath }),
      inputTokens: totalTokens,
      outputTokens: 0,
      totalTokens,
    };
  }

  it("runs the CLI when its entrypoint reaches the module through a symlink", () => {
    const fixtureRoot = mkdtempSync(
      join(tmpdir(), "contribute-to-eliza-run-receipt-"),
    );
    const linkedEntrypoint = join(fixtureRoot, "run-receipt.mjs");
    try {
      symlinkSync(runReceiptPath, linkedEntrypoint);
      assert.notStrictEqual(linkedEntrypoint, realpathSync(linkedEntrypoint));

      const result = spawnSync(process.execPath, [linkedEntrypoint], {
        encoding: "utf8",
      });

      assert.strictEqual(result.status, 0, result.stderr);
      assert.match(result.stdout, /^Usage: node scripts\/run-receipt\.mjs/m);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it("rejects placeholder provider, model, and client declarations", () => {
    const result = spawnSync(
      process.execPath,
      [
        runReceiptPath,
        "doctor",
        "--client",
        "client",
        "--provider",
        "provider",
        "--model",
        "model",
      ],
      { encoding: "utf8" },
    );
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /exact non-placeholder identifier/u);
  });

  it("attributes ccusage's encoded Claude Code project directories to the repository root", () => {
    const repositoryRoot = resolve(tmpdir(), "contribute-to-eliza-usage");
    const normalizedRoot = repositoryRoot
      .replaceAll("\\", "/")
      .replace(/\/$/u, "");
    const encoded = encodedDirectoryName(repositoryRoot);

    const report = normalizeSessionReport(
      {
        sessions: [
          session("encoded-dialect", encoded, 12),
          session("real-path-dialect", normalizedRoot, 2),
          session("foreign-encoded", "-Users-someone-else-repository", 18),
          session("unattributed", null, 6),
        ],
      },
      repositoryRoot,
    );

    const kept = Object.values(report.sessions);
    assert.deepStrictEqual(
      kept.map((entry) => entry.totalTokens).sort((a, b) => a - b),
      [2, 6, 12],
    );
    assert.deepStrictEqual(
      kept
        .filter((entry) => entry.pathMatched)
        .map((entry) => entry.totalTokens)
        .sort((a, b) => a - b),
      [2, 12],
    );

    const before = normalizeSessionReport(
      { sessions: [session("encoded-dialect", encoded, 16)] },
      repositoryRoot,
    );
    const after = normalizeSessionReport(
      { sessions: [session("encoded-dialect", encoded, 166)] },
      repositoryRoot,
    );
    const delta = usageDelta(before, after, "claude-code");
    assert.strictEqual(delta.confidence, "exact");
    assert.strictEqual(delta.totalTokens, 150);
  });

  it("treats ccusage's Codex directory field as exact only for the full path", () => {
    const repositoryRoot = resolve(tmpdir(), "slop-a", "same-name");
    const report = normalizeSessionReport(
      {
        sessions: [
          {
            ...session("codex-exact", null, 11),
            directory: repositoryRoot,
          },
          {
            ...session("codex-bounded", null, 7),
            directory: resolve(tmpdir(), "slop-b", "same-name"),
          },
        ],
      },
      repositoryRoot,
    );
    const entries = Object.values(report.sessions);
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(
      entries.find((entry) => entry.totalTokens === 11)?.pathMatched,
      true,
    );
    assert.strictEqual(
      entries.find((entry) => entry.totalTokens === 7)?.pathMatched,
      false,
    );
    assert.strictEqual(
      usageDelta({ sessions: {} }, report, "codex").confidence,
      "bounded",
    );
  });

  it("starts and finishes a measured run without passing --project to ccusage", {
    timeout: 30_000,
  }, async () => {
    const fixtureRoot = realpathSync(
      mkdtempSync(join(tmpdir(), "contribute-to-eliza-start-")),
    );
    try {
      const repoRoot = join(fixtureRoot, "repo");
      mkdirSync(repoRoot, { recursive: true });
      runGit(repoRoot, ["init", "--quiet"]);
      runGit(repoRoot, [
        "remote",
        "add",
        "origin",
        "git@github.com:elizaOS/eliza.git",
      ]);
      const installedSkillRoot = join(
        fixtureRoot,
        "installed",
        "contribute-to-eliza",
      );
      cpSync(skillDir, installedSkillRoot, { recursive: true });
      const policyRoot = join(fixtureRoot, "policy-authority");
      const policyDirectory = join(policyRoot, "projects", "eliza");
      mkdirSync(policyDirectory, { recursive: true });
      const policyLicense = join(policyRoot, "LICENSE");
      writeFileSync(policyLicense, "fixture license bytes\n");
      const policyLicenseSha256 = createHash("sha256")
        .update(readFileSync(policyLicense))
        .digest("hex");
      writeFileSync(
        join(policyDirectory, "terms.json"),
        JSON.stringify({
          schemaVersion: "1",
          projectId: "eliza",
          status: "active",
          steward: {},
          authority: {
            state: "verified",
            proof: {
              policyRevision: "test-policy-1",
              verifiedAt: "2026-08-16T12:00:00.000Z",
            },
          },
          terms: {
            revision: "test-policy-1",
            receiptPolicy: {
              state: "active",
              activatedAt: "2026-08-16T12:00:00.000Z",
            },
            repositoryLicense: {
              state: "verified",
              url: pathToFileURL(policyLicense).href,
              fileSha256: policyLicenseSha256,
            },
            inbound: {
              mode: "license",
              termsUrl: null,
              fileSha256: null,
            },
            externalPrize: null,
          },
        }),
      );
      const installedProjectPath = join(installedSkillRoot, "project.json");
      const installedProject = JSON.parse(
        readFileSync(installedProjectPath, "utf8"),
      );
      installedProject.policyAuthority = pathToFileURL(policyRoot).href;
      writeFileSync(
        installedProjectPath,
        `${JSON.stringify(installedProject, null, 2)}\n`,
      );
      const sourceRevision = "a".repeat(40);
      const installedFiles = readdirSync(installedSkillRoot, {
        recursive: true,
        withFileTypes: true,
      })
        .filter((entry) => entry.isFile())
        .map((entry) =>
          join(entry.parentPath, entry.name)
            .slice(installedSkillRoot.length + 1)
            .replaceAll("\\", "/"),
        )
        .sort();
      writeFileSync(
        join(installedSkillRoot, "PROVENANCE.json"),
        `${JSON.stringify(
          {
            schemaVersion: "1",
            name: "contribute-to-eliza",
            repository: "SlopDotCash/slopdotcash",
            revision: sourceRevision,
            revisionStatus: "committed",
            source: {
              path: "skills/contribute-to-eliza/SKILL.md",
              sha256: createHash("sha256")
                .update(readFileSync(join(installedSkillRoot, "SKILL.md")))
                .digest("hex"),
            },
            files: installedFiles.map((path) => ({
              path,
              sha256: createHash("sha256")
                .update(readFileSync(join(installedSkillRoot, path)))
                .digest("hex"),
            })),
          },
          null,
          2,
        )}\n`,
      );
      writeFileSync(
        join(installedSkillRoot, ".slop-authorization.json"),
        `${JSON.stringify(
          {
            schemaVersion: "1",
            repository: "SlopDotCash/slopdotcash",
            revision: sourceRevision,
            authorization: {
              kind: "develop",
              develop: sourceRevision,
            },
          },
          null,
          2,
        )}\n`,
      );

      const shimDir = join(fixtureRoot, "bin");
      mkdirSync(shimDir);
      const argsLog = join(fixtureRoot, "ccusage-args.log");
      const runnerLog = join(fixtureRoot, "package-runner.log");
      const fixturePayload = join(fixtureRoot, "ccusage-report.json");
      const failureFlag = join(fixtureRoot, "ccusage-fail");
      const quotedArgsLog = `'${argsLog.replaceAll("'", `'"'"'`)}'`;
      const quotedRunnerLog = `'${runnerLog.replaceAll("'", `'"'"'`)}'`;
      const quotedFixture = `'${fixturePayload.replaceAll("'", `'"'"'`)}'`;
      const quotedFailureFlag = `'${failureFlag.replaceAll("'", `'"'"'`)}'`;
      const shimSource = [
        "#!/bin/sh",
        `printf '%s\\n' "bun $*" >> ${quotedRunnerLog}`,
        'if [ "$1" = "--version" ]; then',
        "  echo 1.3.14",
        "  exit 0",
        "fi",
        'if [ "$3" = "--version" ]; then',
        `  printf '%s\\n' "$*" >> ${quotedArgsLog}`,
        "  echo ccusage 20.0.20",
        "  exit 0",
        "fi",
        `if [ -f ${quotedFailureFlag} ]; then`,
        "  exit 7",
        "fi",
        `printf '%s\\n' "$*" >> ${quotedArgsLog}`,
        `/bin/cat ${quotedFixture}`,
        "",
      ].join("\n");
      writeFileSync(join(shimDir, "bun"), shimSource);
      chmodSync(join(shimDir, "bun"), 0o755);
      writeFileSync(
        join(shimDir, "npx"),
        [
          "#!/bin/sh",
          `printf '%s\\n' "npx $*" >> ${quotedRunnerLog}`,
          "exit 97",
          "",
        ].join("\n"),
      );
      chmodSync(join(shimDir, "npx"), 0o755);

      const encodedRepo = encodedDirectoryName(repoRoot);
      const environment = {
        ...process.env,
        PATH: `${shimDir}:/usr/bin:/bin`,
        HOME: join(fixtureRoot, "home"),
        CODEX_HOME: join(fixtureRoot, "codex"),
        CLAUDE_CONFIG_DIR: join(fixtureRoot, "claude"),
        XDG_CONFIG_HOME: join(fixtureRoot, "config"),
      };
      const receiptEntrypoint = join(
        installedSkillRoot,
        "scripts",
        "run-receipt.mjs",
      );
      const entrypoint = join(fixtureRoot, "run-receipt-test-harness.mjs");
      writeFileSync(
        entrypoint,
        `import { main } from ${JSON.stringify(pathToFileURL(receiptEntrypoint).href)};
try {
  await main(process.argv.slice(2), { testPolicyAuthority: ${JSON.stringify(pathToFileURL(policyRoot).href)} });
} catch (error) {
  process.stderr.write(\`project run receipt failed: \${error instanceof Error ? error.message : String(error)}\\n\`);
  process.exitCode = 1;
}
`,
      );
      const cliArguments = [
        "--repo-root",
        repoRoot,
        "--client",
        "claude-code",
        "--provider",
        "anthropic",
        "--model",
        "claude-fable-5",
        "--lane",
        "skill-tests",
        "--json",
      ];
      const unavailableIdentityArguments = [
        "--repo-root",
        repoRoot,
        "--client",
        "codex",
        "--provider",
        "openai",
        "--model",
        "gpt-5.6-sol",
        "--json",
      ];
      const unavailableArguments = [
        ...unavailableIdentityArguments,
        "--lane",
        "skill-tests-unavailable",
      ];
      const stateRoot = join(environment.XDG_CONFIG_HOME, "slop", "runs");

      const preview = spawnSync(
        process.execPath,
        [
          entrypoint,
          "preview",
          "--repo-root",
          repoRoot,
          "--client",
          "claude-code",
          "--json",
        ],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(preview.status, 0, preview.stderr);
      const previewReport = JSON.parse(preview.stdout);
      assert.deepStrictEqual(previewReport.automaticUploads, []);
      assert.strictEqual(
        previewReport.modelEvidence,
        "must-be-declared-local-not-provider-attested",
      );
      assert.strictEqual(previewReport.consentFlag, "--allow-local-usage");
      assert.strictEqual(
        previewReport.packageExecutionConsentFlag,
        "--allow-package-execution",
      );
      assert.strictEqual(
        previewReport.usageUnavailableFlag,
        "--usage-unavailable",
      );
      assert.match(
        previewReport.usageReadDisclosure,
        /invokes no package manager.*reads no usage logs.*signed zero.*usage never affects scoring/u,
      );
      assert.match(
        previewReport.network.join("\n"),
        /https:\/\/slop\.cash\/projects\/eliza\/terms\.json.*digest-bound LICENSE.*raw\.githubusercontent\.com/su,
      );
      assert.match(
        previewReport.usageReadDisclosure,
        /policy checks and trace networking remain/u,
      );
      assert.match(previewReport.linkabilityDisclosure, /link receipts/u);
      assert.match(previewReport.localReads.join("\n"), /claude.*projects/is);
      assert.strictEqual(existsSync(argsLog), false);
      assert.strictEqual(existsSync(runnerLog), false);
      assert.strictEqual(existsSync(join(fixtureRoot, "config")), false);

      const missingDoctorConsent = spawnSync(
        process.execPath,
        [
          entrypoint,
          "doctor",
          "--repo-root",
          repoRoot,
          "--client",
          "claude-code",
          "--provider",
          "anthropic",
          "--model",
          "claude-fable-5",
          "--json",
        ],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(missingDoctorConsent.status, 1);
      assert.match(
        missingDoctorConsent.stderr,
        /requires exactly one of --allow-package-execution or --usage-unavailable/u,
      );
      assert.strictEqual(existsSync(argsLog), false);
      assert.strictEqual(existsSync(runnerLog), false);

      const ambiguousDoctor = spawnSync(
        process.execPath,
        [
          entrypoint,
          "doctor",
          ...unavailableIdentityArguments,
          "--allow-package-execution",
          "--usage-unavailable",
        ],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(ambiguousDoctor.status, 1);
      assert.match(ambiguousDoctor.stderr, /choose exactly one/u);
      assert.strictEqual(existsSync(runnerLog), false);

      const unavailableDoctor = spawnSync(
        process.execPath,
        [
          entrypoint,
          "doctor",
          ...unavailableIdentityArguments,
          "--usage-unavailable",
        ],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(unavailableDoctor.status, 0, unavailableDoctor.stderr);
      const unavailableDoctorReport = JSON.parse(unavailableDoctor.stdout);
      assert.strictEqual(unavailableDoctorReport.ok, true);
      assert.deepStrictEqual(unavailableDoctorReport.ccusage, {
        expectedVersion: "20.0.20",
        version: null,
        runner: null,
        status: "intentional-unavailable",
        logsRead: false,
      });
      assert.match(
        unavailableDoctorReport.message,
        /package execution and local usage-log reads are disabled/u,
      );
      assert.strictEqual(existsSync(runnerLog), false);

      for (const unsupportedClient of [
        "custom-agent",
        "constructor",
        "toString",
      ]) {
        const unsupportedUnavailableDoctor = spawnSync(
          process.execPath,
          [
            entrypoint,
            "doctor",
            "--repo-root",
            repoRoot,
            "--client",
            unsupportedClient,
            "--provider",
            "custom-provider",
            "--model",
            "custom-model",
            "--usage-unavailable",
          ],
          { encoding: "utf8", env: environment },
        );
        assert.strictEqual(unsupportedUnavailableDoctor.status, 1);
        assert.match(
          unsupportedUnavailableDoctor.stderr,
          /valid only for a supported usage adapter/u,
        );
        assert.strictEqual(existsSync(runnerLog), false);
      }

      const unavailableStarted = spawnSync(
        process.execPath,
        [entrypoint, "start", ...unavailableArguments, "--usage-unavailable"],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(
        unavailableStarted.status,
        0,
        unavailableStarted.stderr,
      );
      const unavailableStartReport = JSON.parse(unavailableStarted.stdout);
      assert.strictEqual(unavailableStartReport.usageStatus, "unavailable");
      const unavailableActivePath = join(
        stateRoot,
        "active",
        `${unavailableStartReport.runId}.json`,
      );
      assert.strictEqual(
        JSON.parse(readFileSync(unavailableActivePath, "utf8")).baseline,
        null,
      );
      assert.strictEqual(existsSync(runnerLog), false);
      rmSync(unavailableActivePath);

      const unavailableWithLocalConsent = spawnSync(
        process.execPath,
        [
          entrypoint,
          "start",
          ...unavailableArguments,
          "--usage-unavailable",
          "--allow-local-usage",
        ],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(unavailableWithLocalConsent.status, 1);
      assert.match(
        unavailableWithLocalConsent.stderr,
        /--allow-local-usage is not valid with --usage-unavailable/u,
      );
      assert.strictEqual(existsSync(runnerLog), false);

      const ambiguousStart = spawnSync(
        process.execPath,
        [
          entrypoint,
          "start",
          ...unavailableArguments,
          "--allow-package-execution",
          "--usage-unavailable",
          "--allow-local-usage",
        ],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(ambiguousStart.status, 1);
      assert.match(ambiguousStart.stderr, /choose exactly one/u);
      assert.strictEqual(existsSync(runnerLog), false);

      const doctor = spawnSync(
        process.execPath,
        [
          entrypoint,
          "doctor",
          "--repo-root",
          repoRoot,
          "--client",
          "claude-code",
          "--provider",
          "anthropic",
          "--model",
          "claude-fable-5",
          "--allow-package-execution",
          "--json",
        ],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(
        doctor.status,
        0,
        `${doctor.stderr}\n${doctor.stdout}`,
      );
      const doctorReport = JSON.parse(doctor.stdout);
      assert.strictEqual(doctorReport.ccusage.version, "20.0.20");
      assert.strictEqual(doctorReport.ccusage.logsRead, false);
      assert.deepStrictEqual(readFileSync(argsLog, "utf8").trim().split("\n"), [
        "x ccusage@20.0.20 --version",
      ]);

      const missingConsent = spawnSync(
        process.execPath,
        [entrypoint, "start", ...cliArguments, "--allow-package-execution"],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(missingConsent.status, 1, missingConsent.stdout);
      assert.match(missingConsent.stderr, /requires --allow-local-usage/u);
      assert.strictEqual(
        readFileSync(argsLog, "utf8").trim().split("\n").length,
        1,
      );

      writeFileSync(
        fixturePayload,
        JSON.stringify({
          sessions: [
            session("unsafe-session", encodedRepo, Number.MAX_SAFE_INTEGER + 1),
          ],
        }),
      );
      const unsafeStarted = spawnSync(
        process.execPath,
        [
          entrypoint,
          "start",
          ...cliArguments,
          "--allow-package-execution",
          "--allow-local-usage",
        ],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(unsafeStarted.status, 0, unsafeStarted.stderr);
      const unsafeStartReport = JSON.parse(unsafeStarted.stdout);
      assert.strictEqual(unsafeStartReport.usageStatus, "unavailable");
      const unsafeActivePath = join(
        stateRoot,
        "active",
        `${unsafeStartReport.runId}.json`,
      );
      assert.strictEqual(
        JSON.parse(readFileSync(unsafeActivePath, "utf8")).baseline,
        null,
      );
      const unsafeStatus = spawnSync(
        process.execPath,
        [entrypoint, "status", "--json"],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(unsafeStatus.status, 0, unsafeStatus.stderr);
      assert.strictEqual(JSON.parse(unsafeStatus.stdout).runs.length, 1);
      rmSync(unsafeActivePath);

      writeFileSync(
        fixturePayload,
        JSON.stringify({
          sessions: [session("fixture-session", encodedRepo, 16)],
        }),
      );
      const started = spawnSync(
        process.execPath,
        [
          entrypoint,
          "start",
          ...cliArguments,
          "--allow-package-execution",
          "--allow-local-usage",
        ],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(started.status, 0, started.stderr);
      const startReport = JSON.parse(started.stdout);
      assert.strictEqual(startReport.usageStatus, "capturing");
      assert.match(startReport.runId, /^run_[0-9A-HJKMNP-TV-Z]{26}$/);

      const activeDirectory = join(stateRoot, "active");
      const foreignRunId = `run_${"0".repeat(26)}`;
      const foreignStatePath = join(activeDirectory, `${foreignRunId}.json`);
      writeFileSync(
        foreignStatePath,
        `${JSON.stringify({ projectId: "asi" })}\n`,
      );
      const activeStatus = spawnSync(
        process.execPath,
        [entrypoint, "status", "--json"],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(activeStatus.status, 0, activeStatus.stderr);
      const activeRuns = JSON.parse(activeStatus.stdout).runs;
      assert.strictEqual(activeRuns.length, 1);
      assert.deepStrictEqual(
        { ...activeRuns[0], startedAt: null },
        {
          runId: startReport.runId,
          state: "active",
          client: "claude-code",
          model: "claude-fable-5",
          lane: "skill-tests",
          startedAt: null,
          completedAt: null,
        },
      );
      assert.strictEqual(
        new Date(activeRuns[0].startedAt).toISOString(),
        activeRuns[0].startedAt,
      );
      const activePath = join(activeDirectory, `${startReport.runId}.json`);
      const activeBytes = readFileSync(activePath, "utf8");
      writeFileSync(
        activePath,
        `${JSON.stringify({
          projectId: "eliza",
          runId: startReport.runId,
        })}\n`,
      );
      const truncatedActiveStatus = spawnSync(
        process.execPath,
        [entrypoint, "status", "--json"],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(truncatedActiveStatus.status, 1);
      assert.match(truncatedActiveStatus.stderr, /invalid identity/u);
      writeFileSync(activePath, activeBytes);

      const mismatchedFilename = join(
        activeDirectory,
        `run_${"4".repeat(26)}.json`,
      );
      writeFileSync(mismatchedFilename, activeBytes);
      const mismatchedFilenameStatus = spawnSync(
        process.execPath,
        [entrypoint, "status", "--json"],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(mismatchedFilenameStatus.status, 1);
      assert.match(mismatchedFilenameStatus.stderr, /filename.*run id/u);
      rmSync(mismatchedFilename);
      rmSync(foreignStatePath);

      for (const [field, value] of [
        ["provider", "evil"],
        [
          "skillRevision",
          `SlopDotCash/slopdotcash@${"b".repeat(40)}:skills/contribute-to-eliza`,
        ],
        ["skillSha256", "b".repeat(64)],
      ]) {
        const tamperedActive = JSON.parse(activeBytes);
        tamperedActive[field] = value;
        writeFileSync(
          activePath,
          `${JSON.stringify(tamperedActive, null, 2)}\n`,
        );
        const tamperedFinish = spawnSync(
          process.execPath,
          [
            entrypoint,
            "finish",
            ...cliArguments,
            "--run",
            startReport.runId,
            "--allow-package-execution",
          ],
          { encoding: "utf8", env: environment },
        );
        assert.strictEqual(tamperedFinish.status, 1);
      }
      writeFileSync(activePath, activeBytes);

      const ccusageInvocations = readFileSync(argsLog, "utf8")
        .trim()
        .split("\n");
      assert.deepStrictEqual(ccusageInvocations, [
        "x ccusage@20.0.20 --version",
        "x ccusage@20.0.20 claude session --json --mode calculate",
        "x ccusage@20.0.20 claude session --json --mode calculate",
      ]);

      writeFileSync(
        fixturePayload,
        JSON.stringify({
          sessions: [session("fixture-session", encodedRepo, 166)],
        }),
      );
      const trajectoryPath = join(fixtureRoot, "trajectory.json");
      writeFileSync(trajectoryPath, '{"result":"accepted"}\n');
      const trajectorySha256 = createHash("sha256")
        .update(readFileSync(trajectoryPath))
        .digest("hex");
      const traceArguments = [
        "--trace-server-run",
        "server_test_run",
        "--trace-object-id",
        `sha256:${trajectorySha256}`,
      ];
      const expectedUnavailableUsage = {
        source: "ccusage-session-v20",
        confidence: "unavailable",
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        costMicroUsd: "0",
        sessionCount: 0,
      };
      const measuredBeforeUnavailableFinish = spawnSync(
        process.execPath,
        [
          entrypoint,
          "start",
          ...cliArguments,
          "--allow-package-execution",
          "--allow-local-usage",
        ],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(
        measuredBeforeUnavailableFinish.status,
        0,
        measuredBeforeUnavailableFinish.stderr,
      );
      const measuredBeforeUnavailableFinishId = JSON.parse(
        measuredBeforeUnavailableFinish.stdout,
      ).runId;
      const measuredBeforeUnavailableFinishState = JSON.parse(
        readFileSync(
          join(
            stateRoot,
            "active",
            `${measuredBeforeUnavailableFinishId}.json`,
          ),
          "utf8",
        ),
      );
      assert.notStrictEqual(
        measuredBeforeUnavailableFinishState.baseline,
        null,
      );
      const runnerLogBeforeDowngrade = readFileSync(runnerLog, "utf8");
      const argsLogBeforeDowngrade = readFileSync(argsLog, "utf8");
      const unavailableDowngrade = spawnSync(
        process.execPath,
        [
          entrypoint,
          "finish",
          ...cliArguments,
          "--run",
          measuredBeforeUnavailableFinishId,
          "--trajectory",
          trajectoryPath,
          ...traceArguments,
          "--usage-unavailable",
        ],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(
        unavailableDowngrade.status,
        0,
        unavailableDowngrade.stderr,
      );
      assert.deepStrictEqual(
        JSON.parse(unavailableDowngrade.stdout).receipt.usage,
        expectedUnavailableUsage,
      );
      assert.strictEqual(
        readFileSync(runnerLog, "utf8"),
        runnerLogBeforeDowngrade,
      );
      assert.strictEqual(readFileSync(argsLog, "utf8"), argsLogBeforeDowngrade);
      rmSync(
        join(
          stateRoot,
          "completed",
          `${measuredBeforeUnavailableFinishId}.json`,
        ),
      );

      const runnerLogBeforeUnavailable = readFileSync(runnerLog, "utf8");
      const argsLogBeforeUnavailable = readFileSync(argsLog, "utf8");
      const unavailableRestarted = spawnSync(
        process.execPath,
        [entrypoint, "start", ...unavailableArguments, "--usage-unavailable"],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(
        unavailableRestarted.status,
        0,
        unavailableRestarted.stderr,
      );
      const unavailableRunId = JSON.parse(unavailableRestarted.stdout).runId;
      const unavailableFinished = spawnSync(
        process.execPath,
        [
          entrypoint,
          "finish",
          ...unavailableArguments,
          "--run",
          unavailableRunId,
          "--trajectory",
          trajectoryPath,
          ...traceArguments,
          "--usage-unavailable",
        ],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(
        unavailableFinished.status,
        0,
        unavailableFinished.stderr,
      );
      const unavailableFinishReport = JSON.parse(unavailableFinished.stdout);
      assert.deepStrictEqual(
        unavailableFinishReport.receipt.usage,
        expectedUnavailableUsage,
      );
      assert.match(
        unavailableFinishReport.footer,
        /Compute receipt: 0 project-attributed tokens \(unavailable;/u,
      );
      const unavailableReplay = spawnSync(
        process.execPath,
        [
          entrypoint,
          "finish",
          ...unavailableArguments,
          "--run",
          unavailableRunId,
          "--trajectory",
          trajectoryPath,
          ...traceArguments,
          "--usage-unavailable",
        ],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(unavailableReplay.status, 0, unavailableReplay.stderr);
      assert.strictEqual(
        JSON.parse(unavailableReplay.stdout).footer,
        unavailableFinishReport.footer,
      );
      assert.strictEqual(
        readFileSync(runnerLog, "utf8"),
        runnerLogBeforeUnavailable,
      );
      assert.strictEqual(
        readFileSync(argsLog, "utf8"),
        argsLogBeforeUnavailable,
      );
      rmSync(join(stateRoot, "completed", `${unavailableRunId}.json`));

      const finished = spawnSync(
        process.execPath,
        [
          entrypoint,
          "finish",
          ...cliArguments,
          "--run",
          startReport.runId,
          "--trajectory",
          trajectoryPath,
          ...traceArguments,
          "--allow-package-execution",
        ],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(finished.status, 0, finished.stderr);
      assert.match(
        finished.stderr,
        /wallet-claim\.mjs register --address <public-address>/u,
      );
      const finishReport = JSON.parse(finished.stdout);
      assert.strictEqual(finishReport.receipt.usage.confidence, "exact");
      assert.strictEqual(finishReport.receipt.usage.totalTokens, 150);
      assert.strictEqual(
        finishReport.receipt.trajectorySha256,
        trajectorySha256,
      );
      assert.match(
        finishReport.footer,
        /Compute receipt: 150 project-attributed tokens \(exact/,
      );
      const replayed = spawnSync(
        process.execPath,
        [
          entrypoint,
          "finish",
          ...cliArguments,
          "--run",
          startReport.runId,
          "--trajectory",
          trajectoryPath,
          ...traceArguments,
          "--allow-package-execution",
        ],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(replayed.status, 0, replayed.stderr);
      assert.strictEqual(
        JSON.parse(replayed.stdout).footer,
        finishReport.footer,
      );
      const trajectoryReplay = spawnSync(
        process.execPath,
        [
          entrypoint,
          "finish",
          ...cliArguments,
          "--run",
          startReport.runId,
          "--trajectory",
          trajectoryPath,
          ...traceArguments,
          "--allow-package-execution",
        ],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(trajectoryReplay.status, 0, trajectoryReplay.stderr);
      writeFileSync(trajectoryPath, '{"result":"different"}\n');
      const differentTrajectorySha256 = createHash("sha256")
        .update(readFileSync(trajectoryPath))
        .digest("hex");
      const mismatchedTrajectoryReplay = spawnSync(
        process.execPath,
        [
          entrypoint,
          "finish",
          ...cliArguments,
          "--run",
          startReport.runId,
          "--trajectory",
          trajectoryPath,
          "--trace-server-run",
          "server_test_run",
          "--trace-object-id",
          `sha256:${differentTrajectorySha256}`,
          "--allow-package-execution",
        ],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(mismatchedTrajectoryReplay.status, 1);
      assert.match(
        mismatchedTrajectoryReplay.stderr,
        /trajectory does not match|run state does not match/u,
      );
      writeFileSync(trajectoryPath, '{"result":"accepted"}\n');

      const status = spawnSync(
        process.execPath,
        [entrypoint, "status", "--json"],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(status.status, 0, status.stderr);
      assert.deepStrictEqual(JSON.parse(status.stdout).runs, [
        {
          runId: startReport.runId,
          state: "completed",
          client: "claude-code",
          model: "claude-fable-5",
          lane: "skill-tests",
          startedAt: finishReport.receipt.startedAt,
          completedAt: finishReport.receipt.completedAt,
        },
      ]);

      const completedDirectory = join(stateRoot, "completed");
      const completedPath = join(
        completedDirectory,
        `${startReport.runId}.json`,
      );
      const completedBytes = readFileSync(completedPath, "utf8");
      const tamperedCompleted = JSON.parse(completedBytes);
      tamperedCompleted.footer = `${tamperedCompleted.footer}\nforged`;
      writeFileSync(
        completedPath,
        `${JSON.stringify(tamperedCompleted, null, 2)}\n`,
      );
      const tamperedStatus = spawnSync(
        process.execPath,
        [entrypoint, "status", "--json"],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(tamperedStatus.status, 1);
      assert.match(tamperedStatus.stderr, /signature or footer is invalid/u);
      const tamperedReplay = spawnSync(
        process.execPath,
        [
          entrypoint,
          "finish",
          ...cliArguments,
          "--run",
          startReport.runId,
          "--trajectory",
          trajectoryPath,
          ...traceArguments,
          "--allow-package-execution",
        ],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(tamperedReplay.status, 1);
      assert.match(tamperedReplay.stderr, /signature or footer is invalid/u);
      writeFileSync(completedPath, completedBytes);

      const extraFieldCompleted = JSON.parse(completedBytes);
      extraFieldCompleted.receipt.privateData = "must not be republished";
      writeFileSync(
        completedPath,
        `${JSON.stringify(extraFieldCompleted, null, 2)}\n`,
      );
      const extraFieldStatus = spawnSync(
        process.execPath,
        [entrypoint, "status", "--json"],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(extraFieldStatus.status, 1);
      assert.match(extraFieldStatus.stderr, /invalid identity/u);
      const extraFieldReplay = spawnSync(
        process.execPath,
        [
          entrypoint,
          "finish",
          ...cliArguments,
          "--run",
          startReport.runId,
          "--trajectory",
          trajectoryPath,
          ...traceArguments,
          "--allow-package-execution",
        ],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(extraFieldReplay.status, 1);
      assert.match(extraFieldReplay.stderr, /invalid identity/u);
      writeFileSync(completedPath, completedBytes);

      const canonicalFooterLines = finishReport.footer.split("\n");
      const legacyFooter = [
        ...canonicalFooterLines.slice(1, 4),
        canonicalFooterLines[0],
        ...canonicalFooterLines
          .slice(4)
          .map((line) =>
            line.replace(
              "slop-contribution-attribution:v1",
              "elizaos-contribution-attribution:v2",
            ),
          ),
      ].join("\n");
      writeFileSync(
        completedPath,
        `${JSON.stringify(
          { receipt: finishReport.receipt, footer: legacyFooter },
          null,
          2,
        )}\n`,
      );
      const legacyStatus = spawnSync(
        process.execPath,
        [entrypoint, "status", "--json"],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(legacyStatus.status, 0, legacyStatus.stderr);
      assert.strictEqual(
        JSON.parse(legacyStatus.stdout).runs[0].lane,
        "skill-tests",
      );
      const legacyReplay = spawnSync(
        process.execPath,
        [
          entrypoint,
          "finish",
          ...cliArguments,
          "--run",
          startReport.runId,
          "--trajectory",
          trajectoryPath,
          ...traceArguments,
          "--allow-package-execution",
        ],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(legacyReplay.status, 0, legacyReplay.stderr);
      assert.strictEqual(
        JSON.parse(legacyReplay.stdout).footer,
        finishReport.footer,
      );
      writeFileSync(completedPath, completedBytes);

      const adversarialRunIds = ["1", "2", "3"].map(
        (digit) => `run_${digit.repeat(26)}`,
      );
      const malformedPath = join(
        completedDirectory,
        `${adversarialRunIds[0]}.json`,
      );
      writeFileSync(malformedPath, "{\n");
      const malformedStatus = spawnSync(
        process.execPath,
        [entrypoint, "status", "--json"],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(malformedStatus.status, 1);
      assert.match(malformedStatus.stderr, /not valid JSON/u);
      rmSync(malformedPath);

      const symlinkedPath = join(
        completedDirectory,
        `${adversarialRunIds[1]}.json`,
      );
      symlinkSync(completedPath, symlinkedPath);
      const symlinkedStatus = spawnSync(
        process.execPath,
        [entrypoint, "status", "--json"],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(symlinkedStatus.status, 1);
      assert.match(symlinkedStatus.stderr, /not a bounded regular file/u);
      rmSync(symlinkedPath);

      const oversizedPath = join(
        completedDirectory,
        `${adversarialRunIds[2]}.json`,
      );
      writeFileSync(oversizedPath, "");
      truncateSync(oversizedPath, 34 * 1024 * 1024);
      const oversizedStatus = spawnSync(
        process.execPath,
        [entrypoint, "status", "--json"],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(oversizedStatus.status, 1);
      assert.match(oversizedStatus.stderr, /not a bounded regular file/u);
      rmSync(oversizedPath);

      const unexpectedPath = join(completedDirectory, "interrupted.tmp");
      writeFileSync(unexpectedPath, "pending\n");
      const unexpectedStatus = spawnSync(
        process.execPath,
        [entrypoint, "status", "--json"],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(unexpectedStatus.status, 1);
      assert.match(unexpectedStatus.stderr, /unexpected entry/u);
      rmSync(unexpectedPath);

      writeFileSync(failureFlag, "fail exact ccusage runner\n");
      const failedCapture = spawnSync(
        process.execPath,
        [
          entrypoint,
          "start",
          ...cliArguments,
          "--allow-package-execution",
          "--allow-local-usage",
        ],
        {
          encoding: "utf8",
          env: environment,
        },
      );
      assert.strictEqual(failedCapture.status, 0, failedCapture.stderr);
      assert.strictEqual(
        JSON.parse(failedCapture.stdout).usageStatus,
        "unavailable",
      );
      const concurrentRunId = JSON.parse(failedCapture.stdout).runId;
      rmSync(failureFlag);
      const concurrentArguments = [
        entrypoint,
        "finish",
        ...cliArguments,
        "--run",
        concurrentRunId,
        "--trajectory",
        trajectoryPath,
        ...traceArguments,
        "--allow-package-execution",
      ];
      const raceHook = join(fixtureRoot, "finish-race-hook.mjs");
      const raceReady = join(fixtureRoot, "finish-race-ready");
      const raceRelease = join(fixtureRoot, "finish-race-release");
      const concurrentActivePath = join(
        activeDirectory,
        `${concurrentRunId}.json`,
      );
      writeFileSync(
        raceHook,
        [
          'import fs from "node:fs";',
          'import { syncBuiltinESMExports } from "node:module";',
          "const originalExists = fs.existsSync.bind(fs);",
          "const originalRead = fs.readFileSync.bind(fs);",
          "const originalWrite = fs.writeFileSync.bind(fs);",
          "const { RACE_ACTIVE: active, RACE_READY: ready, RACE_RELEASE: release } = process.env;",
          "let blocked = false;",
          "const sleeper = new Int32Array(new SharedArrayBuffer(4));",
          "fs.readFileSync = (path, ...args) => {",
          "  if (!blocked && String(path) === active) {",
          "    blocked = true;",
          '    originalWrite(ready, "ready\\n", { flag: "wx" });',
          "    while (!originalExists(release)) Atomics.wait(sleeper, 0, 0, 10);",
          "  }",
          "  return originalRead(path, ...args);",
          "};",
          "syncBuiltinESMExports();",
          "",
        ].join("\n"),
      );
      const nodeLookup = spawnSync("sh", ["-c", "command -v node"], {
        encoding: "utf8",
      });
      assert.strictEqual(nodeLookup.status, 0, nodeLookup.stderr);
      const loserPromise = runAsync(
        nodeLookup.stdout.trim(),
        ["--import", raceHook, ...concurrentArguments],
        {
          env: {
            ...environment,
            RACE_ACTIVE: concurrentActivePath,
            RACE_READY: raceReady,
            RACE_RELEASE: raceRelease,
          },
        },
      );
      let winnerResult: Awaited<ReturnType<typeof runAsync>> | null = null;
      let coordinationError: unknown = null;
      try {
        await waitForPath(raceReady);
        winnerResult = await runAsync(process.execPath, concurrentArguments, {
          env: environment,
        });
      } catch (error) {
        coordinationError = error;
      } finally {
        if (!existsSync(raceRelease)) writeFileSync(raceRelease, "release\n");
      }
      const loserResult = await loserPromise;
      if (coordinationError) throw coordinationError;
      assert.ok(winnerResult);
      assert.strictEqual(winnerResult.status, 0, winnerResult.stderr);
      assert.strictEqual(loserResult.status, 0, loserResult.stderr);
      assert.strictEqual(
        JSON.parse(winnerResult.stdout).footer,
        JSON.parse(loserResult.stdout).footer,
      );
      assert.deepStrictEqual(readdirSync(join(stateRoot, "pending")), []);
      assert.strictEqual(existsSync(concurrentActivePath), false);
      const concurrentStatus = spawnSync(
        process.execPath,
        [entrypoint, "status", "--json"],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(concurrentStatus.status, 0, concurrentStatus.stderr);
      assert.ok(
        JSON.parse(concurrentStatus.stdout).runs.some(
          (run: { runId: string; state: string }) =>
            run.runId === concurrentRunId && run.state === "completed",
        ),
      );

      writeFileSync(
        join(shimDir, "bun"),
        shimSource.replace("echo ccusage 20.0.20", "echo ccusage 120.0.20"),
      );
      const npxShimSource = [
        "#!/bin/sh",
        `printf '%s\\n' "npx $*" >> ${quotedRunnerLog}`,
        'if [ "$1" = "--version" ]; then',
        "  echo 11.0.0",
        "  exit 0",
        "fi",
        'if [ "$3" = "--version" ]; then',
        `  printf '%s\\n' "$*" >> ${quotedArgsLog}`,
        "  echo ccusage 20.0.20",
        "  exit 0",
        "fi",
        "exit 7",
        "",
      ].join("\n");
      writeFileSync(join(shimDir, "npx"), npxShimSource);
      chmodSync(join(shimDir, "npx"), 0o755);
      const fallbackDoctor = spawnSync(
        process.execPath,
        [
          entrypoint,
          "doctor",
          "--repo-root",
          repoRoot,
          "--client",
          "claude-code",
          "--provider",
          "anthropic",
          "--model",
          "claude-fable-5",
          "--allow-package-execution",
          "--json",
        ],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(fallbackDoctor.status, 0, fallbackDoctor.stderr);
      const fallbackReport = JSON.parse(fallbackDoctor.stdout);
      assert.strictEqual(fallbackReport.ok, true);
      assert.strictEqual(fallbackReport.ccusage.runner, "npx");

      writeFileSync(
        join(shimDir, "npx"),
        npxShimSource.replace("echo ccusage 20.0.20", "echo noisy-20.0.20"),
      );
      const wrongVersionDoctor = spawnSync(
        process.execPath,
        [
          entrypoint,
          "doctor",
          "--repo-root",
          repoRoot,
          "--client",
          "claude-code",
          "--provider",
          "anthropic",
          "--model",
          "claude-fable-5",
          "--allow-package-execution",
          "--json",
        ],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(wrongVersionDoctor.status, 1);
      const wrongVersionReport = JSON.parse(wrongVersionDoctor.stdout);
      assert.strictEqual(wrongVersionReport.ok, false);
      assert.strictEqual(wrongVersionReport.ccusage.version, null);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });
});
