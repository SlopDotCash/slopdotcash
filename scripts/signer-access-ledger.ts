/** Complete immutable Git-tree report history. Never payment authorization. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { assertProjectDefinition } from "../src/lib/project-schema.mjs";
import { canonicalFundingDecisionBytes } from "./check-funding-record-pr";
import {
  assertSignerAccessReport,
  readSignerCommit,
  type SignerAccessReport,
  verifySignerAccess,
} from "./verify-signer-access";

const SHA = /^[a-f0-9]{40}$/u;
const PATH =
  /^funding\/([a-z0-9][a-z0-9-]{0,47})\/signer-access\/([a-f0-9]{64})\.json$/u;
const MAX_BYTES = 16 * 1024;
const verifiedLedgers = new WeakSet<object>();
export interface SignerAccessLedger {
  readonly baseSha: string;
  readonly headSha: string;
  readonly reports: readonly SignerAccessReport[];
}

function git(root: string, args: string[], maxBuffer = 16 * 1024 * 1024) {
  return execFileSync(
    "git",
    ["--no-replace-objects", "--literal-pathspecs", ...args],
    {
      cwd: root,
      timeout: 30_000,
      maxBuffer,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function entries(root: string, revision: string, path: string) {
  const result = new Map<string, string>();
  for (const line of git(root, ["ls-tree", "-r", "-z", revision, "--", path])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)) {
    const match = /^100644 blob ([a-f0-9]{40})\t(.+)$/u.exec(line);
    if (!match) throw new TypeError("Signer ledger requires regular Git blobs");
    result.set(match[2], match[1]);
  }
  return result;
}

function blob(root: string, oid: string, limit: number) {
  const size = Number(
    git(root, ["cat-file", "-s", oid], 1024).toString().trim(),
  );
  if (!Number.isSafeInteger(size) || size <= 0 || size > limit)
    throw new TypeError("Signer ledger blob exceeds its byte limit");
  return git(root, ["cat-file", "blob", oid], limit);
}

function json(bytes: Buffer): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export function signerReportPath(report: SignerAccessReport): string {
  const digest = createHash("sha256")
    .update(canonicalFundingDecisionBytes(report))
    .digest("hex");
  return `funding/${report.projectId}/signer-access/${digest}.json`;
}

/**
 * Reads every report from head, preserving every base blob. The caller must
 * resolve base to current trusted develop; a proposed manifest is not authority.
 * All reports, including historical loss, are authenticated before returning.
 */
export async function readSignerAccessLedger(input: {
  root: string;
  baseSha: string;
  headSha: string;
  now: string;
  readCommit?: typeof readSignerCommit;
}): Promise<SignerAccessLedger> {
  if (!SHA.test(input.baseSha) || !SHA.test(input.headSha))
    throw new TypeError("Signer ledger requires immutable Git SHAs");
  if (
    !Number.isFinite(Date.parse(input.now)) ||
    new Date(input.now).toISOString() !== input.now
  )
    throw new TypeError("Signer ledger requires canonical current time");
  git(input.root, [
    "merge-base",
    "--is-ancestor",
    input.baseSha,
    input.headSha,
  ]);
  const history = (revision: string) =>
    new Map(
      [...entries(input.root, revision, "funding")].filter(([path]) =>
        /^funding\/[^/]+\/signer-access(?:\/|$)/u.test(path),
      ),
    );
  const base = history(input.baseSha);
  const head = history(input.headSha);
  for (const [path, oid] of base) {
    if (head.get(path) !== oid)
      throw new TypeError(
        "Signer report history is append-only; omission or rewriting is forbidden",
      );
  }
  const reports: SignerAccessReport[] = [];
  const sources = new Set<string>();
  for (const [path, oid] of head) {
    if (!PATH.test(path))
      throw new TypeError("Noncanonical signer report path");
    const bytes = blob(input.root, oid, MAX_BYTES);
    const report = assertSignerAccessReport(json(bytes));
    if (
      !bytes.equals(Buffer.from(canonicalFundingDecisionBytes(report))) ||
      signerReportPath(report) !== path
    )
      throw new TypeError(
        "Signer report bytes and content-addressed path must be canonical",
      );
    const source = `${report.sourceRepository.toLowerCase()}@${report.sourceCommit}`;
    if (sources.has(source))
      throw new TypeError("Duplicate signer report source");
    sources.add(source);
    git(input.root, [
      "merge-base",
      "--is-ancestor",
      report.manifestRevision,
      input.baseSha,
    ]);
    const manifestPath = `projects/${report.projectId}/project.json`;
    const manifestEntries = entries(
      input.root,
      report.manifestRevision,
      manifestPath,
    );
    const manifestOid = manifestEntries.get(manifestPath);
    if (!manifestOid || manifestEntries.size !== 1)
      throw new TypeError(
        "Signer report requires its reviewed project manifest",
      );
    const project = assertProjectDefinition(
      json(blob(input.root, manifestOid, 1024 * 1024)),
    );
    reports.push(
      await verifySignerAccess({
        report,
        project,
        manifestRevision: report.manifestRevision,
        now: input.now,
        readCommit: input.readCommit,
      }),
    );
  }
  const ledger = Object.freeze({
    baseSha: input.baseSha,
    headSha: input.headSha,
    reports: Object.freeze(reports.map((report) => Object.freeze(report))),
  });
  verifiedLedgers.add(ledger);
  return ledger;
}

/** One necessary settlement check, never sufficient payment authorization. */
export function assertSignerCapabilityForSettlement(
  ledger: SignerAccessLedger,
  allocation: {
    projectId: string;
    cycleId: string;
    fundingBasis?: { instrumentId: string | null };
  },
  now: string,
) {
  const instrumentId = allocation.fundingBasis?.instrumentId;
  if (!instrumentId?.startsWith("squads-v4-vault:")) return;
  const result = signerCapabilityState(
    ledger,
    { ...allocation, instrumentId },
    now,
  );
  if (result.state !== "both-signers-current")
    throw new TypeError(
      `Settlement blocked by signer capability state: ${result.state}`,
    );
}

/** Fetch before evaluating: stale local refs cannot hide an accepted loss. */
export async function readCurrentSignerAccessLedger(
  root: string,
  readCommit: typeof readSignerCommit = readSignerCommit,
) {
  git(root, [
    "fetch",
    "--no-tags",
    "origin",
    "+refs/heads/develop:refs/remotes/origin/develop",
  ]);
  const current = git(root, ["rev-parse", "refs/remotes/origin/develop"])
    .toString()
    .trim();
  return readSignerAccessLedger({
    root,
    baseSha: current,
    headSha: current,
    now: new Date().toISOString(),
    readCommit,
  });
}

/** Diagnostic only: signer capability does not prove backing or payability. */
export function signerCapabilityState(
  ledger: SignerAccessLedger,
  identity: { projectId: string; cycleId: string; instrumentId: string },
  now: string,
) {
  if (!verifiedLedgers.has(ledger))
    throw new TypeError(
      "Signer state requires the complete authenticated ledger",
    );
  if (!Number.isFinite(Date.parse(now)) || new Date(now).toISOString() !== now)
    throw new TypeError("Signer state requires canonical current time");
  const relevant = ledger.reports.filter(
    (report) =>
      report.projectId === identity.projectId &&
      report.cycleId === identity.cycleId &&
      report.instrumentId === identity.instrumentId,
  );
  if (relevant.some((report) => report.reportedAt > now))
    throw new TypeError("Signer state cannot include future reports");
  const losses = relevant
    .filter((report) => report.capability === "lost-access")
    .sort(
      (a, b) =>
        a.reportedAt.localeCompare(b.reportedAt) ||
        signerReportPath(a).localeCompare(signerReportPath(b)),
    );
  if (losses.length)
    return {
      state: "inaccessible" as const,
      losses,
      paymentAuthorized: false as const,
    };
  const current = (["funder", "steward"] as const).every((role) =>
    relevant.some(
      (report) =>
        report.role === role &&
        report.capability === "can-sign" &&
        report.expiresAt !== null &&
        report.expiresAt > now,
    ),
  );
  return {
    state: current ? ("both-signers-current" as const) : ("unknown" as const),
    losses,
    paymentAuthorized: false as const,
  };
}
