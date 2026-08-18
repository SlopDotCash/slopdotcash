/**
 * Verifies the bundled contributor skill, its local references, and its
 * read-only GitHub report using deterministic API fixtures.
 */

import assert from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  auditCommentDisclosures,
  auditPrEvidence,
  CLAIM_RECENCY_DAYS,
  collectLiveReport,
  createGhCommandBudget,
  isBotAccount,
  MAX_ACTIVITY_CONNECTION_ITEMS,
  MISSION_READY_LABEL,
  parseCliArguments,
  parseModelDisclosure,
  parsePaginatedJson,
  REQUIRED_EVIDENCE_ROWS,
  readGhOpenActivity,
  readGhPages,
  readProjectSelectionPolicy,
  renderMarkdown,
} from "../skills/contribute-to-eliza/scripts/live-report.mjs";
import {
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
    assert.match(String(description), /implement.*review|review.*implement/i);
    assert.doesNotMatch(source, /\[TODO[:\]]/);
  });

  it("encodes outcome modes, measured runs, security, sync, proof, and authority", () => {
    const source = readFileSync(skillPath, "utf8");

    assert.match(source, /\*\*Implement\*\*/);
    assert.match(source, /\*\*Review\*\*/);
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
    assert.match(source, /Do not put both markers in the same\s+source/i);
    assert.doesNotMatch(source, /ss251 gets \+50|give ss251 extra points/i);
  });

  it("rejects contribution spam and gates work on the primary Eliza mission", () => {
    const source = readFileSync(skillPath, "utf8");
    const mission = readFileSync(
      join(skillDir, "references", "mission-priorities.md"),
      "utf8",
    );

    assert.match(source, /Do not create an issue automatically/i);
    assert.match(
      source,
      /Never apply, request, suggest applying, or automate/i,
    );
    assert.match(source, /exact repository label\s+`mission-ready`/i);
    assert.match(source, /explicit operator request/i);
    assert.match(source, /Keep at most one active implementation or review/i);
    assert.match(source, /Never\s+mirror a PR title into an issue/i);
    assert.match(source, /Prefer one complete fix to\s+several small PRs/i);
    assert.match(source, /Ignore leaderboard position/i);
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
    assert.match(openaiYaml, /one mission-critical contribution/);
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
      ["status", "--repo-root", "/tmp"],
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
    const calls: string[][] = [];
    const activity = readGhOpenActivity("elizaOS/eliza", (command, args) => {
      assert.strictEqual(command, "gh");
      calls.push(args);
      const selector = args.at(-1);
      return {
        status: 0,
        stderr: "",
        stdout: `${JSON.stringify(
          selector?.includes(".issues.") ? issueNode : pullNode,
        )}\n`,
      };
    });

    assert.strictEqual(calls.length, 2);
    assert.ok(calls.every((args) => args.includes("graphql")));
    assert.ok(calls.every((args) => args.includes("--paginate")));
    assert.ok(
      calls.every((args) => args[args.indexOf("--method") + 1] === "POST"),
    );
    assert.ok(
      calls.every((args) => {
        const query = args.find((argument) => argument.startsWith("query="));
        return query?.includes("query(") && !/\bmutation\b/i.test(query);
      }),
    );
    assert.strictEqual(activity.issues.get(1)?.[0].user.id, 42);
    assert.strictEqual(activity.pulls.get(2)?.reviews[0].commit_id, HEAD_SHA);
    assert.strictEqual(activity.pulls.get(2)?.inlineComments.length, 1);
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
    assert.strictEqual(isBotAccount(account("release-bot")), true);
    assert.strictEqual(isBotAccount(account("github-actions")), true);
    assert.strictEqual(isBotAccount(account("renovate")), true);
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
    assert.throws(
      () => parseCliArguments(["--repo", "invalid"]),
      /owner\/name/,
    );
    assert.throws(() => parseCliArguments(["--write"]), /Unknown argument/);
  });
});

describe("live report behavior", () => {
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
      [34, 36, 43, 46, 47, 48, 49, 51, 52],
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
      [33, 42, 45, 53],
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
    timeout: 60_000,
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
            repository: "elizaOS/slopdotcash",
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
            repository: "elizaOS/slopdotcash",
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
      const fixturePayload = join(fixtureRoot, "ccusage-report.json");
      const failureFlag = join(fixtureRoot, "ccusage-fail");
      const quotedArgsLog = `'${argsLog.replaceAll("'", `'"'"'`)}'`;
      const quotedFixture = `'${fixturePayload.replaceAll("'", `'"'"'`)}'`;
      const quotedFailureFlag = `'${failureFlag.replaceAll("'", `'"'"'`)}'`;
      const shimSource = [
        "#!/bin/sh",
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
      assert.match(previewReport.linkabilityDisclosure, /link receipts/u);
      assert.match(previewReport.localReads.join("\n"), /claude.*projects/is);
      assert.strictEqual(existsSync(argsLog), false);
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
        /requires --allow-package-execution/u,
      );
      assert.strictEqual(existsSync(argsLog), false);

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
      assert.strictEqual(doctor.status, 0, doctor.stderr);
      const doctorReport = JSON.parse(doctor.stdout);
      assert.strictEqual(doctorReport.ccusage.version, "20.0.20");
      assert.strictEqual(doctorReport.ccusage.logsRead, false);
      assert.deepStrictEqual(readFileSync(argsLog, "utf8").trim().split("\n"), [
        "x ccusage@20.0.20 --version",
      ]);

      const missingConsent = spawnSync(
        process.execPath,
        [entrypoint, "start", ...cliArguments],
        { encoding: "utf8", env: environment },
      );
      assert.strictEqual(missingConsent.status, 1, missingConsent.stdout);
      assert.match(missingConsent.stderr, /requires --allow-local-usage/u);
      assert.strictEqual(
        readFileSync(argsLog, "utf8").trim().split("\n").length,
        1,
      );

      const stateRoot = join(environment.XDG_CONFIG_HOME, "slop", "runs");
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
          `elizaOS/slopdotcash@${"b".repeat(40)}:skills/contribute-to-eliza`,
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
