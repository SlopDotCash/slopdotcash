/** Trusted-base preservation of accepted cycle files and unsafe-wallet evidence. */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertExternalContributionShareManifest,
  assertRewardAllocationManifest,
  type UnsafeDestinationReport,
} from "../src/lib/rewards";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHA = /^[0-9a-f]{40}$/u;
const MANIFEST_PATH =
  /^cycles\/[a-z0-9][a-z0-9-]{0,127}\/\d{4}-(?:0[1-9]|1[0-2])\/(?:proposal|allocation)\.json$/u;
const MAX_FILES = 2400;
const MAX_BLOB_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;

function git(
  root: string,
  args: string[],
  maxBuffer = 2 * 1024 * 1024,
): Buffer {
  return execFileSync("git", ["--literal-pathspecs", ...args], {
    cwd: root,
    maxBuffer,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" },
  });
}

function manifests(root: string, revision: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const entry of git(root, [
    "ls-tree",
    "-r",
    "-z",
    "--full-tree",
    revision,
    "--",
    "cycles",
  ])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)) {
    const match = entry.match(
      /^(\d{6}) (?:blob|tree|commit) ([0-9a-f]{40})\t(.+)$/u,
    );
    if (!match)
      throw new TypeError("Cycle tree contains an unsupported Git object");
    const [, mode, oid, path] = match;
    if (!MANIFEST_PATH.test(path)) continue;
    if (mode !== "100644")
      throw new TypeError(
        "Cycle manifests must remain regular non-executable files",
      );
    result.set(path, oid);
    if (result.size > MAX_FILES)
      throw new RangeError("Cycle transition manifest count exceeds its limit");
  }
  return result;
}

function strictJson(bytes: Buffer): unknown {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const parsed: unknown = JSON.parse(source);
  // JSON.parse checks the grammar; this independent token walk rejects keys it
  // would otherwise silently overwrite, including escaped and nested duplicates.
  const stack: Array<{ keys: Set<string> | null; expectsKey: boolean }> = [];
  for (const token of source.matchAll(
    /"(?:\\.|[^"\\])*"|[{}[\],:]|[^\s{}[\],:]+/gu,
  )) {
    const value = token[0];
    if (value === "{") stack.push({ keys: new Set(), expectsKey: true });
    else if (value === "[") stack.push({ keys: null, expectsKey: false });
    else if (value === "}" || value === "]") stack.pop();
    else {
      const frame = stack.at(-1);
      if (value === "," && frame?.keys) frame.expectsKey = true;
      else if (value.startsWith('"') && frame?.keys && frame.expectsKey) {
        const key = JSON.parse(value) as string;
        if (frame.keys.has(key))
          throw new TypeError("Cycle manifest contains a duplicate JSON key");
        frame.keys.add(key);
        frame.expectsKey = false;
      }
    }
  }
  return parsed;
}

function readManifest(root: string, oid: string, budget: { bytes: number }) {
  const size = Number(
    git(root, ["cat-file", "-s", oid], 1024).toString("utf8").trim(),
  );
  if (
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > MAX_BLOB_BYTES ||
    budget.bytes + size > MAX_TOTAL_BYTES
  )
    throw new RangeError("Cycle transition manifest bytes exceed their limit");
  budget.bytes += size;
  const value = strictJson(
    git(root, ["cat-file", "blob", oid], MAX_BLOB_BYTES),
  );
  return value &&
    typeof value === "object" &&
    "kind" in value &&
    value.kind === "external-contribution-share"
    ? assertExternalContributionShareManifest(value)
    : assertRewardAllocationManifest(value);
}

/** All executable modules come from this checker revision, never the PR tree. */
export function checkUnsafeDestinationTransitions(input: {
  baseSha: string;
  headSha: string;
  repositoryRoot?: string;
}): { preservedFiles: number; checkedFiles: number } {
  const root = input.repositoryRoot ?? ROOT;
  if (!SHA.test(input.baseSha) || !SHA.test(input.headSha))
    throw new TypeError(
      "Cycle transition requires immutable base and head SHAs",
    );
  if (
    git(root, ["rev-parse", "HEAD"]).toString("utf8").trim() !== input.baseSha
  )
    throw new TypeError(
      "Cycle transition checker must run from its exact trusted base checkout",
    );
  git(root, ["cat-file", "-e", `${input.headSha}^{commit}`]);
  const base = manifests(root, input.baseSha);
  const head = manifests(root, input.headSha);
  const budget = { bytes: 0 };
  const beforeValues = new Map<string, ReturnType<typeof readManifest>>();
  const history = new Map<string, Map<string, UnsafeDestinationReport>>();
  let checkedFiles = 0;
  for (const [path, beforeOid] of base) {
    if (!head.has(path))
      throw new TypeError(
        `Existing cycle manifest cannot be deleted or renamed: ${path}`,
      );
    const before = readManifest(root, beforeOid, budget);
    beforeValues.set(path, before);
    if (before.kind !== "reward-allocation") continue;
    for (const row of before.allocations) {
      const key = `${before.projectId}:${row.actor.id}`;
      const reports =
        history.get(key) ?? new Map<string, UnsafeDestinationReport>();
      for (const report of row.unsafeDestinationReports ?? []) {
        const prior = reports.get(report.sourceCommit);
        if (prior && JSON.stringify(prior) !== JSON.stringify(report))
          throw new TypeError(
            "Trusted cycle history contains conflicting report copies",
          );
        reports.set(report.sourceCommit, report);
      }
      if (reports.size) history.set(key, reports);
    }
  }
  for (const [path, afterOid] of head) {
    if (base.get(path) === afterOid) continue;
    checkedFiles += 1;
    const before = beforeValues.get(path);
    const after = readManifest(root, afterOid, budget);
    const [, projectId, cycleId] = path.split("/");
    if (after.projectId !== projectId || after.cycleId !== cycleId)
      throw new TypeError(
        "Cycle manifest identity does not match its immutable path",
      );
    if (
      before &&
      (before.projectId !== after.projectId ||
        before.cycleId !== after.cycleId ||
        before.kind !== after.kind)
    )
      throw new TypeError("Existing cycle manifest identity cannot change");
    if (after.kind !== "reward-allocation") continue;
    // A new cycle must not omit accepted history even if contributor code in
    // the same PR attempts to weaken its ordinary proposal generator/checks.
    for (const row of after.allocations) {
      for (const report of history
        .get(`${after.projectId}:${row.actor.id}`)
        ?.values() ?? []) {
        if (
          report.cycleId <= after.cycleId &&
          !(row.unsafeDestinationReports ?? []).some(
            (candidate) => JSON.stringify(candidate) === JSON.stringify(report),
          )
        )
          throw new TypeError(
            "New or changed cycle rows must retain all trusted unsafe destination history",
          );
      }
    }
    if (before?.kind !== "reward-allocation") continue;
    for (const previous of before.allocations) {
      if (!previous.unsafeDestinationReports && !previous.hold) continue;
      const next = after.allocations.find(
        (row) => row.intentId === previous.intentId,
      );
      if (
        !next ||
        JSON.stringify(next.actor) !== JSON.stringify(previous.actor)
      )
        throw new TypeError(
          "Unsafe destination history cannot remove or substitute its contributor row",
        );
      const previousReports = previous.unsafeDestinationReports ?? [];
      const nextReports = next.unsafeDestinationReports ?? [];
      if (
        nextReports.length < previousReports.length ||
        previousReports.some(
          (report, index) =>
            JSON.stringify(report) !== JSON.stringify(nextReports[index]),
        )
      )
        throw new TypeError(
          "Unsafe destination history must retain its exact append-only report prefix",
        );
      if (
        previous.hold &&
        (JSON.stringify(next.hold) !== JSON.stringify(previous.hold) ||
          next.state !== "held" ||
          next.approvedMinor !== "0" ||
          JSON.stringify(next.wallet) !== JSON.stringify(previous.wallet) ||
          next.suggestedMinor !== previous.suggestedMinor ||
          next.accruedMinor !== previous.accruedMinor ||
          JSON.stringify(next.lines) !== JSON.stringify(previous.lines))
      )
        throw new TypeError(
          "An accepted unsafe destination hold must retain its original wallet, amount, and zero approval",
        );
    }
  }
  return { preservedFiles: base.size, checkedFiles };
}

if (import.meta.main) {
  const [baseSha, headSha, ...extra] = process.argv.slice(2);
  if (!baseSha || !headSha || extra.length)
    throw new TypeError(
      "Usage: check-unsafe-destination-transitions.ts <base-sha> <head-sha>",
    );
  const result = checkUnsafeDestinationTransitions({ baseSha, headSha });
  process.stdout.write(
    `[Slop] preserved unsafe destination history in ${result.preservedFiles} existing cycle manifests\n`,
  );
}
