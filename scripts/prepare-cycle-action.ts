/** Trusted workflow adapter. Existing CLIs remain the lifecycle authority. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  allocationFundingMinor,
  deriveAllocationFundingBasis,
} from "../src/lib/allocation-funding";
import { assertCommittedFundingBound } from "../src/lib/funding-commitment";
import { assertFundingPreparation } from "../src/lib/funding-review-data";
import {
  assertPaymentReservationTransition,
  PAYMENT_RESERVATION_PATH,
  parsePaymentReservationLedger,
} from "../src/lib/payment-reservations";
import {
  assertProjectPaymentsEnabled,
  findProject,
} from "../src/lib/projects.mjs";
import { parseFinalizeArguments } from "./finalize-reward-cycle";
import { loadCanonicalPaymentReservation } from "./load-payment-reservation";
import { parsePaymentReservationArguments } from "./prepare-payment-reservation";
import { parsePrepareRewardCycleArguments } from "./prepare-reward-cycle";
import {
  assertSignerCapabilityForSettlement,
  readCurrentSignerAccessLedger,
} from "./signer-access-ledger";
import { buildFundingIndex } from "./sync-funding-index";
import { parseVerifySettlementArguments } from "./verify-settlement";
import { writeNewFile } from "./write-new-file";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export interface CycleActionRequest {
  action:
    | "propose"
    | "finalize-allocation"
    | "reserve-settlement"
    | "prepare-settlement"
    | "verify-settlement";
  project: string;
  cycle: string;
  sourceSha256: string;
  transactionsJson: string;
}
export function parseCycleActionRequest(
  env: Record<string, string | undefined>,
): CycleActionRequest {
  const action = env.CYCLE_ACTION;
  const project = env.CYCLE_PROJECT ?? "";
  const cycle = env.CYCLE_MONTH ?? "";
  const sourceSha256 = env.CYCLE_SOURCE_SHA256 ?? "";
  const transactionsJson = env.CYCLE_TRANSACTIONS_JSON ?? "";
  if (
    action !== "propose" &&
    action !== "finalize-allocation" &&
    action !== "reserve-settlement" &&
    action !== "prepare-settlement" &&
    action !== "verify-settlement"
  )
    throw new TypeError("Unsupported cycle action");
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(project) ||
    findProject(project)?.reward.kind !== "monthly-pool"
  )
    throw new TypeError("Unknown monthly project");
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/u.test(cycle) ||
    !/^[a-f0-9]{64}$/u.test(sourceSha256)
  )
    throw new TypeError("Exact cycle and source SHA-256 are required");
  if (
    action !== "verify-settlement"
      ? transactionsJson !== ""
      : transactionsJson.length === 0 ||
        Buffer.byteLength(transactionsJson) > 60000
  )
    throw new TypeError(
      "Transaction evidence is required only for verification and limited to 60000 bytes",
    );
  // Canonical CLI parsers reject unsupported project/cycle inputs. No timestamp
  // override is exposed: finalization uses the trusted runner's current time.
  const args = ["--project", project, "--cycle", cycle];
  if (action === "propose") parsePrepareRewardCycleArguments(args);
  else if (action === "finalize-allocation") parseFinalizeArguments(args);
  else if (action === "verify-settlement") parseVerifySettlementArguments(args);
  else if (action === "reserve-settlement")
    parsePaymentReservationArguments([
      ...args,
      "--output",
      "evidence/cycle-action/reservation-candidate.json",
    ]);
  return { action, project, cycle, sourceSha256, transactionsJson };
}
async function regularBytes(path: string) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024)
    throw new TypeError("Invalid cycle source file");
  return readFile(path);
}
export async function assertFundedProposalReady(
  projectId: string,
  cycleId: string,
  root = ROOT,
) {
  const project = assertProjectPaymentsEnabled(projectId, cycleId);
  const fundingBasis = deriveAllocationFundingBasis(project, cycleId);
  if (allocationFundingMinor(fundingBasis) <= 0n || !fundingBasis.instrumentId)
    throw new TypeError(
      "Funded proposal requires positive canonical cycle funding",
    );
  const funding = await buildFundingIndex({ repositoryRoot: root });
  assertCommittedFundingBound(
    projectId,
    { fundingState: "committed", committedMinor: fundingBasis.committedMinor },
    project.funding.commitments?.filter(
      (instrument) =>
        instrument.replacedAt === null &&
        instrument.monthlyCommitment?.cycleId === cycleId,
    ) ?? [],
    funding.commitments.filter((record) => record.projectId === projectId),
  );
  assertSignerCapabilityForSettlement(
    await readCurrentSignerAccessLedger(root),
    { projectId, cycleId, fundingBasis },
    new Date().toISOString(),
  );
}

export async function prepareCycleAction(
  request: CycleActionRequest,
  options: {
    root?: string;
    snapshotPath?: string;
    run?: (script: string, args: string[]) => Promise<void>;
  } = {},
) {
  const root = resolve(options.root ?? ROOT);
  // Revalidate even when called programmatically rather than through the CLI.
  const input = parseCycleActionRequest({
    CYCLE_ACTION: request.action,
    CYCLE_PROJECT: request.project,
    CYCLE_MONTH: request.cycle,
    CYCLE_SOURCE_SHA256: request.sourceSha256,
    CYCLE_TRANSACTIONS_JSON: request.transactionsJson,
  });
  const directory = join(root, "cycles", input.project, input.cycle);
  const proposing = input.action === "propose";
  if (options.snapshotPath && !proposing)
    throw new TypeError("Local snapshot is supported only for propose");
  if (proposing)
    await assertFundedProposalReady(input.project, input.cycle, root);
  const sourceName = proposing
    ? "source-snapshot.json"
    : input.action === "finalize-allocation"
      ? "proposal.json"
      : input.action === "prepare-settlement" ||
          input.action === "reserve-settlement"
        ? "allocation.json"
        : "execution-plan.json";
  const outputName = proposing
    ? "proposal.json"
    : input.action === "finalize-allocation"
      ? "allocation.json"
      : input.action === "prepare-settlement"
        ? "execution-plan.json"
        : "settlement.json";
  const before = new Map<string, Buffer>();
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (proposing && (error as NodeJS.ErrnoException).code === "ENOENT")
      entries = [];
    else throw error;
  }
  for (const entry of entries)
    before.set(entry, await regularBytes(join(directory, entry)));
  if (proposing && before.size)
    throw new TypeError("Refusing to replace an existing or partial cycle");
  const snapshotPath = options.snapshotPath
    ? resolve(options.snapshotPath)
    : join(root, "evidence/input-snapshot/source-snapshot.json");
  const source = proposing
    ? await regularBytes(snapshotPath)
    : before.get(sourceName);
  if (!source || sha256(source) !== input.sourceSha256)
    throw new TypeError(
      "Published source hash does not match exact source bytes",
    );
  if (proposing) {
    const preparation = assertFundingPreparation(
      JSON.parse(
        (
          await regularBytes(
            join(
              root,
              "funding/preparations",
              `${input.project}-${input.cycle}.json`,
            ),
          )
        ).toString("utf8"),
      ),
    );
    if (
      preparation.projectId !== input.project ||
      preparation.cycleId !== input.cycle ||
      preparation.sourceSnapshotSha256 !== input.sourceSha256
    )
      throw new TypeError(
        "Snapshot differs from the selected reviewed preparation",
      );
  }
  if (before.has(outputName))
    throw new TypeError("Refusing to replace existing lifecycle output");
  const evidenceDirectory = join(root, "evidence/cycle-action");
  await mkdir(dirname(evidenceDirectory), { recursive: true });
  await mkdir(evidenceDirectory); // Unique evidence bundle; never overwrite another action.
  const run =
    options.run ??
    (async (script: string, args: string[]) => {
      const result = await promisify(execFile)(
        "bun",
        [join(root, "scripts", script), ...args],
        { cwd: root, maxBuffer: 4 * 1024 * 1024 },
      );
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
    });
  let createdTransactions = false;
  try {
    if (input.action === "reserve-settlement") {
      const ledgerPath = join(root, PAYMENT_RESERVATION_PATH);
      const ledgerBefore = await regularBytes(ledgerPath);
      const candidatePath = join(
        evidenceDirectory,
        "reservation-candidate.json",
      );
      await run("prepare-payment-reservation.ts", [
        "--project",
        input.project,
        "--cycle",
        input.cycle,
        "--output",
        candidatePath,
      ]);
      const ledgerAfter = await regularBytes(candidatePath);
      const prior = parsePaymentReservationLedger(ledgerBefore);
      const next = assertPaymentReservationTransition(
        prior,
        parsePaymentReservationLedger(ledgerAfter),
      );
      if (next.length !== prior.length + 1)
        throw new TypeError(
          "Reservation action must append exactly one record",
        );
      const added = next[next.length - 1];
      if (
        added.projectId !== input.project ||
        added.cycleId !== input.cycle ||
        added.allocationSha256 !== input.sourceSha256
      )
        throw new TypeError(
          "Reservation does not bind the selected allocation",
        );
      const cycleAfter = await readdir(directory);
      if (
        cycleAfter.length !== before.size ||
        cycleAfter.some((name) => !before.has(name))
      )
        throw new TypeError(
          "Reservation action must not release a plan or change cycle files",
        );
      for (const [name, bytes] of before)
        if (!(await regularBytes(join(directory, name))).equals(bytes))
          throw new TypeError(
            "Reservation action modified an immutable cycle source",
          );
      if (!(await regularBytes(ledgerPath)).equals(ledgerBefore))
        throw new TypeError(
          "Global reservation ledger changed during drafting",
        );
      await rename(candidatePath, ledgerPath);
      const archived = new Map([
        ...before,
        ["payment-reservations-before.json", ledgerBefore],
        ["payment-reservations-after.json", ledgerAfter],
      ]);
      const checksums: string[] = [];
      for (const [name, bytes] of archived) {
        await writeFile(join(evidenceDirectory, name), bytes, { flag: "wx" });
        checksums.push(`${sha256(bytes)}  ${name}`);
      }
      await writeFile(
        join(evidenceDirectory, "SHA256SUMS"),
        `${checksums.join("\n")}\n`,
        { flag: "wx" },
      );
      const result = {
        action: input.action,
        project: input.project,
        cycle: input.cycle,
        sourceSha256: input.sourceSha256,
        newFiles: [] as string[],
        modifiedFiles: [PAYMENT_RESERVATION_PATH],
      };
      await writeFile(
        join(evidenceDirectory, "action.json"),
        `${JSON.stringify(result, null, 2)}\n`,
        { flag: "wx" },
      );
      return result;
    }
    if (input.action === "verify-settlement") {
      // Full evidence schema, intent coverage, signature uniqueness and on-chain
      // reconciliation are checked by verify-settlement.ts, not reimplemented.
      const value: unknown = JSON.parse(input.transactionsJson);
      const bytes = `${JSON.stringify(value, null, 2)}\n`;
      const existing = before.get("transactions.json");
      if (existing) {
        if (
          JSON.stringify(JSON.parse(existing.toString("utf8"))) !==
          JSON.stringify(value)
        )
          throw new TypeError(
            "Refusing different published transaction evidence",
          );
      } else {
        await writeNewFile(
          join(directory, "transactions.json"),
          bytes,
          "Transaction evidence already exists",
        );
        createdTransactions = true;
      }
    }
    const args = ["--project", input.project, "--cycle", input.cycle];
    if (proposing) args.push("--snapshot", snapshotPath);
    if (input.action === "prepare-settlement") {
      const loaded = await loadCanonicalPaymentReservation(
        root,
        input.project,
        input.cycle,
      );
      args.push(
        "--source-wallet",
        loaded.instrument.vault,
        "--fee-wallet",
        loaded.policy.feeRecipient,
      );
    }
    await run(
      proposing
        ? "prepare-reward-cycle.ts"
        : input.action === "finalize-allocation"
          ? "finalize-reward-cycle.ts"
          : input.action === "prepare-settlement"
            ? "prepare-settlement-plan.ts"
            : "verify-settlement.ts",
      args,
    );
    await run("sync-cycle-index.ts", []);
    for (const [name, bytes] of before)
      if (!(await regularBytes(join(directory, name))).equals(bytes))
        throw new TypeError("Lifecycle action modified an immutable source");
    const allowedNew = new Set([
      outputName,
      ...(proposing ? ["source-snapshot.json"] : []),
      ...(createdTransactions ? ["transactions.json"] : []),
    ]);
    const after = await readdir(directory);
    if (
      !after.includes(outputName) ||
      after.some((name) => !before.has(name) && !allowedNew.has(name))
    )
      throw new TypeError("Unexpected lifecycle output scope");
    const checksums: string[] = [];
    for (const name of after.sort()) {
      const bytes = await regularBytes(join(directory, name));
      await writeFile(join(evidenceDirectory, name), bytes, { flag: "wx" });
      checksums.push(`${sha256(bytes)}  ${name}`);
    }
    await writeFile(
      join(evidenceDirectory, "SHA256SUMS"),
      `${checksums.join("\n")}\n`,
      { flag: "wx" },
    );
    const result = {
      action: input.action,
      project: input.project,
      cycle: input.cycle,
      sourceSha256: input.sourceSha256,
      newFiles: [...allowedNew]
        .sort()
        .map((name) => `cycles/${input.project}/${input.cycle}/${name}`),
    };
    await writeFile(
      join(evidenceDirectory, "action.json"),
      `${JSON.stringify(result, null, 2)}\n`,
      { flag: "wx" },
    );
    return result;
  } catch (error) {
    // Failed verification must not leave newly supplied signatures looking like
    // a completed lifecycle transition. No pre-existing files are removed.
    if (createdTransactions)
      await rm(join(directory, "transactions.json"), { force: true });
    await rm(evidenceDirectory, { recursive: true, force: true });
    throw error;
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (
    args.length &&
    (args.length !== 2 ||
      args[0] !== "--snapshot" ||
      !args[1] ||
      args[1].startsWith("--"))
  )
    throw new TypeError(
      "Usage: prepare-cycle-action.ts [--snapshot /path/exact-source.json]",
    );
  await prepareCycleAction(parseCycleActionRequest(process.env), {
    snapshotPath: args[1],
  });
}
