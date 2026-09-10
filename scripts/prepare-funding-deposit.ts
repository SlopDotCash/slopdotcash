/** Trusted-develop evidence preparation. No signer, funding activation or payout. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProjectFundingIndex } from "../src/lib/funding";
import { isSolanaTransactionId } from "../src/lib/funding-address.mjs";
import {
  assertFundingCommitments,
  assertProjectCommitmentRecord,
} from "../src/lib/funding-commitment";
import { findProject, type ProjectDefinition } from "../src/lib/projects.mjs";
import { buildFundingIndex } from "./sync-funding-index";
import { verifyCommitmentSquads } from "./verify-commitment-squads";
import { verifyFundingSolana } from "./verify-funding-solana";
import { writeNewJsonFile } from "./write-new-file";

export interface FundingDepositRequest {
  project: string;
  cycle: string;
  signature: string;
  /** Blank/omitted uses the reviewed instrument's monthly commitment amount. */
  amountMinor?: string;
}
export function assertFundingDepositRequest(
  value: FundingDepositRequest,
): FundingDepositRequest {
  if (
    Object.keys(value).some(
      (key) => !["project", "cycle", "signature", "amountMinor"].includes(key),
    ) ||
    typeof value.project !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value.project) ||
    value.project.length > 48 ||
    typeof value.cycle !== "string" ||
    !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(value.cycle) ||
    !isSolanaTransactionId(value.signature) ||
    (value.amountMinor !== undefined &&
      value.amountMinor !== "" &&
      (typeof value.amountMinor !== "string" ||
        !/^[1-9]\d{0,19}$/u.test(value.amountMinor) ||
        BigInt(value.amountMinor) > (1n << 64n) - 1n))
  )
    throw new TypeError(
      "Expected canonical project, YYYY-MM cycle, public Solana signature and optional positive integer USDC micro-units",
    );
  return {
    project: value.project,
    cycle: value.cycle,
    signature: value.signature,
    ...(value.amountMinor ? { amountMinor: value.amountMinor } : {}),
  };
}

export async function createFundingDepositEvidence(
  untrusted: FundingDepositRequest,
  context: {
    project: ProjectDefinition;
    manifestRevision: string;
    history: Pick<ProjectFundingIndex, "records" | "commitments">;
  },
  options: {
    verifyDeposit?: typeof verifyCommitmentSquads;
    verifyTransfer?: typeof verifyFundingSolana;
  } = {},
) {
  const request = assertFundingDepositRequest(untrusted);
  const project = context.project;
  if (
    project.id !== request.project ||
    project.reward.kind !== "monthly-pool" ||
    !/^[a-f0-9]{40}$/u.test(context.manifestRevision)
  )
    throw new TypeError(
      "Deposit needs an exact reviewed monthly-pool project revision",
    );
  const instruments = assertFundingCommitments(
    project.funding.commitments ?? [],
  );
  const matching = instruments.filter(
    (row) =>
      row.monthlyCommitment?.cycleId === request.cycle &&
      row.replacedAt === null,
  );
  if (matching.length !== 1 || matching[0].kind !== "squads-v4-vault")
    throw new TypeError(
      "Cycle must have exactly one reviewed, unreplaced Solana Squads instrument; register it through GitHub first",
    );
  const instrument = matching[0];
  if (project.reward.rewardStartAt >= instrument.deadline)
    throw new TypeError(
      "Project was not launched during this commitment cycle",
    );
  const amountMinor =
    request.amountMinor ?? instrument.monthlyCommitment?.amountMinor;
  if (
    !amountMinor ||
    !/^[1-9]\d{0,19}$/u.test(amountMinor) ||
    BigInt(amountMinor) > (1n << 64n) - 1n
  )
    throw new TypeError(
      "Deposit amount must be a positive u64 in USDC micro-units",
    );
  if (
    [...context.history.records, ...context.history.commitments].some(
      (row) =>
        row.network === "solana" && row.transactionId === request.signature,
    )
  )
    throw new TypeError(
      "Signature already has funding evidence; use the separate reviewed correction process",
    );
  const [deposit, transfer] = await Promise.all([
    (options.verifyDeposit ?? verifyCommitmentSquads)({
      mode: "deposit",
      amountMinor,
      signature: request.signature,
      multisig: instrument.multisig,
      vault: instrument.vault,
      vaultIndex: instrument.vaultIndex,
      funderMember: instrument.funderMember,
      stewardMember: instrument.stewardMember,
    }),
    (options.verifyTransfer ?? verifyFundingSolana)({
      amountMinor,
      signature: request.signature,
      recipient: instrument.vault,
    }),
  ]);
  if (
    deposit.mode !== "deposit" ||
    deposit.state !== "verified-on-chain" ||
    transfer.state !== "verified-on-chain" ||
    deposit.chainEvidence.signature !== request.signature ||
    transfer.chainEvidence.signature !== request.signature ||
    deposit.chainEvidence.slot !== transfer.chainEvidence.slot ||
    deposit.chainEvidence.blockTime !== transfer.chainEvidence.blockTime
  )
    throw new TypeError(
      "Deposit and transfer verifiers did not agree on finalized transaction identity",
    );
  const observedAt = new Date(
    deposit.chainEvidence.blockTime * 1000,
  ).toISOString();
  if (Date.parse(observedAt) > Date.parse(deposit.verifier.checkedAt))
    throw new TypeError("Deposit timestamp is in the future");
  const recordId = `cmt_${createHash("sha256").update(`solana:${request.signature}`).digest("hex")}`;
  const record = assertProjectCommitmentRecord(
    {
      schemaVersion: "1",
      kind: "project-commitment",
      recordId,
      projectId: request.project,
      manifestRevision: context.manifestRevision,
      event: "deposit",
      network: "solana",
      asset: "USDC",
      instrument: {
        funderMember: instrument.funderMember,
        multisig: instrument.multisig,
        stewardMember: instrument.stewardMember,
        vault: instrument.vault,
        vaultIndex: instrument.vaultIndex,
      },
      transactionId: request.signature,
      amountMinor,
      observedAt,
      state: "verified-on-chain",
      finality: deposit.finality,
      verifier: deposit.verifier,
      supersedes: null,
    },
    instruments,
  );
  return {
    record,
    recordPath: `funding/${project.id}/commitments/solana/${request.signature}/${recordId}.json`,
    evidence: {
      schemaVersion: 1,
      kind: "funding-deposit-verification",
      request: { ...request, amountMinor },
      manifestRevision: context.manifestRevision,
      instrument,
      deposit,
      transfer,
      paymentAuthorized: false,
      fundingActivated: false,
    },
  };
}

/** No-replace record write; the evidence bundle is retained by Actions. */
export async function writeFundingDepositEvidence(
  root: string,
  evidenceDirectory: string,
  result: Awaited<ReturnType<typeof createFundingDepositEvidence>>,
) {
  await mkdir(evidenceDirectory, { recursive: true });
  await writeNewJsonFile(
    join(evidenceDirectory, "verification.json"),
    result.evidence,
    "Evidence bundle already exists",
  );
  await writeNewJsonFile(
    join(root, result.recordPath),
    result.record,
    "Funding evidence already exists; refusing to replace history",
  );
}

if (import.meta.main) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (
    process.env.GITHUB_REF !== "refs/heads/develop" ||
    process.env.GITHUB_SHA !== revision
  )
    throw new TypeError(
      "Run funding-deposit preparation from the exact dispatched develop checkout",
    );
  const request = assertFundingDepositRequest({
    project: process.env.DEPOSIT_PROJECT ?? "",
    cycle: process.env.DEPOSIT_CYCLE ?? "",
    signature: process.env.DEPOSIT_SIGNATURE ?? "",
    amountMinor: process.env.DEPOSIT_AMOUNT_MINOR ?? "",
  });
  const project = findProject(request.project);
  if (!project) throw new TypeError("Unknown project");
  // Bind the source project bytes as well as the immutable commit reference.
  const manifestBytes = await readFile(
    join(root, "projects", project.id, "project.json"),
  );
  const committed = execFileSync(
    "git",
    ["show", `${revision}:projects/${project.id}/project.json`],
    { cwd: root },
  );
  if (!manifestBytes.equals(committed))
    throw new TypeError(
      "Project working-tree bytes differ from trusted develop",
    );
  const result = await createFundingDepositEvidence(request, {
    project,
    manifestRevision: revision,
    history: await buildFundingIndex(),
  });
  const evidenceDirectory = process.env.DEPOSIT_EVIDENCE_DIRECTORY;
  if (!evidenceDirectory || !process.env.GITHUB_OUTPUT)
    throw new TypeError("Workflow evidence directory/output missing");
  await writeFundingDepositEvidence(root, evidenceDirectory, result);
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `record_path=${result.recordPath}\nrecord_id=${result.record.recordId}\namount_minor=${result.record.amountMinor}\n`,
  );
}
