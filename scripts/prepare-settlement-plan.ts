import { assertRewardAllocationManifest } from "../src/lib/rewards";
/**
 * Releases the exact canonically reserved unsigned plan for a reviewed fresh cycle.
 * The creator signs it with an external Solana wallet; this process never reads
 * signing material or treats plan creation as payment.
 */

import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fundingReviewProposalSha256 } from "../src/lib/funding-review-submission";
import {
  assertProjectPaymentsEnabled,
  findProject,
  type ProjectId,
} from "../src/lib/projects.mjs";
import { assertSettlementExecutionPlan } from "../src/lib/settlement-plan";
import { loadCanonicalPaymentReservation } from "./load-payment-reservation";
import {
  reservationJson,
  verifyPaymentAuthority,
} from "./payment-reservation-history";
import { assertCanonicalSettlementReadiness } from "./settlement-readiness";
import { assertSignerCapabilityForSettlement } from "./signer-access-ledger";
import { ExistingFileError, writeNewFile } from "./write-new-file";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CYCLES_ROOT = resolve(REPOSITORY_ROOT, "cycles");
const MAX_ALLOCATION_BYTES = 8 * 1024 * 1024;

interface PlanArguments {
  allocationPath: string;
  createdAt: string;
  createdAtExplicit?: boolean;
  cycleId: string;
  feeRecipient: string;
  outputPath: string;
  projectId: ProjectId;
  sourceOwner: string;
}

function next(values: string[], index: number, flag: string): string {
  const value = values[index + 1];
  if (!value || value.startsWith("--"))
    throw new TypeError(`${flag} requires a value`);
  return value;
}

export function parseSettlementPlanArguments(
  values: string[],
  now = new Date().toISOString(),
): PlanArguments {
  let cycleId: string | null = null;
  let sourceOwner: string | null = null;
  let feeRecipient: string | null = null;
  let projectId: ProjectId | null = null;
  let createdAt = now;
  const seen = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    if (seen.has(flag)) {
      throw new TypeError(`Repeated settlement-plan argument: ${flag}`);
    }
    seen.add(flag);
    const value = next(values, index, flag);
    if (flag === "--cycle") cycleId = value;
    else if (flag === "--project") {
      const project = findProject(value);
      if (project?.reward.kind !== "monthly-pool") {
        throw new TypeError(`Project ${value} has no platform monthly pool`);
      }
      projectId = project.id;
    } else if (flag === "--source-wallet") sourceOwner = value;
    else if (flag === "--fee-wallet") feeRecipient = value;
    else if (flag === "--created-at") createdAt = value;
    else throw new TypeError(`Unknown settlement-plan argument: ${flag}`);
    index += 1;
  }
  if (!cycleId || !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(cycleId)) {
    throw new TypeError("--cycle must be YYYY-MM");
  }
  if (!sourceOwner) throw new TypeError("--source-wallet is required");
  if (!feeRecipient) throw new TypeError("--fee-wallet is required");
  if (!projectId) throw new TypeError("--project is required");
  const directory = resolve(CYCLES_ROOT, projectId, cycleId);
  return {
    allocationPath: resolve(directory, "allocation.json"),
    createdAt,
    createdAtExplicit: seen.has("--created-at"),
    cycleId,
    feeRecipient,
    outputPath: resolve(directory, "execution-plan.json"),
    projectId,
    sourceOwner,
  };
}

export async function prepareSettlementPlan(
  arguments_: PlanArguments,
  options: {
    validate?: (
      projectId: string,
      cycleId: string,
    ) => Promise<{ state: string }>;
    write?: (path: string, value: unknown) => Promise<void>;
  } = {},
) {
  assertProjectPaymentsEnabled(arguments_.projectId, arguments_.cycleId);
  if (Object.keys(options).length)
    throw new TypeError(
      "Configured settlement release does not accept validation or writer overrides",
    );
  if (
    resolve(arguments_.outputPath) !==
      resolve(dirname(arguments_.allocationPath), "execution-plan.json") ||
    !resolve(arguments_.allocationPath).endsWith(
      `/cycles/${arguments_.projectId}/${arguments_.cycleId}/allocation.json`,
    )
  )
    throw new TypeError("Plan output must use its canonical cycle directory");
  const loaded = await loadCanonicalPaymentReservation(
    REPOSITORY_ROOT,
    arguments_.projectId,
    arguments_.cycleId,
  );
  if (
    arguments_.sourceOwner !== loaded.instrument.vault ||
    arguments_.feeRecipient !== loaded.policy.feeRecipient ||
    (arguments_.createdAtExplicit &&
      arguments_.createdAt !== loaded.reservation.reservedAt)
  )
    throw new TypeError(
      "Wallets and explicit timestamp must match the fixed reviewed reservation",
    );
  const bytes = new Uint8Array(loaded.fixedPlanBytes);
  if (
    (await fundingReviewProposalSha256(bytes)) !== loaded.reservation.planSha256
  )
    throw new TypeError("Reserved plan bytes failed exact digest check");
  const plan = assertSettlementExecutionPlan(
    reservationJson(bytes),
    assertRewardAllocationManifest(reservationJson(loaded.allocationBytes)),
  );
  const readiness = await assertCanonicalSettlementReadiness(
    REPOSITORY_ROOT,
    loaded,
  );
  if (verifyPaymentAuthority(REPOSITORY_ROOT) !== loaded.revision)
    throw new TypeError(
      "Canonical authority changed before release; retry the same reservation",
    );
  const now = new Date().toISOString();
  assertSignerCapabilityForSettlement(
    loaded.signerLedger,
    {
      projectId: arguments_.projectId,
      cycleId: arguments_.cycleId,
      fundingBasis: { instrumentId: loaded.reservation.instrumentId },
    },
    now,
  );
  if (
    now >= loaded.policy.planningExpiresAt ||
    Date.parse(now) - Date.parse(readiness.observedAt) > 300000
  )
    throw new TypeError(
      "Readiness expired before release; reserved principal remains held",
    );
  const directory = await lstat(dirname(arguments_.outputPath));
  if (!directory.isDirectory() || directory.isSymbolicLink())
    throw new TypeError(
      "Plan destination must be a real canonical cycle directory",
    );
  try {
    await writeNewFile(
      arguments_.outputPath,
      bytes,
      "A different plan already occupies the canonical cycle path",
    );
  } catch (error) {
    if (!(error instanceof ExistingFileError)) throw error;
    const handle = await open(
      arguments_.outputPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        stat.size > MAX_ALLOCATION_BYTES ||
        stat.size !== bytes.byteLength
      )
        throw new TypeError("Existing plan differs from reserved bytes");
      const existing = await handle.readFile();
      if (!existing.equals(Buffer.from(bytes)))
        throw new TypeError("Existing plan differs from reserved bytes");
    } finally {
      await handle.close();
    }
  }
  return plan;
}

if (import.meta.main) {
  try {
    const arguments_ = parseSettlementPlanArguments(process.argv.slice(2));
    const plan = await prepareSettlementPlan(arguments_);
    process.stdout.write(
      `[Slop] wrote unsigned ${plan.token.symbol} plan with ${plan.transfers.length} transfer(s); sign externally and publish transaction evidence\n`,
    );
  } catch (error) {
    // error-policy:J1 command boundary exposes a non-zero, actionable failure.
    process.stderr.write(
      `[Slop] settlement plan refused: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  }
}
