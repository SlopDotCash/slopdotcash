// The staging release gates: deployment order (real Git and a stub `gh`), the
// published root's availability and security headers, and the checked-in
// staging payment configuration.
import { afterEach, expect, setDefaultTimeout, spyOn, test } from "bun:test";
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
import { onRequest } from "../functions/api/v1/[[path]]";
import { ESCROW_NETWORKS } from "../src/lib/escrow-policy.mjs";
import { parsePaymentNetworks } from "../workers/payments/deployments";
import { verifyStagingRoot } from "./verify-staging-root.mjs";

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
  const stub = `const fs=require('node:fs');\nif(process.env.FAIL_HISTORY)process.exit(1);\nconst path=process.argv.at(-1);\nconst creators=JSON.parse(fs.readFileSync(process.env.CREATORS_PATH,'utf8'));\nconst status=/^repos\\/SlopDotCash\\/slopdotcash\\/deployments\\/(\\d+)\\/statuses\\?per_page=100$/.exec(path);\nif(status){const c=creators[status[1]];if(!c)process.exit(3);process.stdout.write(JSON.stringify([{log_url:'https://github.com/SlopDotCash/slopdotcash/actions/runs/'+status[1]+'/job/1'}]));process.exit(0);}\nconst run=/^repos\\/SlopDotCash\\/slopdotcash\\/actions\\/runs\\/(\\d+)$/.exec(path);\nif(run){const c=creators[run[1]];if(!c)process.exit(3);process.stdout.write(JSON.stringify(c));process.exit(0);}\nif(!/^repos\\/SlopDotCash\\/slopdotcash\\/deployments\\?environment=slop-staging&per_page=100&page=\\d+$/.test(path))process.exit(2);\nfs.appendFileSync(process.env.HISTORY_CALLS,path+'\\n');\nconst pages=JSON.parse(fs.readFileSync(process.env.HISTORY_PATH,'utf8'));\nprocess.stdout.write(JSON.stringify(pages[Number(path.split('page=').pop())-1]??[]));\n`;
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
          CREATORS_PATH: creatorsPath,
          ...extra,
        },
      },
    );
  };
  return {
    git,
    remote,
    checkout,
    revisions,
    divergent,
    deployment,
    run,
    callsPath,
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
  expect(result.stdout).toContain("Staging order verified");
});

test("a newer attempted deployment prevents rollback regardless of success", () => {
  const f = fixture();
  const result = f.run([[f.deployment(f.revisions[2])]]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Refusing staging rollback");
});

test("a newer qualification-only deployment does not block an older release", () => {
  const f = fixture();
  const qualification = {
    head_sha: f.revisions[2],
    path: ".github/workflows/vetting-recovery-qualification.yml",
  };
  const result = f.run(
    [[f.deployment(f.revisions[2], 7), f.deployment(f.revisions[1])]],
    {},
    { 7: qualification },
  );
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("Ignoring qualification-only");
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

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const headers = {
  "content-security-policy": "default-src 'self'",
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
};

test("transient deployment propagation must recover to 200 with every header", async () => {
  let reads = 0;
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (
        _url: Parameters<typeof fetch>[0],
        options?: Parameters<typeof fetch>[1],
      ) => {
        expect(options?.redirect).toBe("manual");
        expect(options?.cache).toBe("no-store");
        return new Response(
          null,
          ++reads === 1 ? { status: 503 } : { status: 200, headers },
        );
      },
      { preconnect: originalFetch.preconnect },
    ),
  );
  await verifyStagingRoot("https://staging.slop.cash", 0);
  expect(reads).toBe(2);
});

test("transport failure can recover but never becomes empty success", async () => {
  let reads = 0;
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async () => {
        if (++reads === 1) throw new TypeError("synthetic connection reset");
        return new Response(null, { status: 200, headers });
      },
      { preconnect: originalFetch.preconnect },
    ),
  );
  await verifyStagingRoot("https://staging.slop.cash", 0);
  expect(reads).toBe(2);
});

test("permanent 404 and redirects fail immediately with status and origin", async () => {
  for (const status of [404, 302]) {
    let reads = 0;
    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async () => {
          reads++;
          return new Response(null, { status });
        },
        { preconnect: originalFetch.preconnect },
      ),
    );
    await expect(
      verifyStagingRoot("https://staging.slop.cash", 0),
    ).rejects.toThrow(`https://staging.slop.cash returned HTTP ${status}`);
    expect(reads).toBe(1);
  }
});

test("a 200 without security headers never qualifies, even after a transient read", async () => {
  let reads = 0;
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async () =>
        new Response(null, ++reads === 1 ? { status: 502 } : { status: 200 }),
      { preconnect: originalFetch.preconnect },
    ),
  );
  await expect(
    verifyStagingRoot("https://staging.slop.cash", 0),
  ).rejects.toThrow("omitted content-security-policy");
  expect(reads).toBe(2);
});

test("persistent unavailability exhausts the bound and rejects", async () => {
  let reads = 0;
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async () => {
        reads++;
        return new Response(null, { status: 503 });
      },
      { preconnect: originalFetch.preconnect },
    ),
  );
  await expect(
    verifyStagingRoot("https://staging.slop.cash", 0),
  ).rejects.toThrow("retry bound");
  expect(reads).toBe(6);
});

test("every required security header remains mandatory", async () => {
  for (const header of Object.keys(headers)) {
    const missing = new Headers(headers);
    missing.delete(header);
    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async () => new Response(null, { status: 200, headers: missing }),
        {
          preconnect: originalFetch.preconnect,
        },
      ),
    );
    await expect(
      verifyStagingRoot("https://staging.slop.cash", 0),
    ).rejects.toThrow(`omitted ${header}`);
  }
});

test("the checked-in staging configuration reaches payment authentication", async () => {
  const configuration = Bun.TOML.parse(
    readFileSync("wrangler.staging.toml", "utf8"),
  );
  // Anonymous payment requests must stop at authentication, before using bindings.
  const env = (
    configuration as { vars: Parameters<typeof onRequest>[0]["env"] }
  ).vars;
  const response = await onRequest({
    request: new Request("https://staging.slop.cash/api/v1/payments/me"),
    env,
  });
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "not_signed_in" });

  const crossOrigin = await onRequest({
    request: new Request(
      "https://staging.slop.cash/api/v1/payments/wallets/register",
      {
        method: "POST",
        headers: {
          Origin: "https://slop.cash",
          "Content-Type": "application/json",
        },
        body: "{}",
      },
    ),
    env,
  });
  expect(crossOrigin.status).toBe(403);
  expect(await crossOrigin.json()).toEqual({ error: "origin_forbidden" });
});

test("staging serves registry test networks only", () => {
  const { vars } = Bun.TOML.parse(
    readFileSync("wrangler.staging.toml", "utf8"),
  ) as { vars: { PAYMENT_NETWORKS: string } };
  // The Pages API parser refuses an empty, unknown or repeated name.
  for (const network of parsePaymentNetworks(vars.PAYMENT_NETWORKS))
    expect(ESCROW_NETWORKS[network].testnet).toBe(true);
});
