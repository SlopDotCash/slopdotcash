/** Trusted-base, read-only verification of narrowly scoped funding-record PRs. */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertProjectFundingAddresses,
  assertProjectFundingRecord,
  type ProjectFundingRecord,
} from "../src/lib/funding";
import {
  assertHistoricalProjectDefinition,
  assertProjectDefinition,
} from "../src/lib/project-schema.mjs";
import { assertFundingBlockTime } from "./funding-block-time";
import { verifyFundingBitcoin } from "./verify-funding-bitcoin";
import { verifyFundingEvm } from "./verify-funding-evm";
import { verifyFundingSolana } from "./verify-funding-solana";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHA = /^[0-9a-f]{40}$/u;
const RECORD_PATH =
  /^funding\/([a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?)\/(base|bitcoin|ethereum|solana)\/([A-Za-z0-9]+)\/(fund_[a-z0-9][a-z0-9_-]{6,79})\.json$/u;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_RECORDS = 20;
export const FUNDING_RECORD_GATE_VERSION = "funding-record-gate-v1";

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
interface BlobEntry {
  mode: string;
  oid: string;
  path: string;
}
interface RecordDecision {
  path: string;
  recordBlobOid: string;
  recordBytesSha256: string;
  verificationInput: null | {
    projectId: string;
    manifestRevision: string;
    network: string;
    asset: string;
    transactionId: string;
    recipient: string;
    amountMinor: string;
  };
  verifierVersion: string | null;
  verifierOutputCanonical: string | null;
  verifierOutputSha256: string | null;
}
export interface FundingRecordDecision {
  kind: "funding-record-pr-decision";
  schemaVersion: "1";
  checkerVersion: typeof FUNDING_RECORD_GATE_VERSION;
  checkerRevision: string;
  baseSha: string;
  headSha: string;
  pullRequestNumber: number;
  checkedAt: string;
  decision:
    | "human-review-required"
    | "verification-failed"
    | "verified-records";
  mergeAuthorized: false;
  reason: string;
  records: RecordDecision[];
}

class HumanReviewRequired extends Error {}

/** Canonical UTF-8 JSON: sorted object keys, two-space indentation, one LF. */
export function canonicalFundingDecisionBytes(value: unknown): string {
  const ordered = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(ordered);
    if (entry !== null && typeof entry === "object") {
      return Object.fromEntries(
        Object.entries(entry)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, ordered(item)]),
      );
    }
    return entry;
  };
  return `${JSON.stringify(ordered(value), null, 2)}\n`;
}

function digest(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function git(
  root: string,
  args: string[],
  maxBuffer = 16 * 1024 * 1024,
): Buffer {
  return execFileSync("git", ["--literal-pathspecs", ...args], {
    cwd: root,
    maxBuffer,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" },
  });
}

function treeEntries(
  root: string,
  revision: string,
  path: string,
): BlobEntry[] {
  return git(root, ["ls-tree", "-r", "-z", "--full-tree", revision, "--", path])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const match = entry.match(/^(\d{6}) blob ([0-9a-f]{40})\t(.+)$/u);
      if (!match)
        throw new TypeError("funding tree contains an unsupported Git object");
      return { mode: match[1], oid: match[2], path: match[3] };
    });
}

function blobBytes(root: string, oid: string, limit: number): Buffer {
  const size = Number(
    git(root, ["cat-file", "-s", oid], 1024).toString("utf8").trim(),
  );
  if (!Number.isSafeInteger(size) || size <= 0 || size > limit)
    throw new TypeError("funding gate object exceeds its byte limit");
  return git(root, ["cat-file", "blob", oid], limit);
}

function jsonBytes(bytes: Buffer): unknown {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return JSON.parse(source);
}

function manifest(
  root: string,
  revision: string,
  projectId: string,
  historical = false,
) {
  const path = `projects/${projectId}/project.json`;
  const entries = treeEntries(root, revision, path);
  const entry = entries[0];
  if (entries.length !== 1 || entry?.path !== path || entry.mode !== "100644")
    throw new TypeError(
      "funding record project manifest is missing or not a regular file",
    );
  const value = jsonBytes(blobBytes(root, entry.oid, 1024 * 1024));
  const project = historical
    ? assertHistoricalProjectDefinition(value)
    : assertProjectDefinition(value);
  if (
    project.id !== projectId ||
    project.funding.recordsPath !== `funding/${projectId}`
  )
    throw new TypeError(
      "funding record project does not match its reviewed manifest",
    );
  return project;
}

function additions(root: string, base: string, head: string): BlobEntry[] {
  const fields = git(root, [
    "diff",
    "--raw",
    "--no-abbrev",
    "--no-renames",
    "--no-ext-diff",
    "--no-textconv",
    "-z",
    base,
    head,
    "--",
  ])
    .toString("utf8")
    .split("\0");
  if (fields.pop() !== "" || fields.length % 2 !== 0)
    throw new TypeError("funding diff is malformed");
  if (fields.length === 0 || fields.length > MAX_RECORDS * 2)
    throw new HumanReviewRequired(
      `funding gate requires 1 to ${MAX_RECORDS} added records`,
    );
  const result: BlobEntry[] = [];
  for (let index = 0; index < fields.length; index += 2) {
    const header = fields[index].match(
      /^:000000 100644 0{40} ([0-9a-f]{40}) A$/u,
    );
    const path = fields[index + 1];
    if (!header || !RECORD_PATH.test(path))
      throw new HumanReviewRequired(
        "only added regular non-commitment funding records qualify; every other diff requires human review",
      );
    result.push({ mode: "100644", oid: header[1], path });
  }
  return result;
}

async function verify(record: ProjectFundingRecord, fetchImpl?: FetchLike) {
  const input = {
    amountMinor: record.amountMinor,
    recipient: record.recipient,
    fetchImpl,
  };
  if (record.network === "solana")
    return verifyFundingSolana({ ...input, signature: record.transactionId });
  if (record.network === "bitcoin")
    return verifyFundingBitcoin({
      ...input,
      transactionId: record.transactionId,
    });
  return verifyFundingEvm({
    ...input,
    network: record.network,
    transactionHash: record.transactionId,
  });
}

export async function checkFundingRecordPr(input: {
  baseSha: string;
  headSha: string;
  pullRequestNumber: number;
  repositoryRoot?: string;
  fetchImpl?: FetchLike;
  now?: number;
}): Promise<FundingRecordDecision> {
  const root = input.repositoryRoot ?? ROOT;
  const now = input.now ?? Date.now();
  const decision: FundingRecordDecision = {
    kind: "funding-record-pr-decision",
    schemaVersion: "1",
    checkerVersion: FUNDING_RECORD_GATE_VERSION,
    checkerRevision: input.baseSha,
    baseSha: input.baseSha,
    headSha: input.headSha,
    pullRequestNumber: input.pullRequestNumber,
    checkedAt: new Date(now).toISOString(),
    decision: "verification-failed",
    mergeAuthorized: false,
    reason: "verification did not complete",
    records: [],
  };
  try {
    if (
      !SHA.test(input.baseSha) ||
      !SHA.test(input.headSha) ||
      !Number.isSafeInteger(input.pullRequestNumber) ||
      input.pullRequestNumber <= 0
    )
      throw new TypeError(
        "funding gate requires immutable base/head SHAs and a pull request number",
      );
    if (
      git(root, ["rev-parse", "HEAD"]).toString("utf8").trim() !== input.baseSha
    )
      throw new TypeError(
        "funding checker must run from the exact trusted base checkout",
      );
    git(root, ["cat-file", "-e", `${input.headSha}^{commit}`]);
    git(root, ["merge-base", "--is-ancestor", input.baseSha, input.headSha]);
    const added = additions(root, input.baseSha, input.headSha);
    const transactions = new Set<string>();
    const recordIds = new Set<string>();
    for (const entry of treeEntries(root, input.baseSha, "funding")) {
      if (
        entry.path === "funding/README.md" ||
        /^funding\/[^/]+\/commitments\//u.test(entry.path)
      )
        continue;
      const path = entry.path.match(RECORD_PATH);
      if (!path || entry.mode !== "100644")
        throw new HumanReviewRequired(
          "existing funding inventory has ambiguous paths or file modes",
        );
      transactions.add(`${path[2]}:${path[3]}`);
      recordIds.add(path[4]);
    }
    const pending = added.map((entry) => {
      const bytes = blobBytes(root, entry.oid, MAX_RECORD_BYTES);
      const evidence: RecordDecision = {
        path: entry.path,
        recordBlobOid: entry.oid,
        recordBytesSha256: digest(bytes),
        verificationInput: null,
        verifierVersion: null,
        verifierOutputCanonical: null,
        verifierOutputSha256: null,
      };
      decision.records.push(evidence);
      return { entry, bytes, evidence };
    });
    const records: Array<{
      record: ProjectFundingRecord;
      historicalAddresses: ReturnType<typeof assertProjectFundingAddresses>;
    }> = [];
    for (const { entry, bytes, evidence } of pending) {
      const parsed = jsonBytes(bytes);
      if (!bytes.equals(Buffer.from(canonicalFundingDecisionBytes(parsed))))
        throw new HumanReviewRequired(
          "automatic verification requires canonical UTF-8 record JSON without duplicate keys",
        );
      const path = entry.path.match(RECORD_PATH);
      if (!path) throw new TypeError("funding record path changed");
      const project = manifest(root, input.baseSha, path[1]);
      const candidate = parsed as Partial<ProjectFundingRecord> | null;
      const manifestRevision = candidate?.manifestRevision;
      if (typeof manifestRevision !== "string" || !SHA.test(manifestRevision))
        throw new TypeError("funding record manifest revision is invalid");
      git(root, [
        "merge-base",
        "--is-ancestor",
        manifestRevision,
        input.baseSha,
      ]);
      const historical = manifest(root, manifestRevision, path[1], true);
      const historicalAddresses = assertProjectFundingAddresses(
        historical.funding.addresses,
      );
      const record = assertProjectFundingRecord(parsed, historicalAddresses);
      // An older manifest cannot undo a reviewed route replacement. This
      // applies only to new proposals, not already-accepted historical records.
      assertProjectFundingRecord(
        parsed,
        assertProjectFundingAddresses(project.funding.addresses),
      );
      if (
        record.projectId !== project.id ||
        record.network !== path[2] ||
        record.transactionId !== path[3] ||
        record.recordId !== path[4]
      )
        throw new TypeError(
          "funding record identity does not match its immutable path",
        );
      if (
        record.state !== "verified-on-chain" ||
        record.supersedes !== null ||
        record.donor.attribution !== "anonymous"
      )
        throw new HumanReviewRequired(
          "self-reported, disputed, correction, and attributed records require human review",
        );
      if (!record.verifier)
        throw new TypeError("verified funding record has no verifier evidence");
      if (
        Date.parse(record.observedAt) > now ||
        Date.parse(record.verifier.checkedAt) > now
      )
        throw new TypeError(
          "funding record claims a future observation or verification",
        );
      const transactionKey = `${record.network}:${record.transactionId}`;
      if (transactions.has(transactionKey) || recordIds.has(record.recordId))
        throw new TypeError(
          "funding record duplicates an existing or proposed transaction or record ID",
        );
      transactions.add(transactionKey);
      recordIds.add(record.recordId);
      evidence.verificationInput = {
        projectId: record.projectId,
        manifestRevision: record.manifestRevision,
        network: record.network,
        asset: record.asset,
        transactionId: record.transactionId,
        recipient: record.recipient,
        amountMinor: record.amountMinor,
      };
      evidence.verifierVersion = record.verifier.version;
      records.push({ record, historicalAddresses });
    }
    for (const [index, { record, historicalAddresses }] of records.entries()) {
      if (!record.verifier)
        throw new TypeError("verified funding record has no verifier evidence");
      const output = await verify(record, input.fetchImpl);
      const chain = output.chainEvidence;
      const transaction =
        "signature" in chain
          ? chain.signature
          : "transactionId" in chain
            ? chain.transactionId
            : chain.transactionHash;
      const evidence = pending[index].evidence;
      evidence.verifierVersion = output.verifier.version;
      evidence.verifierOutputCanonical = canonicalFundingDecisionBytes(output);
      evidence.verifierOutputSha256 = digest(evidence.verifierOutputCanonical);
      const includedAt = assertFundingBlockTime(chain.blockTime) * 1000;
      const freshCheckedAt = Date.parse(output.verifier.checkedAt);
      const completedNow = input.now ?? Date.now();
      if (
        includedAt > completedNow ||
        Date.parse(record.observedAt) < includedAt ||
        Date.parse(record.verifier.checkedAt) < includedAt ||
        !Number.isFinite(freshCheckedAt) ||
        freshCheckedAt < includedAt ||
        freshCheckedAt > completedNow
      ) {
        throw new TypeError(
          "funding observation or verification predates chain inclusion or claims a future time",
        );
      }
      // Observing an old transfer after a route becomes active does not turn
      // that transfer into funding sent under the reviewed receiving policy.
      assertProjectFundingRecord(
        { ...record, observedAt: new Date(includedAt).toISOString() },
        historicalAddresses,
      );
      if (
        output.state !== record.state ||
        transaction !== record.transactionId ||
        output.verifier.version !== record.verifier.version ||
        output.verifier.evidenceUrl !== record.verifier.evidenceUrl ||
        output.verifier.reason !== null ||
        Date.parse(output.verifier.checkedAt) <
          Date.parse(record.verifier.checkedAt) ||
        canonicalFundingDecisionBytes(output.finality) !==
          canonicalFundingDecisionBytes(record.finality)
      )
        throw new TypeError(
          "fresh verifier output does not exactly match the record identity, version, or finality",
        );
    }
    decision.decision = "verified-records";
    decision.reason =
      "all added records verified; repository-controlled merge authority remains required";
  } catch (error) {
    decision.decision =
      error instanceof HumanReviewRequired
        ? "human-review-required"
        : "verification-failed";
    decision.reason =
      error instanceof Error
        ? error.message
        : "unknown funding verification failure";
  }
  decision.checkedAt = new Date(input.now ?? Date.now()).toISOString();
  return decision;
}

if (import.meta.main) {
  const values = new Map<string, string>();
  const allowed = new Set([
    "--base-sha",
    "--head-sha",
    "--pr-number",
    "--output",
  ]);
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (!allowed.has(key) || values.has(key) || !value)
      throw new TypeError(
        "Usage: check-funding-record-pr.ts --base-sha <sha> --head-sha <sha> --pr-number <number> --output <path>",
      );
    values.set(key, value);
  }
  if (values.size !== allowed.size)
    throw new TypeError("funding gate requires every CLI argument");
  const required = (key: string): string => {
    const value = values.get(key);
    if (!value) throw new TypeError(`funding gate requires ${key}`);
    return value;
  };
  const decision = await checkFundingRecordPr({
    baseSha: required("--base-sha"),
    headSha: required("--head-sha"),
    pullRequestNumber: Number(required("--pr-number")),
  });
  await writeFile(
    required("--output"),
    canonicalFundingDecisionBytes(decision),
    { flag: "wx", mode: 0o600 },
  );
  process.stdout.write(
    `${JSON.stringify({ headSha: decision.headSha, decision: decision.decision, reason: decision.reason, mergeAuthorized: false })}\n`,
  );
  if (decision.decision === "verification-failed") process.exitCode = 1;
}
