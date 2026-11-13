import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runE2ePhase } from "./run-e2e-phase.mjs";

// The formal CI job supplies Java 21 and runs this gate explicitly. Ordinary
// application tests do not download or launch the model-checker toolchain.
const enabled = process.env.SLOP_QUINT_TRANSLATOR_TEST === "1";
const root = resolve(import.meta.dirname, "..");

async function verify(module: string) {
  const directory = mkdtempSync(resolve(tmpdir(), "slop-translator-test-"));
  const controller = new AbortController();
  let output = "";
  try {
    const status = await runE2ePhase({
      label: module,
      command: "node",
      args: [
        "--import",
        "./scripts/quint-local-translator.mjs",
        "node_modules/.bin/quint",
        "verify",
        "tests/fixtures/quint-tla-normalization.qnt",
        `--main=${module}`,
        "--backend=tlc",
        "--invariant=invariant",
        "--tlc-config=formal/tlc.json",
        "--verbosity=3",
      ],
      cwd: root,
      env: {
        ...process.env,
        TMPDIR: directory,
        TMP: directory,
        TEMP: directory,
      },
      // Leave the enclosing 180s test deadline time to terminate descendants
      // and remove their scratch files even when Java does not complete.
      timeoutMs: 170_000,
      signal: controller.signal,
      onStdout: (chunk) => {
        output += chunk;
      },
      onStderr: (chunk) => {
        output += chunk;
      },
    });
    return { status, output };
  } finally {
    controller.abort();
    rmSync(directory, { recursive: true, force: true });
  }
}

test.skipIf(!enabled)(
  "local translator rejects the false literal invariant with a real TLC counterexample",
  async () => {
    const result = await verify("literal_false");
    expect(result).toMatchObject({ status: 1 });
    expect(result.output).toContain(
      "Invariant q_inv is violated by the initial state",
    );
    expect(result.output).toContain(
      'text = "ApaFoldSet( LET v == 0 IN __QUINT_LAMBDA"',
    );
    expect(result.output).toContain("error: found a counterexample");
    expect(result.output).not.toContain("No violation found");
  },
  180_000,
);

for (const module of ["literal_true", "fold_true"]) {
  test.skipIf(!enabled)(
    `local translator verifies ${module} through the real TLC pipeline`,
    async () => {
      const result = await verify(module);
      expect(result).toMatchObject({ status: 0 });
      expect(result.output).toContain("[local-translator] Apalache 0.62.4");
      expect(result.output).toContain("1 distinct states found");
      expect(result.output).toContain("No error has been found");
      expect(result.output).toContain("No violation found");
    },
    180_000,
  );
}
