import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { childEnvironment } from "./child-environment.mjs";
import { runE2ePhase } from "./run-e2e-phase.mjs";
import { createRunnerCancellation } from "./runner-cancellation.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modes = [
  [],
  ["--production-attester"],
  ["--production-attester", "--private-only"],
  ["--production-attester", "--binding-guard"],
  ["--production-attester", "--binding-recovery"],
  ["--production-attester", "--binding-recovery", "--original-winner"],
  ["--production-attester", "--binding-cancellation"],
  ["--production-attester", "--binding-cancellation", "--original-winner"],
  ["--production-attester", "--expired-cancellation"],
  ["--production-attester", "--native-cancellation"],
];
const checks = modes.map((args) => ({
  label: args.length
    ? args.map((arg) => arg.slice(2)).join("-")
    : "security-payments",
  command: "bun",
  args: ["backend/security/payments.integration.ts", ...args],
}));
checks.push({
  label: "direct-security-payments",
  command: "bun",
  args: ["backend/security/direct-payments.integration.ts"],
});
checks.push({
  label: "binding-recovery-workflow",
  command: "node",
  args: ["workers/payment-executor/binding-recovery.workflow.mjs"],
});

const cancellation = createRunnerCancellation();
async function availablePort() {
  await cancellation.checkpoint();
  const server = createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    cancellation.check();
    return String(server.address().port);
  } finally {
    if (server.listening)
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
  }
}

// Every scenario owns its ports and database. Bound concurrent local chains.
let next = 0;
async function worker() {
  try {
    while (next < checks.length) {
      await cancellation.checkpoint();
      if (next >= checks.length) break;
      const index = next++;
      const anvilPort = await availablePort();
      const directPort = await availablePort();
      await cancellation.checkpoint();
      const status = await runE2ePhase({
        ...checks[index],
        cwd: root,
        env: {
          ...childEnvironment(),
          SLOP_SECURITY_ANVIL_PORT: anvilPort,
          SLOP_DIRECT_TEST_PORT: directPort,
        },
        timeoutMs: 10 * 60_000,
        signal: cancellation.signal,
      });
      cancellation.record(status);
    }
  } catch (error) {
    if (!cancellation.signal.aborted) console.error(error);
    // A startup failure stops new work and aborts the sibling phase, but both
    // workers remain awaited until their owned process groups have settled.
    cancellation.abort(1);
  }
}
try {
  await Promise.all([worker(), worker()]);
} finally {
  // Repeated signals remain handled throughout the workers' cleanup.
  cancellation.dispose();
}
process.exitCode = cancellation.exitCode;
