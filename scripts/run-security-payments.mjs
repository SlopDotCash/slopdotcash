import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { childEnvironment } from "./child-environment.mjs";
import { runE2ePhase } from "./run-e2e-phase.mjs";

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

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return String(port);
}

// Every scenario owns its ports and database. Bound concurrent local chains.
let next = 0;
const statuses = new Array(checks.length);
await Promise.all(
  Array.from({ length: 2 }, async () => {
    while (next < checks.length) {
      const index = next++;
      statuses[index] = await runE2ePhase({
        ...checks[index],
        cwd: root,
        env: {
          ...childEnvironment(),
          SLOP_SECURITY_ANVIL_PORT: await availablePort(),
          SLOP_DIRECT_TEST_PORT: await availablePort(),
        },
        timeoutMs: 10 * 60_000,
      });
    }
  }),
);
if (statuses.some((status) => status !== 0)) process.exitCode = 1;
