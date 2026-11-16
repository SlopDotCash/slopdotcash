import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  type FormalReportExpectation,
  formalAdapterOverlaySha256,
  formalReportProblems,
  formalStageArguments,
  formalTimedOut,
  formalTimeoutMs,
  formalToolPaths,
} from "./formal-report.mjs";
import { patchTlcConfig } from "./quint-safety-view.mjs";

const root = resolve(import.meta.dirname, "..");
const hash = (text: string | Buffer) =>
  createHash("sha256").update(text).digest("hex");
const model = "formal/models/fixture/report_fixture.qnt";
const producerRoot = "/home/runner/work/slopdotcash/slopdotcash";
type Row = {
  model: string;
  sha256: string;
  sources: Record<string, string>;
  command: string[];
  passed: boolean;
  exitCode: number | null;
  error: string | null;
  output: string;
  timeoutMs: number;
  durationMs: number;
  finiteTransition: Record<string, unknown>;
  requestedSafetyView: string | null;
  safetyView: Record<string, unknown> | null;
};
type Report = {
  schemaVersion: number;
  canceled: boolean;
  inputsUnchanged: boolean;
  toolHashes: Record<string, string>;
  mode: string;
  translation: string;
  quintVersion: string;
  javaVersion: string | null;
  results: Row[];
};

function fixture(verify = false) {
  const expected: FormalReportExpectation = {
    checkoutRoot: producerRoot,
    model,
    sha256: hash("model"),
    sources: { "implementation.ts": hash("source") },
    toolHashes: Object.fromEntries(
      formalToolPaths(verify).map((path) => [path, hash(path)]),
    ),
    verify,
    commands: formalStageArguments(model, verify, null),
    finiteTransition: { step: "step", kind: "concrete" },
    safetyView: null,
    quintVersion: "0.33.1",
    timeoutMs: formalTimeoutMs(model, verify),
  };
  const report: Report = {
    schemaVersion: 1,
    canceled: false,
    inputsUnchanged: true,
    toolHashes: { ...expected.toolHashes },
    mode: verify
      ? "exhaustive-finite-tlc"
      : "types-scenarios-seeded-simulation",
    translation: verify ? "local-apalache-cli" : "not-used",
    quintVersion: "0.33.1",
    javaVersion: verify ? 'openjdk version "21.0.13" 2026-10-20 LTS' : null,
    results: expected.commands.map((args) => ({
      model,
      sha256: expected.sha256,
      sources: { ...expected.sources },
      command: verify
        ? [
            "/opt/hostedtoolcache/node/24.15.0/x64/bin/node",
            "--import",
            `${producerRoot}/scripts/quint-local-translator.mjs`,
            `${producerRoot}/node_modules/.bin/quint`,
            ...args,
          ]
        : [`${producerRoot}/node_modules/.bin/quint`, ...args],
      passed: true,
      exitCode: 0,
      error: null,
      output: "",
      timeoutMs: expected.timeoutMs,
      durationMs: 10,
      finiteTransition: { ...expected.finiteTransition },
      requestedSafetyView: null,
      safetyView: null,
    })),
  };
  return { report, expected };
}

test("canonical commands keep all original scenario, seed, sample, step and invariant settings", () => {
  expect(formalStageArguments(model, false, null)).toEqual([
    ["typecheck", model],
    [
      "test",
      model,
      "--backend=typescript",
      "--seed=20261107",
      "--max-samples=100",
    ],
    [
      "run",
      model,
      "--backend=typescript",
      "--seed=20261107",
      "--max-samples=500",
      "--max-steps=60",
      "--invariant=invariant",
    ],
  ]);
  expect(
    formalStageArguments(model, true, { step: "verificationStep" }, [
      "progressProperty",
    ]),
  ).toEqual([
    [
      "verify",
      model,
      "--backend=tlc",
      "--verbosity=3",
      "--tlc-config=formal/tlc.json",
      "--invariant=invariant",
      "--step=verificationStep",
      "--temporal=progressProperty",
    ],
  ]);
  expect(formalTimeoutMs(model, false)).toBe(90000);
  expect(formalTimeoutMs(model, true)).toBe(180000);
  expect(formalTimeoutMs("formal/models/ui/ui_cycle_archive.qnt", true)).toBe(
    3600000,
  );
  expect(
    formalTimeoutMs("formal/models/payments/solana_binding_api.qnt", true),
  ).toBe(1200000);
  expect(
    formalTimeoutMs("formal/models/ui/solana_wallet_provider.qnt", true),
  ).toBe(600000);
});

test("a verification that ran its whole allowance is a timeout, not a failure, only when allowed", () => {
  const { report, expected } = fixture(true);
  const [result] = report.results;
  Object.assign(result, {
    passed: false,
    exitCode: 1,
    error: null,
    durationMs: expected.timeoutMs + 5,
  });
  expect(formalTimedOut(result)).toBe(true);
  expect(formalReportProblems(report, expected)).toEqual([
    "stage 1: failed or incomplete result",
  ]);
  expect(
    formalReportProblems(report, expected, { allowTimeout: true }),
  ).toEqual([]);
  // Every other evidence check still applies to a timed-out stage.
  result.sha256 = hash("wrong");
  expect(
    formalReportProblems(report, expected, { allowTimeout: true }),
  ).toEqual(["stage 1: wrong model or digest"]);
});

for (const [name, change] of [
  ["a counterexample before the deadline", { durationMs: 1000 }],
  ["a recorded error", { error: "Verifier exceeded 8MiB output limit" }],
  ["a passing exit status", { exitCode: 0 }],
] as const) {
  test(`${name} is never treated as a timeout`, () => {
    const { report, expected } = fixture(true);
    Object.assign(report.results[0], {
      passed: false,
      exitCode: 1,
      error: null,
      durationMs: expected.timeoutMs + 5,
      ...change,
    });
    expect(formalTimedOut(report.results[0])).toBe(false);
    expect(
      formalReportProblems(report, expected, { allowTimeout: true }),
    ).toEqual(["stage 1: failed or incomplete result"]);
  });
}

test("ordinary scenario checks never accept a timeout", () => {
  const { report, expected } = fixture(false);
  Object.assign(report.results[0], {
    passed: false,
    exitCode: 1,
    error: null,
    durationMs: expected.timeoutMs + 5,
  });
  expect(
    formalReportProblems(report, expected, { allowTimeout: true }),
  ).toContain("stage 1: failed or incomplete result");
});

for (const verify of [false, true]) {
  test(`accepts the ${verify ? "verification" : "ordinary"} producer schema and hosted paths`, () => {
    const { report, expected } = fixture(verify);
    expect(formalReportProblems(report, expected)).toEqual([]);
    report.toolHashes = Object.fromEntries(
      Object.entries(report.toolHashes).reverse(),
    );
    if (verify) report.results[0].command[0] = "/usr/local/bin/node";
    expect(formalReportProblems(report, expected)).toEqual([]);
  });
  for (const [name, mutate] of [
    ["missing tools", (r: Report) => delete (r as Partial<Report>).toolHashes],
    [
      "empty tools",
      (r: Report) => {
        r.toolHashes = {};
      },
    ],
    [
      "missing one tool",
      (r: Report) => {
        delete r.toolHashes[Object.keys(r.toolHashes)[0]];
      },
    ],
    [
      "extra tool",
      (r: Report) => {
        r.toolHashes["unreviewed.mjs"] = hash("extra");
      },
    ],
    [
      "changed tool digest",
      (r: Report) => {
        r.toolHashes[Object.keys(r.toolHashes)[0]] = hash("wrong");
      },
    ],
    [
      "missing source",
      (r: Report) => {
        r.results[0].sources = {};
      },
    ],
    [
      "extra source",
      (r: Report) => {
        r.results[0].sources["extra.ts"] = hash("extra");
      },
    ],
    [
      "wrong source",
      (r: Report) => {
        r.results[0].sources["implementation.ts"] = hash("wrong");
      },
    ],
    [
      "failed row marked passed",
      (r: Report) => {
        r.results[0].exitCode = 1;
      },
    ],
    [
      "null exit status",
      (r: Report) => {
        r.results[0].exitCode = null;
      },
    ],
    [
      "missing error status",
      (r: Report) => delete (r.results[0] as Partial<Row>).error,
    ],
    [
      "retained error",
      (r: Report) => {
        r.results[0].error = "cleanup did not finish";
      },
    ],
    [
      "failed passed flag",
      (r: Report) => {
        r.results[0].passed = false;
      },
    ],
    [
      "canceled",
      (r: Report) => {
        r.canceled = true;
      },
    ],
    [
      "unstable inputs",
      (r: Report) => {
        r.inputsUnchanged = false;
      },
    ],
    [
      "wrong schema",
      (r: Report) => {
        r.schemaVersion = 2;
      },
    ],
    [
      "wrong mode",
      (r: Report) => {
        r.mode = "not model checking";
      },
    ],
    [
      "wrong translation",
      (r: Report) => {
        r.translation = "none";
      },
    ],
    [
      "wrong Quint",
      (r: Report) => {
        r.quintVersion = "0.0.0";
      },
    ],
    [
      "wrong Java",
      (r: Report) => {
        r.javaVersion = verify ? 'openjdk version "17.0.1"' : "unexpected";
      },
    ],
    [
      "wrong model",
      (r: Report) => {
        r.results[0].model = "other.qnt";
      },
    ],
    [
      "wrong model digest",
      (r: Report) => {
        r.results[0].sha256 = hash("other");
      },
    ],
    [
      "missing stage",
      (r: Report) => {
        r.results.pop();
      },
    ],
    [
      "extra stage",
      (r: Report) => {
        r.results.push(structuredClone(r.results[0]));
      },
    ],
    [
      "wrong command",
      (r: Report) => {
        r.results[0].command = ["false"];
      },
    ],
    [
      "relative executable",
      (r: Report) => {
        r.results[0].command[verify ? 3 : 0] = "node_modules/.bin/quint";
      },
    ],
    [
      "extra property",
      (r: Report) => {
        r.results[0].command.push("--invariant=weaker");
      },
    ],
    [
      "wrong timeout",
      (r: Report) => {
        r.results[0].timeoutMs++;
      },
    ],
    [
      "invalid duration",
      (r: Report) => {
        r.results[0].durationMs = -1;
      },
    ],
    [
      "missing output",
      (r: Report) => delete (r.results[0] as Partial<Row>).output,
    ],
    [
      "wrong transition",
      (r: Report) => {
        r.results[0].finiteTransition = { step: "other", kind: "concrete" };
      },
    ],
    [
      "unexpected requested view",
      (r: Report) => {
        r.results[0].requestedSafetyView = "unreviewed";
      },
    ],
    [
      "unexpected applied view",
      (r: Report) => {
        r.results[0].safetyView = { id: "unreviewed" };
      },
    ],
  ] as const)
    test(`${verify ? "verify" : "check"} refuses ${name}`, () => {
      const { report, expected } = fixture(verify);
      mutate(report);
      expect(formalReportProblems(report, expected).length).toBeGreaterThan(0);
    });
}

for (const [flag, value] of [
  ["--seed=20261107", "--seed=1"],
  ["--max-samples=500", "--max-samples=1"],
  ["--max-steps=60", "--max-steps=1"],
  ["--invariant=invariant", "--invariant=true"],
])
  test(`refuses changed ${flag}`, () => {
    const { report, expected } = fixture();
    const c = report.results[2].command;
    c[c.indexOf(flag)] = value;
    expect(formalReportProblems(report, expected).length).toBeGreaterThan(0);
  });
test("rejects duplicate ordinary stages and stage reordering", () => {
  const { report, expected } = fixture();
  report.results[1] = structuredClone(report.results[0]);
  expect(formalReportProblems(report, expected).length).toBeGreaterThan(0);
  const next = fixture();
  next.report.results.reverse();
  expect(
    formalReportProblems(next.report, next.expected).length,
  ).toBeGreaterThan(0);
});
for (const input of [null, undefined, [], 1, "report"])
  test(`refuses non-object report ${JSON.stringify(input)}`, () => {
    expect(
      formalReportProblems(input, fixture().expected).length,
    ).toBeGreaterThan(0);
  });
test("requires matching translator root and a Node executable role, independent of its producer installation path", () => {
  for (const [index, value] of [
    [0, "/bin/sh"],
    [2, "/other/scripts/quint-local-translator.mjs"],
    [3, "/other/node_modules/.bin/quint"],
  ] as const) {
    const { report, expected } = fixture(true);
    report.results[0].command[index] = value;
    expect(formalReportProblems(report, expected).length).toBeGreaterThan(0);
  }
});

test("abstract steps and temporal properties require the exact producer command and transition receipt", () => {
  const { report, expected } = fixture(true);
  expected.finiteTransition = {
    step: "verificationStep",
    kind: "forward-safety-simulation-delayed-inputs",
    sourceSha256: expected.sha256,
    concreteStep: "step",
  };
  expected.commands = formalStageArguments(
    model,
    true,
    { step: "verificationStep" },
    ["progressProperty"],
  );
  report.results[0].finiteTransition = { ...expected.finiteTransition };
  report.results[0].command.splice(
    4,
    report.results[0].command.length,
    ...expected.commands[0],
  );
  expect(formalReportProblems(report, expected)).toEqual([]);
  for (const flag of [
    "--step=verificationStep",
    "--temporal=progressProperty",
  ]) {
    const changed = structuredClone(report);
    changed.results[0].command = changed.results[0].command.filter(
      (argument) => argument !== flag,
    );
    expect(formalReportProblems(changed, expected).length).toBeGreaterThan(0);
  }
  delete report.results[0].finiteTransition.sourceSha256;
  expect(formalReportProblems(report, expected).length).toBeGreaterThan(0);
});

test("reviewed safety metadata must be complete, exact and accompanied by its requested view", () => {
  const { report, expected } = fixture(true);
  expected.safetyView = {
    id: "reviewed-fixture",
    model,
    sourceSha256: expected.sha256,
    translatedSha256: hash("TLA"),
    operator: "ReviewedFixtureView",
    hashMode: "exact-observations",
    memoryCandidateMode: "reviewed-dead-fields",
    fields: [{ name: "state", expression: "s" }],
    clauses: [],
    viewTlaSha256: hash("viewed TLA"),
    adapterSha256: hash("adapter"),
    overlaySha256: hash("overlay"),
  };
  report.results[0].requestedSafetyView = "reviewed-fixture";
  report.results[0].safetyView = {
    ...expected.safetyView,
    overlaySha256: hash("overlay"),
  };
  expect(formalReportProblems(report, expected)).toEqual([]);
  for (const key of Object.keys(report.results[0].safetyView)) {
    const changed = structuredClone(report);
    delete changed.results[0].safetyView?.[key];
    expect(formalReportProblems(changed, expected).length).toBeGreaterThan(0);
  }
  for (const mutate of [
    (row: Row) => {
      row.requestedSafetyView = null;
    },
    (row: Row) => {
      row.safetyView = null;
    },
    (row: Row) => {
      row.safetyView = {
        ...row.safetyView,
        clauses: [{ name: "weaker", expression: "TRUE" }],
      };
    },
    (row: Row) => {
      row.safetyView = { ...row.safetyView, overlaySha256: "unverified" };
    },
    (row: Row) => {
      row.safetyView = { ...row.safetyView, extra: "unreviewed" };
    },
  ]) {
    const changed = structuredClone(report);
    mutate(changed.results[0]);
    expect(formalReportProblems(changed, expected).length).toBeGreaterThan(0);
  }
});

test("the expected overlay matches the actual pinned official adapter and reviewed VIEW-only patch", () => {
  const require = createRequire(import.meta.url);
  const source = readFileSync(
    require.resolve("@informalsystems/quint/dist/src/tlc.js"),
    "utf8",
  );
  const digest = hash(source);
  expect(formalAdapterOverlaySha256(digest)).toBe(
    hash(patchTlcConfig(source, digest)),
  );
  expect(() => formalAdapterOverlaySha256(hash("unreviewed adapter"))).toThrow(
    "Unreviewed Quint adapter overlay",
  );
});

// Preserve the additional current-root allowances while moving their table.
for (const model of [
  "formal/models/payments/operator_keeper_lifecycle.qnt",
  "formal/models/api/api_trace.qnt",
  "formal/models/ui/ui_private_intake.qnt",
  "formal/models/payments/solana_binding_completion.qnt",
  "formal/models/ui/evm_wallet_discovery.qnt",
  "formal/models/vetting/vetting_generation_storage.qnt",
  "formal/models/vetting/vetting_evidence_registration.qnt",
  "formal/models/vetting/vetting_generation_retirement.qnt",
  "formal/models/api/submission_authorization_wrappers.qnt",
  "formal/models/api/api_submission_recovery.qnt",
  "formal/models/api/wallet_claim_publication.qnt",
  "formal/models/payments/stored_binding_broadcast_authority.qnt",
  "formal/models/payments/evm_binding_consent_api.qnt",
  "formal/models/api/trace_event_finalization.qnt",
  "formal/models/api/api_private_authorization.qnt",
  "formal/models/api/wallet_possession_completion.qnt",
])
  test(`preserves current-root resource allowance for ${model}`, () => {
    expect(formalTimeoutMs(model, true)).toBe(600000);
  });

for (const javaVersion of [
  'openjdk version "21" 2023-09-19',
  'java version "21"',
  'openjdk version "21.0.13"',
])
  test(`accepts producer-compatible Java metadata: ${javaVersion}`, () => {
    const { report, expected } = fixture(true);
    report.javaVersion = javaVersion;
    expect(formalReportProblems(report, expected)).toEqual([]);
  });
for (const javaVersion of ['openjdk version "22"', 'openjdk version "22.0.1"'])
  test(`rejects newer-major Java metadata: ${javaVersion}`, () => {
    const { report, expected } = fixture(true);
    report.javaVersion = javaVersion;
    expect(formalReportProblems(report, expected).length).toBeGreaterThan(0);
  });
for (const verify of [false, true])
  test(`rejects a consistent but wrong ${verify ? "verification" : "ordinary"} checkout`, () => {
    const { report, expected } = fixture(verify);
    for (const row of report.results)
      row.command = row.command.map((argument) =>
        argument.startsWith(`${producerRoot}/`)
          ? argument.replace(producerRoot, "/other/checkout")
          : argument,
      );
    expect(formalReportProblems(report, expected).length).toBeGreaterThan(0);
    expected.checkoutRoot = "/other/checkout";
    expect(formalReportProblems(report, expected)).toEqual([]);
  });

function workflowProgram() {
  const workflow = readFileSync(
    join(root, ".github/workflows/formal.yml"),
    "utf8",
  );
  const start = "          node --input-type=module <<'NODE'\n";
  expect(workflow.split(start)).toHaveLength(2);
  return workflow
    .split(start)[1]
    .split("\n          NODE")[0]
    .split("\n")
    .map((line) => line.slice(10))
    .join("\n");
}
function temporaryRepository() {
  const directory = mkdtempSync(join(tmpdir(), "slop-formal-report-"));
  const files = [...formalToolPaths(true), "package.json"];
  for (const path of files) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), readFileSync(join(root, path)));
  }
  mkdirSync(join(directory, "formal/models/fixture"), { recursive: true });
  writeFileSync(
    join(directory, "implementation.ts"),
    "export const safe = true;\n",
  );
  writeFileSync(
    join(directory, model),
    `// @source implementation.ts
module report_fixture {
  var n: int
  action init = n' = 0
  action step = any { all { n < 1, n' = n + 1 }, n' = n }
  val invariant = n >= 0 and n <= 1
  run boundedTest = init.then(step).expect(invariant)
}
`,
  );
  mkdirSync(join(directory, "reports"));
  return realpathSync(directory);
}
function writeSyntheticReports(directory: string) {
  for (const verify of [false, true]) {
    const { report } = fixture(verify);
    const digest = (path: string) => hash(readFileSync(join(directory, path)));
    report.toolHashes = Object.fromEntries(
      formalToolPaths(verify).map((path) => [path, digest(path)]),
    );
    for (const row of report.results) {
      row.sha256 = digest(model);
      row.command = row.command.map((argument) =>
        argument.startsWith(`${producerRoot}/`)
          ? directory + argument.slice(producerRoot.length)
          : argument,
      );
      row.sources = { "implementation.ts": digest("implementation.ts") };
    }
    writeFileSync(
      join(
        directory,
        "reports",
        `${verify ? "verification" : "checks"}-report_fixture.json`,
      ),
      JSON.stringify(report),
    );
  }
}
function aggregate(directory: string) {
  return spawnSync("node", ["--input-type=module", "-e", workflowProgram()], {
    cwd: directory,
    encoding: "utf8",
    env: {
      ...process.env,
      SHARD_REPORTS: join(directory, "reports"),
      SELECTED_MODELS: "all",
    },
    timeout: 30000,
  });
}
test("actual workflow accepts complete receipts and rejects the reproduced omission/failed-row combination", () => {
  const directory = temporaryRepository();
  try {
    writeSyntheticReports(directory);
    const good = aggregate(directory);
    expect(good.status, good.stdout + good.stderr).toBe(0);
    for (const prefix of ["checks", "verification"]) {
      const path = join(directory, "reports", `${prefix}-report_fixture.json`);
      const report = JSON.parse(readFileSync(path, "utf8"));
      report.toolHashes = {};
      for (const row of report.results) {
        row.exitCode = 1;
        row.error = "should be rejected";
        row.command = ["false"];
      }
      writeFileSync(path, JSON.stringify(report));
    }
    const bad = aggregate(directory);
    expect(bad.status, bad.stdout + bad.stderr).toBe(1);
    expect(bad.stdout).toContain("tool keys or current digests differ");
    expect(bad.stdout).toContain("failed or incomplete result");
    expect(bad.stdout).not.toContain("verifications passed");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
  "real canonical producer reports pass the actual workflow aggregation",
  () => {
    const directory = temporaryRepository();
    try {
      symlinkSync(
        join(root, "node_modules"),
        join(directory, "node_modules"),
        "dir",
      );
      for (const verify of [false, true]) {
        execFileSync(
          "node",
          [
            "scripts/check-formal.mjs",
            ...(verify ? ["--verify"] : []),
            "--model=report_fixture",
          ],
          {
            cwd: directory,
            env: process.env,
            encoding: "utf8",
            timeout: 60000,
          },
        );
        const prefix = verify ? "verification" : "checks";
        writeFileSync(
          join(directory, "reports", `${prefix}-report_fixture.json`),
          readFileSync(
            join(directory, "evidence/formal", `${prefix}-report_fixture.json`),
          ),
        );
      }
      const result = aggregate(directory);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).toContain(
        "3 check stages and 1 verifications passed for 1 models",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  120000,
);
