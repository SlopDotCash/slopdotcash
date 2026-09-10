/** Complete accepted signer history; never payment authorization. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { canonicalFundingDecisionBytes } from "./check-funding-record-pr";
import {
  readSignerAccessLedger,
  type SignerAccessLedger,
  signerReportPath,
} from "./signer-access-ledger";

import { readSignerCommit } from "./verify-signer-access";

export interface PaymentSignerHistoryEntry {
  readonly path: string;
  readonly sha256: string;
  readonly firstAcceptedRevision: string;
}

/** Shared versioned commitment for authenticated history and checkpoint snapshots. */
export function paymentSignerHistoryDigest(
  entries: readonly PaymentSignerHistoryEntry[],
): string {
  const sorted = [...entries].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  return createHash("sha256")
    .update(
      JSON.stringify({
        kind: "slop-payment-signer-history",
        schemaVersion: 1,
        entries: sorted,
      }),
    )
    .digest("hex");
}

/** The caller supplies trusted canonical base authority, not a caller-selected
 * checkpoint. Replay always starts at the Git root, even for base === head.
 * Proposed side-branch intermediate commits are not accepted history.
 * Authentication and canonical report validation remain in the existing loader.
 */
export async function readPaymentSignerHistory(
  input: Parameters<typeof readSignerAccessLedger>[0],
): Promise<{
  ledger: SignerAccessLedger;
  signerHistorySha256: string;
  entries: readonly PaymentSignerHistoryEntry[];
}> {
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["--no-replace-objects", "--literal-pathspecs", ...args],
      {
        cwd: input.root,
        timeout: 30_000,
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    )
      .toString("utf8")
      .trim();
  if (
    ![input.baseSha, input.headSha].every((sha) => /^[a-f0-9]{40}$/u.test(sha))
  )
    throw new TypeError("Signer history requires immutable Git SHAs");
  if (git("rev-parse", "--is-shallow-repository") !== "false")
    throw new TypeError(
      "Signer history requires complete nonshallow Git history",
    );
  git("merge-base", "--is-ancestor", input.baseSha, input.headSha);
  const revisions = git(
    "rev-list",
    "--first-parent",
    "--reverse",
    input.baseSha,
  ).split("\n");
  if (revisions.length > 24_000 || revisions.at(-1) !== input.baseSha)
    throw new TypeError("Signer history exceeds complete history bounds");
  if (input.headSha !== input.baseSha) revisions.push(input.headSha);
  // One immutable source lookup per invocation; no persistent authority cache.
  const authority = input.readCommit ?? readSignerCommit;
  const sources = new Map<string, ReturnType<typeof readSignerCommit>>();
  const readCommit: typeof readSignerCommit = (repository, revision) => {
    const key = `${repository.toLowerCase()}@${revision}`;
    let pending = sources.get(key);
    if (!pending) {
      pending = authority(repository, revision);
      sources.set(key, pending);
    }
    return pending;
  };
  const entries = new Map<string, PaymentSignerHistoryEntry>();
  let ledger: SignerAccessLedger | undefined;
  let previous = revisions[0];
  let previousInventory: string | undefined;
  for (const revision of revisions) {
    // Inspect every accepted tree, including transient removal followed by restore.
    const inventory = git("ls-tree", "-r", "-z", revision, "--", "funding")
      .split("\0")
      .filter((entry) => /\tfunding\/[^/]+\/signer-access(?:\/|$)/u.test(entry))
      .join("\0");
    if (inventory && inventory.split("\0").length > 10_000)
      throw new TypeError("Signer history exceeds report bounds");
    if (inventory !== previousInventory || revision === input.headSha) {
      ledger = await readSignerAccessLedger({
        ...input,
        readCommit,
        baseSha: previous,
        headSha: revision,
      });
      for (const report of ledger.reports) {
        const path = signerReportPath(report);
        if (!entries.has(path)) {
          entries.set(
            path,
            Object.freeze({
              path,
              sha256: createHash("sha256")
                .update(canonicalFundingDecisionBytes(report))
                .digest("hex"),
              firstAcceptedRevision: revision,
            }),
          );
          if (entries.size > 10_000)
            throw new TypeError("Signer history exceeds report bounds");
        }
      }
    }
    previous = revision;
    previousInventory = inventory;
  }
  if (!ledger)
    throw new TypeError("Signer history has no authenticated ledger");
  const sorted = Object.freeze(
    [...entries.values()].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    ),
  );
  // Versioned, domain-separated canonical UTF-8 JSON. No observation time or
  // mutable API metadata participates in the checkpoint commitment.
  return {
    ledger,
    entries: sorted,
    signerHistorySha256: paymentSignerHistoryDigest(sorted),
  };
}
