/**
 * Runs the Miniflare workflow drivers through a bounded concurrency pool.
 * Each driver starts its own runtime on free ports with temporary storage.
 * The drivers that start real Wrangler, Vite or API processes with the
 * shared child environment form one serial group that occupies a single pool
 * slot, so they never overlap each other. The run fails when any driver
 * fails or exceeds its deadline; every driver still runs once with its
 * original deadline and assertions.
 *
 * SLOP_INTEGRATION_CONCURRENCY sets the pool size (default 4). Set it to 1 to
 * restore the former one-at-a-time order when diagnosing a transport reset.
 */
import { availableParallelism } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { childEnvironment } from "./child-environment.mjs";
import { runE2ePhase } from "./run-e2e-phase.mjs";
import { createRunnerCancellation } from "./runner-cancellation.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cancellation = createRunnerCancellation();

const requested = process.env.SLOP_INTEGRATION_CONCURRENCY;
const concurrency =
  requested === undefined
    ? Math.max(1, Math.min(4, availableParallelism()))
    : Number(requested);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16)
  throw new TypeError("SLOP_INTEGRATION_CONCURRENCY must be 1 to 16");

// Real local processes (Vite, the dev API, Wrangler dry runs) with the shared
// child environment. They stay one at a time, in this order.
const serial = [
  [
    "dev-private-flow",
    "bun",
    ["scripts/dev-private-flow.integration.ts"],
    childEnvironment(),
  ],
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
// Self-contained Miniflare drivers: each owns its runtime, ports and storage.
const pooled = [
  ["direct-history", "node", ["backend/payments/direct-history.workflow.mjs"]],
  [
    "scanner-progress",
    "node",
    ["workers/payments/scanner-progress.workflow.mjs"],
  ],
  ["monthly-order", "node", ["workers/payments/monthly-order.workflow.mjs"]],
  ["dispatch-clock", "node", ["workers/payments/dispatch-clock.workflow.mjs"]],
  [
    "solana-progress",
    "node",
    ["workers/payments/solana-progress.workflow.mjs"],
  ],
  [
    "notifications-mark-read",
    "node",
    ["backend/notifications/mark-read.workflow.mjs"],
  ],
  ["security-inbox-list", "node", ["backend/security/inbox-list.workflow.mjs"]],
  [
    "incomplete-assessments",
    "node",
    ["backend/notifications/incomplete-assessments.workflow.mjs"],
  ],
  [
    "reporting-readiness",
    "node",
    ["backend/security/reporting-readiness.workflow.mjs"],
  ],
  ["vetting-backup", "node", ["workers/vetting-backup/workflow.mjs"]],
  [
    "vetting-generation-retirement",
    "node",
    ["workers/vetting-backup/generation-retirement.workflow.mjs"],
  ],
  [
    "vetting-qualification",
    "node",
    ["workers/vetting-backup/qualification-workflow.mjs"],
  ],
  ["vetting-flags", "node", ["workers/vetting-flags/run-workflow.mjs"]],
  [
    "monthly-authority",
    "node",
    ["backend/payments/monthly-authority.workflow.mjs"],
  ],
];

const statuses = new Map();
async function runDriver([label, command, args, env = process.env]) {
  await cancellation.checkpoint();
  const started = performance.now();
  const status = await runE2ePhase({
    label,
    command,
    args,
    cwd: root,
    env,
    timeoutMs: 10 * 60_000,
    signal: cancellation.signal,
  });
  statuses.set(label, status);
  cancellation.record(status === 0 ? 0 : 1);
  process.stdout.write(
    `[${label}] ${status === 0 ? "passed" : `failed (${status})`} in ${((performance.now() - started) / 1000).toFixed(1)} s\n`,
  );
}

// The serial group is one unit; the pool never runs two units of it.
const units = [
  async () => {
    for (const driver of serial) await runDriver(driver);
  },
  ...pooled.map((driver) => () => runDriver(driver)),
];
async function lane() {
  for (let unit = units.shift(); unit; unit = units.shift()) await unit();
}

try {
  const lanes = await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, units.length) }, lane),
  );
  for (const result of lanes)
    if (result.status === "rejected") throw result.reason;
} catch (error) {
  if (!cancellation.signal.aborted) console.error(error);
  cancellation.abort(1);
} finally {
  cancellation.dispose();
}
const failed = [...serial, ...pooled]
  .map(([label]) => label)
  .filter((label) => statuses.has(label) && statuses.get(label) !== 0);
const missing = [...serial, ...pooled]
  .map(([label]) => label)
  .filter((label) => !statuses.has(label));
if (failed.length > 0) process.stderr.write(`Failed: ${failed.join(", ")}\n`);
if (missing.length > 0) {
  process.stderr.write(`Not run: ${missing.join(", ")}\n`);
  cancellation.record(1);
}
process.exitCode = cancellation.exitCode;
