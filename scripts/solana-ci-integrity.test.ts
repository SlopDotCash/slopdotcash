import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repository = resolve(import.meta.dir, "..");

function executable(path: string, contents: string) {
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${contents}`);
  chmodSync(path, 0o755);
}

function auditFixture(report: unknown, mutate?: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "slop-solana-audit-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "contracts/solana"), { recursive: true });
  cpSync(
    join(repository, "scripts/audit-solana-dependencies.mjs"),
    join(root, "scripts/audit-solana-dependencies.mjs"),
  );
  cpSync(
    join(repository, "contracts/solana/package-lock.json"),
    join(root, "contracts/solana/package-lock.json"),
  );
  executable(
    join(bin, "npm"),
    `printf '%s' ${JSON.stringify(JSON.stringify(report))}\nexit 1\n`,
  );
  mutate?.(root);
  const result = spawnSync(
    "node",
    [join(root, "scripts/audit-solana-dependencies.mjs")],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    },
  );
  rmSync(root, { recursive: true, force: true });
  return result;
}

const validAudit = {
  auditReportVersion: 2,
  metadata: {
    vulnerabilities: {
      info: 0,
      low: 0,
      moderate: 0,
      high: 1,
      critical: 0,
      total: 1,
    },
    dependencies: {
      prod: 1,
      dev: 0,
      optional: 0,
      peer: 0,
      peerOptional: 0,
      total: 1,
    },
  },
  vulnerabilities: {
    toml: {
      name: "toml",
      severity: "high",
      isDirect: false,
      via: [
        {
          source: 1164824,
          name: "toml",
          dependency: "toml",
          title: "toml-node: Uncontrolled Recursion",
          url: "https://github.com/advisories/GHSA-82x6-q7mm-w9cf",
          severity: "high",
          range: "<4.2.0",
        },
      ],
      effects: ["@coral-xyz/anchor"],
      range: "<=5.0.0",
      nodes: ["node_modules/toml"],
      fixAvailable: false,
    },
  },
};

function mutableAudit() {
  return structuredClone(validAudit) as unknown as {
    metadata: typeof validAudit.metadata;
    vulnerabilities: Record<
      string,
      { name: string; severity: string; via: unknown[]; [key: string]: unknown }
    >;
  };
}

test("the Solana bootstrap refuses a checksum mismatch before extraction", () => {
  const root = mkdtempSync(join(tmpdir(), "slop-solana-bootstrap-"));
  const bin = join(root, "bin");
  const runnerTemp = join(root, "runner");
  mkdirSync(bin);
  mkdirSync(runnerTemp);
  const tarMarker = join(root, "tar-was-invoked");

  executable(join(bin, "sudo"), "exit 0\n");
  executable(
    join(bin, "curl"),
    'output=""\nwhile (($#)); do\n  if [[ "$1" == "--output" ]]; then output="$2"; shift 2; else shift; fi\ndone\ntruncate -s 298782636 "$output"\n',
  );
  executable(join(bin, "tar"), `touch ${JSON.stringify(tarMarker)}\nexit 99\n`);

  const result = spawnSync(
    "bash",
    [join(repository, "contracts/solana/scripts/bootstrap-linux.sh")],
    {
      cwd: repository,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_ENV: join(root, "github-env"),
        GITHUB_PATH: join(root, "github-path"),
        PATH: `${bin}:${process.env.PATH}`,
        RUNNER_TEMP: runnerTemp,
      },
    },
  );

  try {
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("checksum");
    expect(() => readFileSync(tarMarker)).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the Solana workflow invokes the nested lockfile audit gate", () => {
  const workflow = readFileSync(
    join(repository, ".github/workflows/escrow-tests.yml"),
    "utf8",
  );
  expect(workflow).toContain("node scripts/audit-solana-dependencies.mjs");
});

test("the Solana audit rejects a registry error report", () => {
  const result = auditFixture({
    error: { code: "E503", summary: "registry unavailable" },
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("error report");
});

test("the Solana audit rejects a report without the required schema", () => {
  const result = auditFixture({ auditReportVersion: 2, vulnerabilities: {} });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("schema");
});

test("the Solana audit rejects malformed advisory data", () => {
  const report = structuredClone(validAudit);
  report.vulnerabilities.toml.via[0].range = 42 as unknown as string;
  const result = auditFixture(report);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("malformed advisory");
});

test("the Solana audit rejects metadata counts above the vulnerability map", () => {
  const report = structuredClone(validAudit);
  report.vulnerabilities = {} as typeof validAudit.vulnerabilities;
  const result = auditFixture(report);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("vulnerability counts do not match");
});

test("the Solana audit rejects vulnerability map counts above metadata", () => {
  const report = structuredClone(validAudit);
  report.metadata.vulnerabilities.high = 0;
  report.metadata.vulnerabilities.total = 0;
  const result = auditFixture(report);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("vulnerability counts do not match");
});

test("the Solana audit rejects package severity that disagrees with its advisories", () => {
  const report = structuredClone(validAudit);
  report.vulnerabilities.toml.severity = "moderate";
  report.metadata.vulnerabilities.high = 0;
  report.metadata.vulnerabilities.moderate = 1;
  const result = auditFixture(report);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("severity does not match");
});

test("the Solana audit rejects a self-referencing vulnerability", () => {
  const report = mutableAudit();
  report.vulnerabilities.toml.via = ["toml"];
  const result = auditFixture(report);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("cyclic vulnerability reference");
});

test("the Solana audit rejects a two-node vulnerability cycle", () => {
  const report = mutableAudit();
  report.vulnerabilities.toml.via = ["anchor"];
  report.vulnerabilities.anchor = {
    name: "anchor",
    severity: "high",
    via: ["toml"],
  };
  report.metadata.vulnerabilities.high = 2;
  report.metadata.vulnerabilities.total = 2;
  const result = auditFixture(report);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("cyclic vulnerability reference");
});

test("the Solana audit rejects a longer advisory-free cycle", () => {
  const report = mutableAudit();
  report.vulnerabilities.toml.via = ["anchor"];
  report.vulnerabilities.anchor = {
    name: "anchor",
    severity: "high",
    via: ["solana-program"],
  };
  report.vulnerabilities["solana-program"] = {
    name: "solana-program",
    severity: "high",
    via: ["toml"],
  };
  report.metadata.vulnerabilities.high = 3;
  report.metadata.vulnerabilities.total = 3;
  const result = auditFixture(report);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("cyclic vulnerability reference");
});

test("the Solana audit accepts a valid acyclic transitive advisory chain", () => {
  const report = mutableAudit();
  report.vulnerabilities.anchor = {
    name: "anchor",
    severity: "high",
    via: ["toml"],
  };
  report.metadata.vulnerabilities.high = 2;
  report.metadata.vulnerabilities.total = 2;
  const result = auditFixture(report);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("Solana npm audit passed");
});

test("the Solana audit rejects malformed vulnerability counts", () => {
  for (const malformed of [-1, 1.5, "1", null]) {
    const report = structuredClone(validAudit);
    report.metadata.vulnerabilities.high = malformed as unknown as number;
    const result = auditFixture(report);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("malformed metadata counts");
  }
});

test("the Solana audit accepts a canonical GitHub advisory URL", () => {
  const result = auditFixture(validAudit);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("Solana npm audit passed");
});

test("the Solana audit rejects non-canonical advisory URLs", () => {
  const nonCanonicalUrls = [
    "https://github.com:443/advisories/GHSA-82x6-q7mm-w9cf",
    "https://github.com/attacker/GHSA-82x6-q7mm-w9cf",
    "https://user:password@github.com/advisories/GHSA-82x6-q7mm-w9cf",
    "https://github.com%2f@evil.example/advisories/GHSA-82x6-q7mm-w9cf",
    "https://github.com/advisories%2fGHSA-82x6-q7mm-w9cf",
    "https://github.com/advisories/GHSA-82x6-q7mm-w9cf?forged=true",
    "https://github.com/advisories/GHSA-82x6-q7mm-w9cf#forged",
    "https://GITHUB.COM/advisories/GHSA-82x6-q7mm-w9cf",
    "https://example.com/advisories/GHSA-82x6-q7mm-w9cf",
    "https://github.com/security/advisories/GHSA-82x6-q7mm-w9cf",
  ];

  for (const url of nonCanonicalUrls) {
    const report = structuredClone(validAudit);
    report.vulnerabilities.toml.via[0].url = url;
    const result = auditFixture(report);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("advisory URL");
  }
});

test("the Solana audit rejects allowlisted affected-range drift", () => {
  const report = structuredClone(validAudit);
  report.vulnerabilities.toml.via[0].range = "<4.3.0";
  const result = auditFixture(report);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("affected range");
});

test("the Solana audit rejects an invalid advisory exception expiry", () => {
  const result = auditFixture(validAudit, (root) => {
    const script = join(root, "scripts/audit-solana-dependencies.mjs");
    const contents = readFileSync(script, "utf8").replace(
      /expiresAt: "[^"]+"/u,
      'expiresAt: "not-a-utc-timestamp"',
    );
    writeFileSync(script, contents);
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("invalid UTC expiry");
});

test("the Solana audit rejects an expired advisory exception", () => {
  const result = auditFixture(validAudit, (root) => {
    const script = join(root, "scripts/audit-solana-dependencies.mjs");
    const contents = readFileSync(script, "utf8").replace(
      /expiresAt: "[^"]+"/u,
      'expiresAt: "2000-01-01T00:00:00Z"',
    );
    writeFileSync(script, contents);
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("expired");
});

test("the Solana audit rejects allowlisted package version drift", () => {
  const result = auditFixture(validAudit, (root) => {
    const lock = join(root, "contracts/solana/package-lock.json");
    const contents = readFileSync(lock, "utf8").replace(
      '"node_modules/toml": {\n      "version": "3.0.0"',
      '"node_modules/toml": {\n      "version": "3.0.1"',
    );
    writeFileSync(lock, contents);
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("locked version");
});
