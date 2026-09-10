import { verifyUnsafeDestinationHistoryAuthorities } from "./check-unsafe-destination-transitions";
import { verifyReceipt } from "./payment-admission-receipt";
import { readPaymentSignerHistory } from "./payment-signer-history";

export { assertAdmissionReceipt } from "./payment-admission-receipt";
/** Operator-reviewed trust root, pinned in the deployed verifier code. Set only
 * after reviewing a complete canonical checkpoint with an empty reservation
 * ledger, no activation policies, and this exact trusted workflow installed.
 * A value read from a candidate branch, environment or CLI is not a trust root. */
export const PAYMENT_BOOTSTRAP_CHECKPOINT: string | null = null;
export function requirePaymentBootstrapCheckpoint(): string {
  if (!PAYMENT_BOOTSTRAP_CHECKPOINT)
    throw new TypeError(
      "Configure reviewed bootstrap before checkpoint migration",
    );
  return PAYMENT_BOOTSTRAP_CHECKPOINT;
}

import { PAYMENT_RESERVATION_CHECK } from "../src/lib/payment-reservations";
import { checkPaymentReservationRecords } from "./check-payment-reservations";
import {
  DEPLOYED_PAYMENT_CHECKPOINTS,
  validatePinnedPaymentCheckpoints,
} from "./payment-checkpoints";
import {
  gitReservationBlob,
  gitReservationLedger,
  PAYMENT_REPOSITORY,
  reservationGit,
  reservationGithub,
  reservationJson,
} from "./payment-reservation-history";

const WORKFLOW = ".github/workflows/payment-reservations.yml";

/** Inspect GitHub evidence, not merely a status context with the shared Actions app. */
export function assertReservationRunProvenance(
  value: unknown,
  expected: {
    base: string;
    head: string;
    number: number;
    mergedAt: string;
  },
) {
  const r = value as {
    path?: string;
    event?: string;
    head_sha?: string;
    status?: string;
    conclusion?: string;
    run_started_at?: string;
    updated_at?: string;
    repository?: { full_name?: string };
    pull_requests?: {
      number?: number;
      head?: { sha?: string };
      base?: { sha?: string };
    }[];
  };
  if (
    r.path !== WORKFLOW ||
    r.event !== "pull_request_target" ||
    r.head_sha !== expected.base ||
    r.status !== "completed" ||
    r.conclusion !== "success" ||
    r.repository?.full_name !== PAYMENT_REPOSITORY ||
    !r.run_started_at ||
    !r.updated_at ||
    !Number.isFinite(Date.parse(r.updated_at)) ||
    Date.parse(r.updated_at) > Date.parse(expected.mergedAt)
  )
    throw new TypeError(
      "Missing exact trusted workflow provenance before reservation admission",
    );
}
export async function verifyHistoricalPaymentAdmission(
  root: string,
  revision: string,
  checkpoint: string | null = PAYMENT_BOOTSTRAP_CHECKPOINT,
  checkpointChain: unknown = DEPLOYED_PAYMENT_CHECKPOINTS,
) {
  if (!checkpoint || !/^[a-f0-9]{40}$/u.test(checkpoint))
    throw new TypeError(
      "A reviewed payment bootstrap checkpoint must be pinned in the deployed verifier before activation",
    );
  if (
    reservationGit(root, ["rev-parse", "--is-shallow-repository"])
      .toString()
      .trim() !== "false"
  )
    throw new TypeError("Complete non-shallow payment history is required");
  reservationGit(root, ["merge-base", "--is-ancestor", checkpoint, revision]);
  if (gitReservationLedger(root, checkpoint).length !== 0)
    throw new TypeError(
      "Bootstrap must start with an empty reservation ledger",
    );
  const workflow = gitReservationBlob(root, checkpoint, WORKFLOW);
  const projects = reservationGit(root, [
    "ls-tree",
    "-r",
    "--name-only",
    checkpoint,
    "--",
    "projects",
  ])
    .toString()
    .trim()
    .split("\n")
    .filter((p) => /^projects\/[a-z0-9-]+\/project\.json$/u.test(p));
  for (const path of projects) {
    const p = reservationJson(gitReservationBlob(root, checkpoint, path)) as {
      funding?: { freshCyclePaymentPolicy?: unknown };
    };
    if (p.funding?.freshCyclePaymentPolicy)
      throw new TypeError("Bootstrap cannot grandfather an activation policy");
  }
  await readPaymentSignerHistory({
    root,
    baseSha: revision,
    headSha: revision,
    now: new Date().toISOString(),
  });
  // Checkpoint hashes preserve bytes; replay still enforces unsafe-wallet history
  // through the pinned interval. No expired Actions receipt is needed for this.
  const unsafeRevisions = reservationGit(root, [
    "rev-list",
    "--first-parent",
    "--reverse",
    revision,
    "--",
    "cycles",
  ])
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);
  if (unsafeRevisions.length > 24000)
    throw new TypeError("Unsafe destination history exceeds bound");
  let unsafeBase = unsafeRevisions[0];
  for (const unsafeHead of unsafeRevisions) {
    await verifyUnsafeDestinationHistoryAuthorities({
      repositoryRoot: root,
      baseSha: unsafeBase,
      headSha: unsafeHead,
    });
    unsafeBase = unsafeHead;
  }
  const admissionStart = validatePinnedPaymentCheckpoints(
    root,
    revision,
    checkpoint,
    checkpointChain,
  );
  const commits = reservationGit(root, [
    "rev-list",
    "--first-parent",
    "--reverse",
    `${admissionStart}..${revision}`,
  ])
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);
  if (commits.length > 24000)
    throw new TypeError("Admission history exceeds bound");
  let base = admissionStart;
  for (const sha of commits) {
    const parents = reservationGit(root, ["show", "-s", "--format=%P", sha])
      .toString()
      .trim()
      .split(" ");
    if (parents.length !== 2 || parents[0] !== base)
      throw new TypeError(
        "Payment authority requires continuous reviewed merge commits from bootstrap",
      );
    for (const ref of [base, sha])
      if (
        !Buffer.from(gitReservationBlob(root, ref, WORKFLOW)).equals(
          Buffer.from(workflow),
        )
      )
        throw new TypeError(
          "Trusted reservation workflow changed since reviewed bootstrap",
        );
    const prs = reservationGithub(
      `repos/${PAYMENT_REPOSITORY}/commits/${sha}/pulls?per_page=100`,
    ) as {
      number: number;
      merge_commit_sha: string;
      merged_at: string;
      base: { ref: string; repo: { full_name: string } };
      head: { sha: string };
    }[];
    if (!Array.isArray(prs) || prs.length >= 100)
      throw new TypeError("Ambiguous admission PR inventory");
    const matches = prs.filter(
      (p) =>
        p.merge_commit_sha === sha &&
        p.merged_at &&
        p.base?.ref === "develop" &&
        p.base.repo?.full_name === PAYMENT_REPOSITORY &&
        p.head?.sha === parents[1],
    );
    if (matches.length !== 1)
      throw new TypeError("Cannot prove exact merged admission PR");
    const pr = matches[0];
    const runs = reservationGithub(
      `repos/${PAYMENT_REPOSITORY}/actions/workflows/payment-reservations.yml/runs?event=pull_request_target&head_sha=${base}&per_page=100`,
    ) as {
      total_count?: number;
      workflow_runs?: ({ id: number } & Record<string, unknown>)[];
    };
    if (!Array.isArray(runs.workflow_runs) || (runs.total_count ?? 101) > 100)
      throw new TypeError("Incomplete trusted workflow run inventory");
    let proven = false;
    for (const run of runs.workflow_runs) {
      try {
        assertReservationRunProvenance(run, {
          base,
          head: parents[1],
          number: pr.number,
          mergedAt: pr.merged_at,
        });
      } catch {
        continue;
      }
      const jobs = reservationGithub(
        `repos/${PAYMENT_REPOSITORY}/actions/runs/${run.id}/jobs?per_page=100`,
      ) as {
        total_count?: number;
        jobs?: { name: string; conclusion: string; completed_at: string }[];
      };
      if (
        (jobs.total_count ?? 101) <= 100 &&
        jobs.jobs?.some(
          (j) =>
            j.name === PAYMENT_RESERVATION_CHECK &&
            j.conclusion === "success" &&
            Date.parse(j.completed_at) <= Date.parse(pr.merged_at),
        )
      ) {
        verifyReceipt(run.id, {
          base,
          head: parents[1],
          number: pr.number,
          runId: run.id,
          attempt: Number(run.run_attempt),
        });
        proven = true;
      }
    }
    if (!proven)
      throw new TypeError(
        "No exact successful trusted reservation gate before merge",
      );
    // Re-evaluate each historical admission using exact immutable inputs. Current
    // protection cannot bless a rewritten prefix or previously invalid policy.
    await checkPaymentReservationRecords(
      root,
      base,
      sha,
      new Date(pr.merged_at).toISOString(),
    );
    base = sha;
  }
  if (base !== revision)
    throw new TypeError("Bootstrap is not on canonical first-parent history");
}
