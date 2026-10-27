/**
 * Runs independent Miniflare workflow drivers in parallel. Each driver starts its
 * own runtime on free ports with temporary storage. The run fails when any
 * driver fails or exceeds its deadline.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { childEnvironment } from "./child-environment.mjs";
import { runE2ePhase } from "./run-e2e-phase.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const parallelDrivers = [
  [
    "reporting-readiness",
    "node",
    ["backend/security/reporting-readiness.workflow.mjs"],
  ],
  ["vetting-backup", "node", ["workers/vetting-backup/workflow.mjs"]],
  [
    "vetting-qualification",
    "node",
    ["workers/vetting-backup/qualification-workflow.mjs"],
  ],
  ["vetting-flags", "node", ["workers/vetting-flags/run-workflow.mjs"]],
];
// Keep the private-payment RPC streams apart from other native runtimes and
// from each other. Concurrent runs reproduced connection resets while reading
// responses; each driver still runs once with the same deadline and assertions.
const serialDrivers = [
  // The inactive production attester gets no keys or provider credentials.
  [
    "attester-bootstrap",
    "node",
    ["workers/payment-executor/bootstrap-workflow.mjs"],
    childEnvironment(),
  ],
  [
    "staging-monthly-release",
    "node",
    ["workers/payment-executor/staging-release.workflow.mjs"],
    childEnvironment(),
  ],
];
const drivers = [...parallelDrivers, ...serialDrivers];
const runDriver = ([label, command, args, env = process.env]) =>
  runE2ePhase({
    label,
    command,
    args,
    cwd: root,
    env,
    timeoutMs: 10 * 60_000,
  });
const statuses = await Promise.all(parallelDrivers.map(runDriver));
for (const driver of serialDrivers) statuses.push(await runDriver(driver));
const failed = drivers.filter((_, index) => statuses[index] !== 0);
if (failed.length > 0) {
  process.stderr.write(
    `Failed: ${failed.map(([label]) => label).join(", ")}\n`,
  );
  process.exit(1);
}
