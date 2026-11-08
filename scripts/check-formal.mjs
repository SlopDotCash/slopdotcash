import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const models = join(root, "formal/pr-review-20261107");
const quint = join(root, "node_modules/@informalsystems/quint/dist/src/cli.js");
const verify = process.argv.includes("--verify");
const artifacts = mkdtempSync(join(tmpdir(), "slop-formal-"));
const results = [];
console.log(`Formal evidence: ${artifacts}`);
for (const file of readdirSync(models)
  .filter((name) => name.endsWith(".qnt"))
  .sort()) {
  const input = join(models, file);
  const stages = verify
    ? [
        [
          "verify",
          input,
          "--backend=tlc",
          "--invariant=invariant",
          `--server-endpoint=localhost:${20000 + (process.pid % 20000)}`,
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
    const started = Date.now();
    const result = spawnSync(process.execPath, [quint, ...args], {
      cwd: artifacts,
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    const passed = result.status === 0 && !result.error;
    writeFileSync(
      join(artifacts, `${basename(file, ".qnt")}-${args[0]}.log`),
      output,
    );
    results.push({
      model: file,
      command: args,
      passed,
      exitCode: result.status,
      milliseconds: Date.now() - started,
      error: result.error?.message ?? null,
    });
    console.log(`${passed ? "PASS" : "FAIL"} ${file} ${args[0]}`);
    if (!passed) {
      console.error(output || result.error?.message);
      break;
    }
  }
}
const version = JSON.parse(
  readFileSync(
    join(root, "node_modules/@informalsystems/quint/package.json"),
    "utf8",
  ),
).version;
writeFileSync(
  join(artifacts, "results.json"),
  `${JSON.stringify({ quintVersion: version, results }, null, 2)}\n`,
);
if (results.some((result) => !result.passed)) process.exitCode = 1;
