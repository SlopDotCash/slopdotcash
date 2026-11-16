// The staging release gates: deployment order (real Git and a stub `gh`), the
// published root's availability and security headers, and the checked-in
// staging payment configuration.
import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

// These cases run real Git and runtime subprocesses. Windows process startup
// can exceed Bun's five-second unit-test default without a guard failure.
if (process.platform === "win32") setDefaultTimeout(60_000);
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "slop-staging-order-"));
  roots.push(root);
  const remote = join(root, "remote");
  const checkout = join(root, "checkout");
  mkdirSync(remote);
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git(remote, "init", "-b", "development");
  git(remote, "config", "user.name", "Staging test");
  git(remote, "config", "user.email", "staging@example.invalid");
  const revisions: string[] = [];
  for (let i = 0; i < 4; i++) {
    git(
      remote,
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "-m",
      `revision ${i}`,
    );
    revisions.push(git(remote, "rev-parse", "HEAD"));
  }
  git(remote, "checkout", "-b", "divergent", revisions[0]);
  git(
    remote,
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--allow-empty",
    "-m",
    "divergent",
  );
  const divergent = git(remote, "rev-parse", "HEAD");
  git(root, "clone", "--no-local", remote, checkout);
  git(checkout, "checkout", "--detach", revisions[1]);
  const bin = join(root, "bin");
  mkdirSync(bin);
  const historyPath = join(root, "history.json");
  const callsPath = join(root, "calls");
  const creatorsPath = join(root, "creators.json");
  writeFileSync(creatorsPath, "{}");
  const requestsPath = join(root, "requests");
  const stub = String.raw`const fs = require('node:fs');
if (process.env.FAIL_HISTORY) process.exit(1);
if (!process.argv.includes('--include')) process.exit(2);
const path = process.argv.at(-1);
const requestedAt = Date.now();
fs.appendFileSync(process.env.REST_CALLS, JSON.stringify({ path, requestedAt }) + '\n');
const request = fs.readFileSync(process.env.REST_CALLS, 'utf8').trim().split('\n').length;
function response(status, body, headers = {}) {
  process.stdout.write('HTTP/2.0 ' + status + '\r\nContent-Type: application/json\r\n' +
    Object.entries(headers).map(([name, value]) => name + ': ' + value + '\r\n').join('') +
    '\r\n' + JSON.stringify(body));
  process.exit(status === 200 ? 0 : 1);
}
const quota = JSON.parse(process.env.QUOTA_FIXTURE || '{}');
if (quota.requests?.includes(request)) {
  if (quota.forceOrigin) {
    require('node:child_process').execFileSync('git', ['-C', process.env.FIXTURE_ORIGIN, 'branch', '-f', 'development', quota.forceOrigin]);
  }
  if (quota.nextPages) fs.writeFileSync(process.env.HISTORY_PATH, JSON.stringify(quota.nextPages));
  const headers = { ...quota.headers };
  if (quota.resetInSeconds !== undefined) {
    headers['X-Ratelimit-Reset'] = String(Math.floor(requestedAt / 1000) + quota.resetInSeconds);
  }
  response(quota.http, {message:'API rate limit exceeded for installation synthetic'}, headers);
}
const creators = JSON.parse(fs.readFileSync(process.env.CREATORS_PATH, 'utf8'));
const status = /^repos\/SlopDotCash\/slopdotcash\/deployments\/(\d+)\/statuses\?per_page=100$/.exec(path);
if (status) {
  if (!creators[status[1]]) response(404, {});
  response(200, [{log_url:'https://github.com/SlopDotCash/slopdotcash/actions/runs/' + status[1] + '/job/1'}]);
}
const run = /^repos\/SlopDotCash\/slopdotcash\/actions\/runs\/(\d+)$/.exec(path);
if (run) {
  if (!creators[run[1]]) response(404, {});
  response(200, creators[run[1]]);
}
if (!/^repos\/SlopDotCash\/slopdotcash\/deployments\?environment=slop-staging&per_page=100&page=\d+$/.test(path)) process.exit(2);
fs.appendFileSync(process.env.HISTORY_CALLS, path+'\n');
const pages = JSON.parse(fs.readFileSync(process.env.HISTORY_PATH,'utf8'));
response(200, pages[Number(path.split('page=').pop())-1] ?? []);
`;
  if (process.platform === "win32") {
    // execFileSync needs a native executable on Windows. The pinned test
    // runtime executes the local `api` script for `gh api <path>`.
    copyFileSync(process.execPath, join(bin, "gh.exe"));
    writeFileSync(join(checkout, "api"), stub);
  } else {
    writeFileSync(join(bin, "gh"), `#!${process.execPath}\n${stub}`);
    chmodSync(join(bin, "gh"), 0o755);
  }
  const deployment = (sha: string, id?: number) => ({
    ...(id === undefined ? {} : { id }),
    sha,
    environment: "slop-staging",
    ref: "development",
    production_environment: false,
  });
  const run = (
    pages: unknown[],
    extra: Record<string, string> = {},
    creators: Record<number, { head_sha: string; path: string }> = {},
  ) => {
    writeFileSync(historyPath, JSON.stringify(pages));
    writeFileSync(requestsPath, "");
    writeFileSync(creatorsPath, JSON.stringify(creators));
    return spawnSync(
      process.execPath,
      [resolve("scripts/check-staging-order.mjs")],
      {
        cwd: checkout,
        encoding: "utf8",
        env: {
          PATH: `${bin}${delimiter}${process.env.PATH}`,
          GIT_CONFIG_NOSYSTEM: "1",
          GITHUB_REPOSITORY: "SlopDotCash/slopdotcash",
          GITHUB_REF: "refs/heads/development",
          GITHUB_SHA: revisions[1],
          HISTORY_PATH: historyPath,
          HISTORY_CALLS: callsPath,
          REST_CALLS: requestsPath,
          FIXTURE_ORIGIN: remote,
          STAGING_ORDER_RETRY_UNTIL: String(
            Math.floor(Date.now() / 1000) + 120,
          ),
          CREATORS_PATH: creatorsPath,
          ...extra,
        },
      },
    );
  };
  const requestRecords = () =>
    readFileSync(requestsPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { path: string; requestedAt: number });

  return {
    git,
    remote,
    checkout,
    revisions,
    divergent,
    deployment,
    run,
    callsPath,
    requests: () => requestRecords().map(({ path }) => path),
    requestTimes: () => requestRecords().map(({ requestedAt }) => requestedAt),
  };
}

test("a verified ancestor can progress while development advances; old guard rejects it", () => {
  const f = fixture();
  const live = f
    .git(f.checkout, "ls-remote", "--refs", "origin", "refs/heads/development")
    .split(/\s/)[0];
  expect(live === f.revisions[1]).toBe(false);
  const result = f.run([
    [f.deployment(f.revisions[1]), f.deployment(f.revisions[0])],
  ]);
  expect(result.status).toBe(0);
});

test("a newer attempted deployment prevents rollback regardless of success", () => {
  const f = fixture();
  const result = f.run([[f.deployment(f.revisions[2])]]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Refusing staging rollback");
});

test.each([
  ".github/workflows/vetting-recovery-qualification.yml",
  ".github/workflows/vetting-sandbox-qualification.yml",
  ".github/workflows/vetting-controller.yml",
])("a newer %s record does not block an older release", (path) => {
  const f = fixture();
  const qualification = {
    head_sha: f.revisions[2],
    path,
  };
  const result = f.run(
    [[f.deployment(f.revisions[2], 7), f.deployment(f.revisions[1])]],
    {},
    { 7: qualification },
  );
  expect(result.status).toBe(0);
  // A release of that same revision still prevents rollback.
  const release = f.run(
    [
      [
        f.deployment(f.revisions[2], 7),
        f.deployment(f.revisions[2], 8),
        f.deployment(f.revisions[1]),
      ],
    ],
    {},
    {
      7: qualification,
      8: { head_sha: f.revisions[2], path: ".github/workflows/deploy.yml" },
    },
  );
  expect(release.status).not.toBe(0);
  expect(release.stderr).toContain("Refusing staging rollback");
  // A workflow name cannot exempt a record bound to another source revision.
  const mismatched = f.run(
    [[f.deployment(f.revisions[2], 7), f.deployment(f.revisions[1])]],
    {},
    { 7: { ...qualification, head_sha: f.revisions[0] } },
  );
  expect(mismatched.status).not.toBe(0);
  expect(mismatched.stderr).toContain("Refusing staging rollback");
});

test("a divergent deployment prevents overwriting unknown staging state", () => {
  const f = fixture();
  expect(f.run([[f.deployment(f.divergent)]]).status).not.toBe(0);
});

test("a force-pushed development branch cannot authorize an abandoned candidate", () => {
  const f = fixture();
  f.git(f.remote, "branch", "-f", "development", f.divergent);
  expect(f.run([[]]).status).not.toBe(0);
});

test("history pagination cannot hide a newer attempt on the second page", () => {
  const f = fixture();
  const first = Array.from({ length: 100 }, () => f.deployment(f.revisions[0]));
  expect(f.run([first, [f.deployment(f.revisions[2])]]).status).not.toBe(0);
  expect(readFileSync(f.callsPath, "utf8").trim().split("\n")).toHaveLength(2);
});

test("unavailable, malformed or unknown deployment provenance fails closed", () => {
  const f = fixture();
  expect(f.run([[]], { FAIL_HISTORY: "1" }).status).not.toBe(0);
  expect(f.run([{}]).status).not.toBe(0);
  expect(f.run([[]]).status).not.toBe(0);
  expect(
    f.run([[{ ...f.deployment(f.revisions[0]), sha: "unknown" }]]).status,
  ).not.toBe(0);
  expect(
    f.run([[{ ...f.deployment(f.revisions[0]), environment: "production" }]])
      .status,
  ).not.toBe(0);
});

test("installation HTTP 403 waits for reset before a fresh history read", () => {
  const f = fixture();
  const result = f.run([[f.deployment(f.revisions[1])]], {
    QUOTA_FIXTURE: JSON.stringify({
      requests: [1],
      http: 403,
      headers: { "X-Ratelimit-Remaining": "0" },
      resetInSeconds: 1,
    }),
  });
  expect(result.status).toBe(0);
  const [refusedAt, replayedAt] = f.requestTimes();
  const resetWithMargin = (Math.floor(refusedAt / 1_000) + 2) * 1_000;
  expect(replayedAt).toBeGreaterThanOrEqual(resetWithMargin);
  expect(result.stdout).toContain("retrying the full order check");
  expect(f.requests()).toHaveLength(2);
  expect(f.requests()[0]).toBe(f.requests()[1]);
});

test("a force push during quota recovery still refuses the abandoned candidate", () => {
  const f = fixture();
  const result = f.run([[f.deployment(f.revisions[1])]], {
    QUOTA_FIXTURE: JSON.stringify({
      requests: [1],
      http: 429,
      headers: { "Retry-After": "0" },
      forceOrigin: f.divergent,
    }),
  });
  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain("retrying the full order check");
  expect(result.stdout).not.toContain("Staging order verified");
  expect(f.requests()).toHaveLength(1);
});

test.each([2, 3])(
  "quota at creator request %s discards earlier observations and checks fresh provenance",
  (request) => {
    const f = fixture();
    const result = f.run(
      [[f.deployment(f.revisions[2], 7), f.deployment(f.revisions[1])]],
      {
        QUOTA_FIXTURE: JSON.stringify({
          requests: [request],
          http: 429,
          headers: { "Retry-After": "0" },
          nextPages: [
            [{ ...f.deployment(f.revisions[1]), production_environment: true }],
          ],
        }),
      },
      {
        7: {
          head_sha: f.revisions[2],
          path: ".github/workflows/vetting-controller.yml",
        },
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unknown staging deployment provenance");
    expect(f.requests()).toHaveLength(request + 1);
    expect(f.requests().at(-1)).toBe(f.requests()[0]);
  },
);

test.each([
  { http: 401, headers: { "Retry-After": "0" } },
  { http: 403, headers: {} },
  {
    http: 403,
    headers: { "X-Ratelimit-Remaining": "0", "X-Ratelimit-Reset": "invalid" },
  },
  { http: 403, headers: { "X-Ratelimit-Remaining": "0" }, resetInSeconds: -10 },
])("nonretryable or unverified GitHub refusal does not retry (%j)", (quota) => {
  const f = fixture();
  const result = f.run([[f.deployment(f.revisions[1])]], {
    QUOTA_FIXTURE: JSON.stringify({ requests: [1], ...quota }),
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(`HTTP ${quota.http}`);
  expect(result.stdout).not.toContain("retrying the full order check");
  expect(f.requests()).toHaveLength(1);
});

test.each([
  { seconds: "180", jobHeadroomSeconds: 300 },
  { seconds: "60", jobHeadroomSeconds: 30 },
])(
  "quota reset beyond shared retry or job headroom budget is refused (%j)",
  ({ seconds, jobHeadroomSeconds }) => {
    const f = fixture();
    const result = f.run([[f.deployment(f.revisions[1])]], {
      STAGING_ORDER_RETRY_UNTIL: String(
        Math.floor(Date.now() / 1000) + jobHeadroomSeconds,
      ),
      QUOTA_FIXTURE: JSON.stringify({
        requests: [1],
        http: 403,
        resetInSeconds: 1,
        headers: { "X-Ratelimit-Remaining": "0", "Retry-After": seconds },
      }),
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(
      /outside the staging order retry budget \(retry at epoch seconds \d+\)/u,
    );
    expect(f.requests()).toHaveLength(1);
  },
);

test("a second quota refusal does not retry again", () => {
  const f = fixture();
  const result = f.run([[f.deployment(f.revisions[1])]], {
    QUOTA_FIXTURE: JSON.stringify({
      requests: [1, 2],
      http: 429,
      headers: { "Retry-After": "0" },
    }),
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(
    "GitHub staging deployment history quota exhausted",
  );
  expect(f.requests()).toHaveLength(2);
});

test("history beyond the bound fails rather than trusting an incomplete scan", () => {
  const f = fixture();
  const page = Array.from({ length: 100 }, () => f.deployment(f.revisions[0]));
  const result = f.run(Array.from({ length: 10 }, () => page));
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("history exceeds its bound");
});

test("wrong checkout, repository or branch cannot reach the staging gate", () => {
  const f = fixture();
  expect(f.run([[]], { GITHUB_SHA: f.revisions[2] }).status).not.toBe(0);
  expect(f.run([[]], { GITHUB_REPOSITORY: "someone/fork" }).status).not.toBe(0);
  expect(f.run([[]], { GITHUB_REF: "refs/heads/main" }).status).not.toBe(0);
});
