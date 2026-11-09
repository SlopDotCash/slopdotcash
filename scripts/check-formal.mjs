import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  listModels,
  modelScenarios,
  modelSources as sourcesOf,
} from "./formal-models.mjs";
import { readSafetyViews } from "./quint-safety-view.mjs";
import { runE2ePhase } from "./run-e2e-phase.mjs";

const root = resolve(import.meta.dirname, "..");
const verify = process.argv.includes("--verify");
const selected = process.argv
  .find((arg) => arg.startsWith("--model="))
  ?.slice(8);
const quint = join(root, "node_modules/.bin/quint");
const localTranslator = join(root, "scripts/quint-local-translator.mjs");
const safetyViews = verify ? readSafetyViews(root) : null;
const files = listModels(root, selected);
// This finite graph completed in 219s with unchanged inputs. Keep the
// exception explicit; ordinary stages retain their limits.
const verificationTimeouts = {
  "formal/models/ui/ui_submitted_payment_recovery.qnt": 600_000,
  // This full-state UI graph exceeds the ordinary three-minute budget.
  // Keep its resource allowance explicit without reducing the model.
  "formal/models/ui/ui_bounty_payment_parent.qnt": 1_800_000,
  // The journal's unchanged finite domain exceeds the ordinary three-minute
  // budget. Keep a bounded, model-specific allowance for its reviewed view.
  "formal/models/payments/direct_bounty_journal.qnt": 1_800_000,
};
if (files.length === 0) throw new Error("No matching Quint models");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const toolHashes = Object.fromEntries(
  [
    "scripts/check-formal.mjs",
    "scripts/formal-models.mjs",
    "scripts/run-e2e-phase.mjs",
    "bun.lock",
    ...(verify
      ? [
          "scripts/quint-local-translator.mjs",
          "scripts/quint-tla-normalization.mjs",
          "scripts/quint-safety-view.mjs",
          "formal/tlc.json",
          "formal/tlc-safety-views.json",
        ]
      : []),
  ].map((path) => [path, digest(readFileSync(join(root, path)))]),
);
const java = verify
  ? spawnSync("java", ["-version"], { encoding: "utf8", timeout: 10_000 })
  : null;
const javaVersion = java
  ? `${java.stdout ?? ""}${java.stderr ?? ""}`.trim()
  : null;
if (java && (java.status !== 0 || !/version "21[."]/u.test(javaVersion)))
  throw new Error(
    `Java 21 is required for the pinned verifier: ${javaVersion}`,
  );
const cancellation = new AbortController();
const cancel = () => cancellation.abort(new Error("Model checks canceled"));
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
  process.once(signal, cancel);
const toolsUnchanged = () =>
  Object.entries(toolHashes).every(
    ([path, hash]) => digest(readFileSync(join(root, path))) === hash,
  );
const inputHashes = new Map(
  files.map((file) => [file, digest(readFileSync(join(root, file)))]),
);
const modelSources = new Map(
  files.map((file) => [
    file,
    sourcesOf(readFileSync(join(root, file), "utf8")),
  ]),
);
const sourceHashes = new Map(
  [...new Set([...modelSources.values()].flat())]
    .sort()
    .map((path) => [path, digest(readFileSync(join(root, path)))]),
);
const results = [];
models: for (const file of files) {
  const input = file;
  const modelText = readFileSync(join(root, input), "utf8");
  if (modelScenarios(modelText).length === 0) {
    throw new Error(`${input} has no named reachability scenario`);
  }
  const temporalProperties = [
    ...modelText.matchAll(/^\s*temporal\s+(\w+Property)\s*=/gmu),
  ].map((match) => match[1]);
  const stages = verify
    ? [
        [
          "verify",
          input,
          "--backend=tlc",
          "--verbosity=3",
          "--tlc-config=formal/tlc.json",
          "--invariant=invariant",
          ...(temporalProperties.length
            ? [`--temporal=${temporalProperties.join(",")}`]
            : []),
        ],
      ]
    : [
        ["typecheck", input],
        [
          "test",
          input,
          "--backend=typescript",
          "--seed=20261107",
          "--max-samples=100",
        ],
        [
          "run",
          input,
          "--backend=typescript",
          "--seed=20261107",
          "--max-samples=500",
          "--max-steps=60",
          "--invariant=invariant",
        ],
      ];
  for (const args of stages) {
    const safetyView = safetyViews?.views.find((view) => view.model === input);
    const timeoutMs = verify ? (verificationTimeouts[file] ?? 180_000) : 90_000;
    const testedSha256 = digest(readFileSync(join(root, input)));
    const testedSources = Object.fromEntries(
      modelSources
        .get(file)
        .map((path) => [path, digest(readFileSync(join(root, path)))]),
    );
    const started = Date.now();
    const command = verify
      ? [process.execPath, "--import", localTranslator, quint, ...args]
      : [quint, ...args];
    let output = "";
    let bytes = 0;
    const collect = (text) => {
      bytes += Buffer.byteLength(text);
      if (bytes > 8 * 1024 * 1024)
        cancellation.abort(new Error("Verifier exceeded 8MiB output limit"));
      else output += text;
    };
    const stageDirectory = mkdtempSync(join(tmpdir(), "slop-formal-stage-"));
    const env = {
      ...process.env,
      TMPDIR: stageDirectory,
      TMP: stageDirectory,
      TEMP: stageDirectory,
    };
    delete env.SLOP_QUINT_SAFETY_VIEW;
    if (safetyView) env.SLOP_QUINT_SAFETY_VIEW = safetyView.id;
    let status;
    try {
      status = await runE2ePhase({
        label: args[0],
        command: command[0],
        args: command.slice(1),
        cwd: root,
        env,
        timeoutMs,
        signal: cancellation.signal,
        onStdout: collect,
        onStderr: collect,
      });
    } finally {
      rmSync(stageDirectory, { recursive: true, force: true });
    }
    const stable =
      toolsUnchanged() &&
      testedSha256 === digest(readFileSync(join(root, input))) &&
      Object.entries(testedSources).every(
        ([path, hash]) => digest(readFileSync(join(root, path))) === hash,
      );
    const error = cancellation.signal.aborted
      ? cancellation.signal.reason.message
      : null;
    const viewLine = output.match(/^\[tlc-safety-view\] (.+)$/mu);
    let appliedView = null;
    if (viewLine) {
      try {
        appliedView = JSON.parse(viewLine[1]);
      } catch {
        // A missing or malformed binding receipt cannot authorize a view.
      }
    }
    const viewApplied =
      !safetyView ||
      (appliedView?.id === safetyView.id &&
        appliedView?.model === input &&
        appliedView?.sourceSha256 === testedSha256 &&
        appliedView?.translatedSha256 === safetyView.translatedSha256 &&
        appliedView?.operator === safetyView.operator &&
        appliedView?.hashMode === safetyView.hashMode &&
        appliedView?.memoryCandidateMode === safetyView.memoryCandidateMode &&
        appliedView?.viewTlaSha256 === safetyView.viewTlaSha256 &&
        appliedView?.adapterSha256 === safetyViews.quintAdapterSha256 &&
        JSON.stringify(appliedView?.fields) ===
          JSON.stringify(safetyView.fields) &&
        JSON.stringify(appliedView?.clauses) ===
          JSON.stringify(safetyView.clauses));
    const passed = status === 0 && !error && stable && viewApplied;
    results.push({
      model: input,
      sha256: testedSha256,
      sources: testedSources,
      command,
      passed,
      exitCode: status,
      timeoutMs,
      durationMs: Date.now() - started,
      output,
      requestedSafetyView: safetyView?.id ?? null,
      safetyView: appliedView,
      error: !stable
        ? "Model or mapped source changed while its check was running; repeat against stable bytes."
        : !viewApplied
          ? "Requested safety view was not applied; no verification claim."
          : error,
    });
    console.log(`${passed ? "PASS" : "FAIL"} ${args[0]} ${file}`);
    if (!passed) console.error(output || error);
    if (cancellation.signal.aborted) break models;
    if (!passed) break;
  }
}
const directory = join(root, "evidence/formal");
mkdirSync(directory, { recursive: true });
const finalFiles = listModels(root, selected);
const inputsUnchanged =
  toolsUnchanged() &&
  JSON.stringify(files) === JSON.stringify(finalFiles) &&
  files.every(
    (file) => digest(readFileSync(join(root, file))) === inputHashes.get(file),
  ) &&
  [...sourceHashes].every(
    ([path, hash]) => digest(readFileSync(join(root, path))) === hash,
  );
if (!inputsUnchanged)
  console.error(
    "FAIL model set or mapped source changed during verification; repeat the check.",
  );
const report = {
  schemaVersion: 1,
  mode: verify ? "exhaustive-finite-tlc" : "types-scenarios-seeded-simulation",
  translation: verify ? "local-apalache-cli" : "not-used",
  toolHashes,
  javaVersion,
  canceled: cancellation.signal.aborted,
  generatedAt: new Date().toISOString(),
  inputsUnchanged,
  quintVersion: JSON.parse(
    readFileSync(
      join(root, "node_modules/@informalsystems/quint/package.json"),
      "utf8",
    ),
  ).version,
  limitations: [
    "Model correctness does not establish source refinement.",
    "Finite bounds and abstractions are defined in each model.",
    "The Quint TLC backend disables deadlock checking; terminal-state progress requires explicit scenarios.",
    "A safetyView identifies a reviewed quotient; its graph count is not the count of all full model states.",
  ],
  results,
};
writeFileSync(
  join(
    directory,
    `${verify ? "verification" : "checks"}${selected ? `-${selected}` : ""}.json`,
  ),
  `${JSON.stringify(report, null, 2)}\n`,
);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
  process.removeListener(signal, cancel);
if (
  !inputsUnchanged ||
  cancellation.signal.aborted ||
  results.some((result) => !result.passed)
)
  process.exitCode = 1;
