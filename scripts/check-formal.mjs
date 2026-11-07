import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const verify = process.argv.includes("--verify");
const selected = process.argv
  .find((arg) => arg.startsWith("--model="))
  ?.slice(8);
const serverEndpoint = `localhost:${20000 + (process.pid % 20000)}`;
const quint = join(root, "node_modules/.bin/quint");
const modelDirectory = join(root, "formal/models");
const files = readdirSync(modelDirectory)
  .filter(
    (file) =>
      file.endsWith(".qnt") && (!selected || file === `${selected}.qnt`),
  )
  .sort();
if (files.length === 0) throw new Error("No matching Quint models");
const digest = (value) => createHash("sha256").update(value).digest("hex");
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
for (const file of files) {
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
          `--server-endpoint=${serverEndpoint}`,
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
    const result = spawnSync(quint, args, {
      cwd: root,
      encoding: "utf8",
      timeout: verify ? 180_000 : 90_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    const stable =
      testedSha256 === digest(readFileSync(join(root, input))) &&
      Object.entries(testedSources).every(
        ([path, hash]) => digest(readFileSync(join(root, path))) === hash,
      );
    const passed = result.status === 0 && !result.error && stable;
    results.push({
      model: input,
      sha256: testedSha256,
      sources: testedSources,
      command: ["quint", ...args],
      passed,
      exitCode: result.status,
      signal: result.signal,
      durationMs: Date.now() - started,
      output,
      error: stable
        ? (result.error?.message ?? null)
        : "Model or mapped source changed while its check was running; repeat against stable bytes.",
    });
    console.log(`${passed ? "PASS" : "FAIL"} ${args[0]} ${file}`);
    if (!passed) console.error(output || result.error?.message);
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
if (!inputsUnchanged || results.some((result) => !result.passed))
  process.exitCode = 1;
