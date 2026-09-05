/** Read-only, trusted-base evidence gate. Never checks out or executes PR code. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  assertProjectFundingAddresses,
  assertProjectFundingRecord,
  type ProjectFundingRecord,
} from "../src/lib/funding";
import { verifyFundingBitcoin } from "./verify-funding-bitcoin";
import { verifyFundingEvm } from "./verify-funding-evm";
import { verifyFundingSolana } from "./verify-funding-solana";

const SHA = /^[0-9a-f]{40}$/u;
const RECORD_PATH =
  /^funding\/([a-z0-9][a-z0-9-]*)\/(solana|base|ethereum|bitcoin)\/([A-Za-z0-9]+)\/(fund_[a-z0-9][a-z0-9_-]{6,79})\.json$/u;
const MAX_ADDITIONS = 100;

function git(root: string, args: string[], maxBuffer = 8 * 1024 * 1024) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function jsonBlob(root: string, revision: string, path: string) {
  const entry = git(root, ["ls-tree", revision, "--", path]);
  if (!entry.startsWith("100644 blob ")) {
    throw new TypeError(
      "funding evidence must be a regular non-executable blob",
    );
  }
  return JSON.parse(git(root, ["show", `${revision}:${path}`], 64 * 1024));
}

export function fundingAdditionPaths(diff: string): string[] | null {
  const fields = diff.split("\0");
  if (fields.pop() !== "" || fields.length === 0 || fields.length % 2 !== 0) {
    return null;
  }
  const paths: string[] = [];
  for (let i = 0; i < fields.length; i += 2) {
    const path = fields[i + 1];
    if (fields[i] !== "A" || !path || !RECORD_PATH.test(path)) return null;
    paths.push(path);
  }
  return paths.length <= MAX_ADDITIONS && new Set(paths).size === paths.length
    ? paths
    : null;
}

async function verify(record: ProjectFundingRecord) {
  const common = {
    amountMinor: record.amountMinor,
    recipient: record.recipient,
  };
  switch (record.network) {
    case "solana":
      return verifyFundingSolana({
        ...common,
        signature: record.transactionId,
      });
    case "bitcoin":
      return verifyFundingBitcoin({
        ...common,
        transactionId: record.transactionId,
      });
    default:
      return verifyFundingEvm({
        ...common,
        network: record.network,
        transactionHash: record.transactionId,
      });
  }
}

export function matchFundingVerification(
  record: ProjectFundingRecord,
  output: Awaited<ReturnType<typeof verify>>,
) {
  if (
    record.state !== output.state ||
    !isDeepStrictEqual(record.finality, output.finality) ||
    record.verifier?.version !== output.verifier.version ||
    record.verifier.evidenceUrl !== output.verifier.evidenceUrl ||
    record.verifier.reason !== output.verifier.reason ||
    Date.parse(record.observedAt) > Date.parse(output.verifier.checkedAt) ||
    Date.parse(record.verifier.checkedAt) >
      Date.parse(output.verifier.checkedAt)
  ) {
    throw new TypeError(
      "funding record does not match fresh verifier evidence",
    );
  }
  // Hash the exact bytes emitted below, including the independently checked
  // chain evidence and fresh observation time, not a contributor-supplied hash.
  const outputJson = `${JSON.stringify(output)}\n`;
  return {
    verifierVersion: output.verifier.version,
    outputSha256: createHash("sha256").update(outputJson).digest("hex"),
    outputJson,
  };
}

export async function checkFundingEligibility(input: {
  root: string;
  baseSha: string;
  headSha: string;
  verifyRecord?: typeof verify;
}) {
  const { root, baseSha, headSha } = input;
  if (!SHA.test(baseSha) || !SHA.test(headSha)) {
    throw new TypeError("immutable base and head SHAs are required");
  }
  if (git(root, ["rev-parse", "HEAD"]).trim() !== baseSha) {
    throw new TypeError("checker must run from the trusted base checkout");
  }
  const decision = {
    schemaVersion: "1",
    baseSha,
    headSha,
    // The separate approver must still authorize and SHA-lock a merge after
    // re-reading live required checks. This read-only gate has no merge power.
    mergeAuthorized: false,
  } as const;
  const human = (reason: string) => ({
    ...decision,
    eligible: false as const,
    reason,
    records: [],
  });
  try {
    git(root, ["merge-base", "--is-ancestor", baseSha, headSha]);
  } catch {
    return human("head must include the exact current base");
  }
  const paths = fundingAdditionPaths(
    git(root, [
      "diff",
      "--no-renames",
      "--name-status",
      "-z",
      baseSha,
      headSha,
    ]),
  );
  if (!paths)
    return human("only bounded direct-funding JSON additions qualify");

  const records: ProjectFundingRecord[] = [];
  for (const path of paths) {
    const match = RECORD_PATH.exec(path);
    if (!match) throw new TypeError("invalid funding path");
    const [, projectId, network, transactionId, recordId] = match;
    const raw = jsonBlob(root, headSha, path);
    if (
      raw.projectId !== projectId ||
      raw.network !== network ||
      raw.transactionId !== transactionId ||
      raw.recordId !== recordId
    ) {
      throw new TypeError("funding record does not match its path");
    }
    if (
      typeof raw.manifestRevision !== "string" ||
      !SHA.test(raw.manifestRevision)
    ) {
      throw new TypeError("invalid funding manifest revision");
    }
    git(root, ["merge-base", "--is-ancestor", raw.manifestRevision, baseSha]);
    const manifestPath = `projects/${projectId}/project.json`;
    const current = jsonBlob(root, baseSha, manifestPath);
    const historical = jsonBlob(root, raw.manifestRevision, manifestPath);
    if (
      current.id !== projectId ||
      historical.id !== projectId ||
      current.funding.recordsPath !== `funding/${projectId}`
    ) {
      throw new TypeError("funding project is not in the trusted inventory");
    }
    const record = assertProjectFundingRecord(
      raw,
      assertProjectFundingAddresses(historical.funding.addresses),
    );
    assertProjectFundingRecord(
      record,
      assertProjectFundingAddresses(current.funding.addresses),
    );
    const activeRoute = assertProjectFundingAddresses(
      current.funding.addresses,
    ).find(
      (route) =>
        route.network === record.network &&
        route.asset === record.asset &&
        route.address === record.recipient &&
        route.replacedAt === null,
    );
    if (!activeRoute)
      return human("retired receiving routes need human review");
    if (record.state !== "verified-on-chain")
      return human("unverified or disputed evidence needs human review");
    if (record.supersedes !== null)
      return human("corrections need human review");
    if (record.donor.attribution !== "anonymous")
      return human("public donor attribution needs independent consent review");
    records.push(record);
  }

  // Compare against all prior direct and commitment records, across projects.
  // A historical transfer cannot become a new donation by changing its path.
  const usedTransactions = new Set<string>();
  const usedIds = new Set<string>();
  const existing = git(root, [
    "ls-tree",
    "-r",
    "--name-only",
    "-z",
    baseSha,
    "--",
    "funding/",
  ])
    .split("\0")
    .filter((path) => path.endsWith(".json"));
  for (const path of existing) {
    const record = jsonBlob(root, baseSha, path);
    usedTransactions.add(`${record.network}:${record.transactionId}`);
    usedIds.add(record.recordId);
  }
  for (const record of records) {
    const key = `${record.network}:${record.transactionId}`;
    if (usedTransactions.has(key) || usedIds.has(record.recordId)) {
      throw new TypeError(
        "funding transaction or record id is already recorded",
      );
    }
    usedTransactions.add(key);
    usedIds.add(record.recordId);
  }
  const evidence = [];
  for (const [index, record] of records.entries()) {
    const output = await (input.verifyRecord ?? verify)(record);
    evidence.push({
      path: paths[index],
      ...matchFundingVerification(record, output),
    });
  }
  return {
    ...decision,
    eligible: true as const,
    reason: "fresh verifier evidence matches every addition",
    records: evidence,
  };
}

if (import.meta.main) {
  const [baseSha, headSha, ...extra] = process.argv.slice(2);
  if (!baseSha || !headSha || extra.length)
    throw new TypeError(
      "usage: check-funding-eligibility.ts <base-sha> <head-sha>",
    );
  process.stdout.write(
    `${JSON.stringify(await checkFundingEligibility({ root: process.cwd(), baseSha, headSha }), null, 2)}\n`,
  );
}
