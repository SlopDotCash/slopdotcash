/** Trusted-checkout, read-only RPC bridge. GitHub review authorizes ledger publication. */
import { execFileSync } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertRewardAllocationManifest } from "../src/lib/rewards";
import { assertSettlementExecutionPlan } from "../src/lib/settlement-plan";
import {
  compileSquadsBatchChild,
  MAX_SQUADS_CHILD_TRANSFERS,
} from "../src/lib/squads-batch-message";
import {
  assertSquadsExecutionBinding,
  assertSquadsExecutionObservation,
  executionSha256,
  MAX_EXECUTION_JSON_BYTES,
  parseExecutionJson,
  parseSquadsBindingLedger,
  validateSquadsExecutionContext,
} from "../src/lib/squads-execution";
import {
  squadsBatchChildAddress,
  squadsExecutionAddress,
  verifySquadsExecution,
} from "../src/lib/squads-execution-verifier";

export const BINDING_LEDGER_PATH = "funding/executions/ledger.json";
export interface SquadsBindingRequest {
  project: string;
  cycle: string;
  transaction_index: string;
  mode: "single" | "batch";
}
export function assertSquadsBindingRequest(
  value: unknown,
): SquadsBindingRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Expected binding request");
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join() !== "cycle,mode,project,transaction_index" ||
    typeof v.project !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(v.project) ||
    v.project.length > 64 ||
    typeof v.cycle !== "string" ||
    !/^20[0-9]{2}-(0[1-9]|1[0-2])$/u.test(v.cycle) ||
    typeof v.transaction_index !== "string" ||
    !/^[1-9][0-9]{0,19}$/u.test(v.transaction_index) ||
    BigInt(v.transaction_index) > (1n << 64n) - 1n ||
    (v.mode !== "single" && v.mode !== "batch")
  )
    throw new TypeError("Invalid binding request");
  return {
    project: v.project,
    cycle: v.cycle,
    transaction_index: v.transaction_index,
    mode: v.mode,
  };
}

export async function prepareSquadsBinding(
  request: unknown,
  source: {
    allocationBytes: Uint8Array;
    planBytes: Uint8Array;
    ledgerBytes: Uint8Array;
  },
  options: Parameters<typeof verifySquadsExecution>[1] = {},
) {
  const input = assertSquadsBindingRequest(request);
  // Snapshot every caller-owned byte before the first await.
  const allocationBytes = new Uint8Array(source.allocationBytes);
  const planBytes = new Uint8Array(source.planBytes);
  const ledgerBytes = new Uint8Array(source.ledgerBytes);
  const baseLedger = parseSquadsBindingLedger(ledgerBytes);
  const allocation = assertRewardAllocationManifest(
    parseExecutionJson(allocationBytes),
  );
  const plan = assertSettlementExecutionPlan(
    parseExecutionJson(planBytes),
    allocation,
  );
  if (
    allocation.status !== "approved" ||
    allocation.projectId !== input.project ||
    allocation.cycleId !== input.cycle ||
    plan.projectId !== input.project ||
    plan.cycleId !== input.cycle
  )
    throw new TypeError("Expected exact approved project/cycle artifacts");
  const instrument = allocation.fundingBasis?.instrumentId?.match(
    /^squads-v4-vault:solana:([^:]+):([0-9]+):([^:]+)$/u,
  );
  if (!instrument)
    throw new TypeError("Expected frozen Squads funding instrument");
  const [, multisig, index, vault] = instrument;
  const common = {
    projectId: input.project,
    cycleId: input.cycle,
    planSha256: await executionSha256(planBytes),
    multisig,
    vaultIndex: Number(index),
    vault,
    transactionIndex: input.transaction_index,
    proposalAccount: (
      await squadsExecutionAddress(multisig, input.transaction_index, true)
    ).address,
  };
  const root = (
    await squadsExecutionAddress(multisig, input.transaction_index, false)
  ).address;
  const children = [];
  if (input.mode === "batch") {
    for (
      let start = 0;
      start < plan.transfers.length;
      start += MAX_SQUADS_CHILD_TRANSFERS
    ) {
      const transferIndexes = Array.from(
        {
          length: Math.min(
            MAX_SQUADS_CHILD_TRANSFERS,
            plan.transfers.length - start,
          ),
        },
        (_, i) => start + i,
      );
      const transactionIndex: number = children.length + 1;
      const child = await compileSquadsBatchChild(plan, transferIndexes);
      children.push({
        transactionIndex,
        transactionAccount: (
          await squadsBatchChildAddress(
            multisig,
            input.transaction_index,
            transactionIndex,
          )
        ).address,
        messageSha256: await executionSha256(child.storedBytes),
        transferIndexes,
      });
    }
  }
  const binding = assertSquadsExecutionBinding(
    input.mode === "batch"
      ? {
          ...common,
          schemaVersion: "2",
          kind: "squads-batch-execution-binding",
          batchAccount: root,
          children,
        }
      : {
          ...common,
          schemaVersion: "1",
          kind: "squads-execution-binding",
          vaultTransactionAccount: root,
        },
  );
  const ledger = [...baseLedger, binding];
  const context = {
    projectId: input.project,
    allocationBytes,
    planBytes,
    baseLedger,
    ledger,
  };
  await validateSquadsExecutionContext(context);
  const observation = assertSquadsExecutionObservation(
    await verifySquadsExecution(context, options),
    binding,
  );
  if (
    observation.status !== "plan-matched" ||
    observation.instructionVerification !== "verified"
  )
    throw new TypeError("Finalized RPC quorum did not verify the exact plan");
  const candidate = `${JSON.stringify(ledger)}\n`;
  parseSquadsBindingLedger(new TextEncoder().encode(candidate));
  return {
    binding,
    candidate,
    observation,
    allocationSha256: await executionSha256(allocationBytes),
    sourceLedgerSha256: await executionSha256(ledgerBytes),
  };
}

/** Reads only regular committed blobs, with bounded output, never input-selected paths. */
export function readTrustedBindingBlob(
  root: string,
  revision: string,
  path: string,
): Uint8Array {
  if (!/^[a-f0-9]{40}$/u.test(revision))
    throw new TypeError("Expected immutable trusted revision");
  const tree = execFileSync("git", ["ls-tree", revision, "--", path], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 4096,
  });
  if (!tree.startsWith("100644 blob ") || tree.split("\t")[1] !== `${path}\n`)
    throw new TypeError("Expected canonical regular Git blob");
  return execFileSync("git", ["show", `${revision}:${path}`], {
    cwd: root,
    maxBuffer: MAX_EXECUTION_JSON_BYTES,
  });
}

if (import.meta.main) {
  const root = process.cwd();
  const revision = process.env.GITHUB_SHA ?? "";
  if (
    process.env.GITHUB_REF !== "refs/heads/develop" ||
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !==
      revision ||
    execFileSync("git", ["rev-parse", "origin/develop"], {
      encoding: "utf8",
    }).trim() !== revision
  )
    throw new TypeError("Expected exact trusted develop checkout");
  const request = assertSquadsBindingRequest({
    project: process.env.BINDING_PROJECT,
    cycle: process.env.BINDING_CYCLE,
    transaction_index: process.env.BINDING_TRANSACTION_INDEX,
    mode: process.env.BINDING_MODE,
  });
  const directory = process.env.BINDING_EVIDENCE_DIRECTORY;
  if (!directory || !process.env.GITHUB_OUTPUT)
    throw new TypeError("Missing workflow output directory");
  readTrustedBindingBlob(
    root,
    revision,
    `projects/${request.project}/project.json`,
  );
  const ledgerBytes = readTrustedBindingBlob(
    root,
    revision,
    BINDING_LEDGER_PATH,
  );
  const result = await prepareSquadsBinding(request, {
    ledgerBytes,
    allocationBytes: readTrustedBindingBlob(
      root,
      revision,
      `cycles/${request.project}/${request.cycle}/allocation.json`,
    ),
    planBytes: readTrustedBindingBlob(
      root,
      revision,
      `cycles/${request.project}/${request.cycle}/execution-plan.json`,
    ),
  });
  if (
    !Buffer.from(await readFile(join(root, BINDING_LEDGER_PATH))).equals(
      Buffer.from(ledgerBytes),
    )
  )
    throw new TypeError("Working ledger differs from trusted source");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "verification.json"),
    `${JSON.stringify({ revision, request, ...result }, null, 2)}\n`,
    { flag: "wx" },
  );
  await writeFile(join(root, BINDING_LEDGER_PATH), result.candidate);
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `plan_sha256=${result.binding.planSha256}\nallocation_sha256=${result.allocationSha256}\n`,
  );
}
