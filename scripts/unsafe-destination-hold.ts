/** A maintainer-invoked proposal draft; a signed report alone never changes a row. */
import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import {
  assertRewardAllocationManifest,
  assertUnsafeDestinationReport,
  feeForPrincipal,
  sameWalletObservation,
  type UnsafeDestinationReport,
  unsafeDestinationReportMessage,
} from "../src/lib/rewards";

const execFileAsync = promisify(execFile);
const QUERY = `query($owner:String!,$name:String!,$oid:String!){repository(owner:$owner,name:$name){object(expression:$oid){... on Commit{oid message signature{isValid state signer{id databaseId}}}}}}`;
type ReadCommit = (repository: string, commit: string) => Promise<unknown>;

async function readSignedCommit(
  repository: string,
  commit: string,
): Promise<unknown> {
  const [owner, name] = repository.split("/");
  const { stdout } = await execFileAsync(
    "gh",
    [
      "api",
      "graphql",
      "-f",
      `query=${QUERY}`,
      "-f",
      `owner=${owner}`,
      "-f",
      `name=${name}`,
      "-f",
      `oid=${commit}`,
    ],
    { timeout: 30_000, maxBuffer: 128 * 1024 },
  );
  const envelope = JSON.parse(stdout);
  if (envelope.errors)
    throw new TypeError("GitHub could not verify the signed wallet report");
  return envelope.data?.repository?.object;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Signed wallet report evidence is missing");
  return value as Record<string, unknown>;
}

/** Validate the signer, never infer authority from commit author email or login. */
export async function verifyUnsafeDestinationReport(
  report: UnsafeDestinationReport,
  readCommit: ReadCommit = readSignedCommit,
): Promise<void> {
  const normalized = assertUnsafeDestinationReport(report, {
    id: report.wallet.sourceActorId,
    login: "reporter",
  });
  const commit = object(
    await readCommit(normalized.sourceRepository, normalized.sourceCommit),
  );
  const signature = object(commit.signature);
  const signer = object(signature.signer);
  if (
    commit.oid !== normalized.sourceCommit ||
    signature.isValid !== true ||
    signature.state !== "VALID" ||
    (signer.id !== normalized.wallet.sourceActorId &&
      String(signer.databaseId) !== normalized.wallet.sourceActorId) ||
    typeof commit.message !== "string" ||
    commit.message.replace(/\n$/u, "") !==
      unsafeDestinationReportMessage(normalized)
  ) {
    throw new TypeError(
      "Signed wallet report does not bind the contributor and original destination",
    );
  }
}

export async function applyUnsafeDestinationHold(input: {
  proposal: unknown;
  report: unknown;
  reason: string;
  now: string;
  readCommit?: ReadCommit;
}) {
  const proposal = assertRewardAllocationManifest(input.proposal);
  const rawReport = object(input.report);
  const row = proposal.allocations.find(
    (candidate) => candidate.intentId === rawReport.intentId,
  );
  if (
    !row ||
    proposal.status !== "proposed" ||
    !row.wallet ||
    !("sourceClaimId" in row.wallet)
  )
    throw new TypeError(
      "Hold requires an open proposal and its actor-bound wallet claim",
    );
  const report = assertUnsafeDestinationReport(
    { ...rawReport, verifiedAt: input.now },
    row.actor,
  );
  if (
    report.projectId !== proposal.projectId ||
    report.cycleId !== proposal.cycleId ||
    !sameWalletObservation(row.wallet, report.wallet) ||
    report.suggestedMinor !== row.suggestedMinor ||
    Date.parse(report.wallet.observedAt) > Date.parse(proposal.generatedAt) ||
    Date.parse(input.now) < Date.parse(proposal.generatedAt) ||
    Date.parse(input.now) > Date.parse(proposal.review.endsAt)
  ) {
    throw new TypeError(
      "Hold report does not match the original proposal during review",
    );
  }
  await verifyUnsafeDestinationReport(report, input.readCommit);
  const reports = row.unsafeDestinationReports ?? [];
  if (
    reports.some((candidate) => candidate.sourceCommit === report.sourceCommit)
  )
    throw new TypeError("Report already appears in the reviewed proposal");
  row.unsafeDestinationReports = [...reports, report];
  row.hold = { kind: "unsafe-destination", sourceCommit: report.sourceCommit };
  row.state = "held";
  row.approvedMinor = "0";
  row.adjustmentReason = input.reason;
  row.platformApproval = null;
  if (row.lines) {
    row.lines.sharedPool.approvedMinor = "0";
    row.lines.reviewBudget.approvedMinor = "0";
  }
  proposal.totals.approvedMinor = proposal.allocations
    .reduce((sum, candidate) => sum + BigInt(candidate.approvedMinor), 0n)
    .toString();
  proposal.totals.feeMinor = feeForPrincipal(
    proposal.totals.approvedMinor,
    proposal.feeBasisPoints,
  );
  if (proposal.rewardLines) {
    for (const line of ["sharedPool", "reviewBudget"] as const) {
      proposal.rewardLines[line].approvedMinor = proposal.allocations
        .reduce(
          (sum, candidate) =>
            sum + BigInt(candidate.lines?.[line].approvedMinor ?? "0"),
          0n,
        )
        .toString();
    }
  }
  return assertRewardAllocationManifest(proposal);
}

async function readJson(path: string): Promise<unknown> {
  const stats = await lstat(path);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 8 * 1024 * 1024)
    throw new TypeError("Expected a bounded regular JSON file");
  return JSON.parse(await readFile(path, "utf8"));
}

if (import.meta.main) {
  if (process.argv[2] === "--message") {
    const [proposalPath, intentId, reportedAt, ...extra] =
      process.argv.slice(3);
    if (
      !proposalPath ||
      !intentId ||
      !reportedAt ||
      extra.length ||
      !Number.isFinite(Date.parse(reportedAt)) ||
      new Date(reportedAt).toISOString() !== reportedAt
    )
      throw new TypeError(
        "Usage: unsafe-destination-hold.ts --message <proposal.json> <intent-id> <UTC-report-time>",
      );
    const proposal = assertRewardAllocationManifest(
      await readJson(proposalPath),
    );
    const row = proposal.allocations.find(
      (candidate) => candidate.intentId === intentId,
    );
    if (!row?.wallet || !("sourceClaimId" in row.wallet))
      throw new TypeError(
        "Report requires the proposal's actor-bound Slop wallet claim",
      );
    process.stdout.write(
      `${unsafeDestinationReportMessage({ projectId: proposal.projectId, cycleId: proposal.cycleId, intentId, suggestedMinor: row.suggestedMinor, reportedAt, wallet: row.wallet })}\n`,
    );
  } else {
    const [proposalPath, reportPath, reason, ...extra] = process.argv.slice(2);
    if (!proposalPath || !reportPath || !reason || extra.length)
      throw new TypeError(
        "Usage: unsafe-destination-hold.ts <proposal.json> <signed-report.json> <maintainer-reason>",
      );
    const result = await applyUnsafeDestinationHold({
      proposal: await readJson(proposalPath),
      report: await readJson(reportPath),
      reason,
      now: new Date().toISOString(),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}
