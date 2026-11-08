import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runE2ePhase } from "./run-e2e-phase.mjs";

const root = resolve(import.meta.dirname, "..");
const verify = process.argv.includes("--verify");
const selected = process.argv
  .find((arg) => arg.startsWith("--model="))
  ?.slice(8);
const quint = join(root, "node_modules/.bin/quint");
const localTranslator = join(root, "scripts/quint-local-translator.mjs");
const modelDirectory = join(root, "formal/models");
const files = readdirSync(modelDirectory)
  .filter(
    (file) =>
      file.endsWith(".qnt") && (!selected || file === `${selected}.qnt`),
  )
  .sort();
if (files.length === 0) throw new Error("No matching Quint models");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const toolHashes = Object.fromEntries(
  [
    "scripts/check-formal.mjs",
    "scripts/run-e2e-phase.mjs",
    "bun.lock",
    ...(verify
      ? [
          "scripts/quint-local-translator.mjs",
          "scripts/quint-tla-normalization.mjs",
          "formal/tlc.json",
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
  files.map((file) => [file, digest(readFileSync(join(modelDirectory, file)))]),
);
const modelSources = new Map(
  files.map((file) => [
    file,
    [
      ...readFileSync(join(modelDirectory, file), "utf8").matchAll(
        /^\s*\/\/\s*@source\s+(\S+)\s*$/gmu,
      ),
    ].map((match) => match[1]),
  ]),
);
const sourceHashes = new Map(
  [...new Set([...modelSources.values()].flat())]
    .sort()
    .map((path) => [path, digest(readFileSync(join(root, path)))]),
);
const results = [];
models: for (const file of files) {
  const input = `formal/models/${file}`;
  const modelText = readFileSync(join(root, input), "utf8");
  if (!/^\s*run\s+\w+Test\s*=/mu.test(modelText)) {
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
    let status;
    try {
      status = await runE2ePhase({
        label: args[0],
        command: command[0],
        args: command.slice(1),
        cwd: root,
        env: {
          ...process.env,
          TMPDIR: stageDirectory,
          TMP: stageDirectory,
          TEMP: stageDirectory,
        },
        // Large finite UI graphs exceeded three minutes after exploring
        // millions of states. Keep a six-minute verification-stage budget;
        // type, scenario and simulation checks retain their shorter limit.
        timeoutMs: verify ? 360_000 : 90_000,
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
    const passed = status === 0 && !error && stable;
    results.push({
      model: input,
      sha256: testedSha256,
      sources: testedSources,
      command,
      passed,
      exitCode: status,
      durationMs: Date.now() - started,
      output,
      error: stable
        ? error
        : "Model or mapped source changed while its check was running; repeat against stable bytes.",
    });
    console.log(`${passed ? "PASS" : "FAIL"} ${args[0]} ${file}`);
    if (!passed) console.error(output || error);
    if (cancellation.signal.aborted) break models;
    if (!passed) break;
  }
}
const directory = join(root, "evidence/formal");
mkdirSync(directory, { recursive: true });
const finalFiles = readdirSync(modelDirectory)
  .filter(
    (file) =>
      file.endsWith(".qnt") && (!selected || file === `${selected}.qnt`),
  )
  .sort();
const inputsUnchanged =
  toolsUnchanged() &&
  JSON.stringify(files) === JSON.stringify(finalFiles) &&
  files.every(
    (file) =>
      digest(readFileSync(join(modelDirectory, file))) ===
      inputHashes.get(file),
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
    "Finite bounds and abstractions are defined in each model and its audit.",
    "The Quint TLC backend disables deadlock checking; terminal-state progress requires explicit scenarios.",
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
