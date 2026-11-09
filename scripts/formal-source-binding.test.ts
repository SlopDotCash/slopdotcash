import { expect, it } from "bun:test";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

it("refuses a successful model run when its mapped implementation changes during checking", async () => {
  const root = resolve(import.meta.dirname, "..");
  const fixture = mkdtempSync(join(tmpdir(), "slop-quint-source-binding-"));
  try {
    mkdirSync(join(fixture, "scripts"));
    mkdirSync(join(fixture, "formal/models/fixture"), { recursive: true });
    symlinkSync(
      join(root, "node_modules"),
      join(fixture, "node_modules"),
      "dir",
    );
    writeFileSync(
      join(fixture, "scripts/check-formal.mjs"),
      readFileSync(join(root, "scripts/check-formal.mjs")),
    );
    for (const script of ["formal-models.mjs", "run-e2e-phase.mjs"])
      writeFileSync(
        join(fixture, "scripts", script),
        readFileSync(join(root, "scripts", script)),
      );
    writeFileSync(
      join(fixture, "bun.lock"),
      readFileSync(join(root, "bun.lock")),
    );
    writeFileSync(
      join(fixture, "implementation.ts"),
      "export const state = 'before';\n",
    );
    writeFileSync(
      join(fixture, "formal/models/fixture/source_binding.qnt"),
      `// @source implementation.ts
module source_binding {
  var s: int
  action init = s' = 0
  action step = s' = s
  val invariant = s == 0
  run initializedTest = init.expect(invariant)
}
`,
    );
    let changed = false;
    let output = "";
    const child = spawn(process.execPath, ["scripts/check-formal.mjs"], {
      cwd: fixture,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const record = (chunk: Buffer) => {
      output += chunk.toString();
      if (!changed && output.includes("PASS typecheck")) {
        changed = true;
        writeFileSync(
          join(fixture, "implementation.ts"),
          "export const state = 'after';\n",
        );
      }
    };
    child.stdout.on("data", record);
    child.stderr.on("data", record);
    const code = await new Promise<number | null>((resolveCode, reject) => {
      child.once("error", reject);
      child.once("close", resolveCode);
    });
    expect(changed).toBe(true);
    expect(code).toBe(1);
    const report = JSON.parse(
      readFileSync(join(fixture, "evidence/formal/checks.json"), "utf8"),
    );
    expect(
      report.results.find((result: { command: string[] }) =>
        result.command.includes("test"),
      )?.output,
    ).toContain("ok initializedTest passed");
    expect(report.inputsUnchanged).toBe(false);
    expect(report.results[0].sources["implementation.ts"]).toMatch(
      /^[a-f0-9]{64}$/u,
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}, 30_000);
