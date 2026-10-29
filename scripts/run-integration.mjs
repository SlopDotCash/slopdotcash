/**
 * Runs Miniflare workflow drivers one at a time. Each driver starts its
 * own runtime on free ports with temporary storage. The run fails when any
 * driver fails or exceeds its deadline.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { childEnvironment } from "./child-environment.mjs";
import { runE2ePhase } from "./run-e2e-phase.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const drivers = [
  ["direct-history", "node", ["backend/payments/direct-history.workflow.mjs"]],
  [
    "scanner-progress",
    "node",
    ["workers/payments/scanner-progress.workflow.mjs"],
  ],
  ["monthly-order", "node", ["workers/payments/monthly-order.workflow.mjs"]],
  ["dispatch-clock", "node", ["workers/payments/dispatch-clock.workflow.mjs"]],
  [
    "notifications-mark-read",
    "node",
    ["backend/notifications/mark-read.workflow.mjs"],
  ],
  ["security-inbox-list", "node", ["backend/security/inbox-list.workflow.mjs"]],
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
  // Keep each native runtime separate: concurrent runs reproduced transport
  // resets during response reads and database setup. Every driver still runs
  // once, with its original deadline and assertions.
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
  [
    "monthly-authority",
    "node",
    ["backend/payments/monthly-authority.workflow.mjs"],
  ],
];
const runDriver = ([label, command, args, env = process.env]) =>
  runE2ePhase({
    label,
    command,
    args,
    cwd: root,
    env,
    timeoutMs: 10 * 60_000,
  });
const statuses = [];
for (const driver of drivers) statuses.push(await runDriver(driver));
const failed = drivers.filter((_, index) => statuses[index] !== 0);
if (failed.length > 0) {
  process.stderr.write(
    `Failed: ${failed.map(([label]) => label).join(", ")}\n`,
  );
  process.exit(1);
}
