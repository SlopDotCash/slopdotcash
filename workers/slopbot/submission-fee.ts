// The refundable submission fee (operator decision, 18 November 2026; PRD
// section 5, "Submission fee"). When a project's owner has the setting on and
// the platform switch is live, Slopbot asks an outside contributor for a
// deposit before it reviews a pull request:
//   first sight  one row in `submission_fee_items`, one comment, the label
//                `slopbot:fee-needed`, and the review is skipped (`fee-needed`);
//   paid         the submission-fee Worker sets `paid_at`; Slopbot swaps the
//                label for `slopbot:fee-paid`, updates the comment and runs
//                the review;
//   outcome      merged, or still open 14 days after payment: `refund_due`.
//                Closed without a merge and still closed 7 days later:
//                `kept_due`. The Worker sends what is due.
// Slopbot moves no money and never closes a pull request for an unpaid fee. A
// maintainer can review and merge an unpaid pull request; scoring is unchanged.
import {
  SUBMISSION_FEE_CONTRACTS,
  SUBMISSION_FEE_DEFAULT_MINOR,
  SUBMISSION_FEE_KEPT_AFTER_CLOSED_DAYS,
  SUBMISSION_FEE_REFUND_UNDECIDED_DAYS,
  type SubmissionFeeNetwork,
  type SubmissionFeeRate,
  submissionFeeItem,
  submissionFeeOptions,
} from "../../src/lib/submission-fee.mjs";
import { submissionFeeSetting } from "../../src/lib/submission-fee-setting.mjs";
import type { Job } from "./contracts";
import {
  type Exemption,
  findReviewComment,
  GitHubClient,
  GitHubError,
} from "./github";
import * as store from "./persistence";
import { registeredProject, scopeAllowed } from "./registry";

/** Recorded as the review's skip reason while the fee is unpaid. */
export const FEE_NEEDED_REASON = "fee-needed";
export const FEE_NEEDED_LABEL = "slopbot:fee-needed";
export const FEE_PAID_LABEL = "slopbot:fee-paid";
export const FEE_MARKER = "<!-- slopbot:fee -->";
/** A paid, undecided pull request is read again at least this often. */
export const FEE_RECHECK_MS = 24 * 60 * 60_000;
/** How long one job may hold the first ask before another may retake it. */
export const FEE_ASK_LEASE_MS = 10 * 60_000;
export const FEE_DISPATCH_BATCH = 20;
const DAY_MS = 24 * 60 * 60_000;

export type FeeMode = "off" | "dry_run" | "live";

/** `SUBMISSION_FEE_MODE`; anything but the two active values is off. */
export function feeMode(value: string | undefined): FeeMode {
  return value === "live" || value === "dry_run" ? value : "off";
}

export type FeeJob = Extract<Job, { kind: "submission_fee" }>;
export type FeeEnv = {
  SLOPBOT_DB: store.D1Database;
  SLOPBOT_APP_ID: string;
  SLOPBOT_APP_PRIVATE_KEY: string;
  SLOPBOT_APP_USER_ID: string;
  /** off, dry_run or live. Absent means off. */
  SUBMISSION_FEE_MODE?: string;
};
type Queue = { send(body: Job): Promise<void> };
type PullRef = Pick<
  Job,
  "owner" | "repo" | "repositoryId" | "installationId"
> & { number: number };

/** A review job thrown out by the fee step, not by a provider. */
export class SubmissionFeeGateError extends Error {
  constructor(cause: unknown) {
    super(`Submission fee step did not finish: ${String(cause).slice(0, 200)}`);
    this.name = "SubmissionFeeGateError";
  }
}

// ---------------------------------------------------------------------------
// The accepted ways to pay. Only a network with a published deposit contract
// is offered; with none published the fee does nothing at all.

/** The published deposit contracts. Tests replace `current`; nothing else. */
export const feeContracts: {
  current: Readonly<Record<SubmissionFeeNetwork, string | null>>;
} = { current: SUBMISSION_FEE_CONTRACTS };

export type FeeWay = {
  network: string;
  networkName: string;
  symbol: string;
  token: string;
  contract: string;
  keptTo: string;
  /** Base units to deposit now. */
  amount: string;
  decimals: number;
  /** False for SLOP, whose amount follows the published rate. */
  stable: boolean;
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const NETWORK_NAMES: Readonly<Record<string, string>> = {
  "base-mainnet": "Base",
  "robinhood-mainnet": "Robinhood Chain",
};

/**
 * Every way to pay a fee now, from the same rule the submission-fee Worker
 * judges a deposit by (`submissionFeeOptions`), on networks with a published
 * contract only. SLOP is offered only while a rate is in force.
 */
export function feeWays(
  stableMinor: string = SUBMISSION_FEE_DEFAULT_MINOR,
  rates: readonly SubmissionFeeRate[] = [],
  at: string = new Date().toISOString(),
  contracts: Readonly<
    Record<SubmissionFeeNetwork, string | null>
  > = feeContracts.current,
): FeeWay[] {
  let options: ReturnType<typeof submissionFeeOptions>;
  try {
    options = submissionFeeOptions(stableMinor, rates, at, { contracts });
  } catch {
    // An unreadable rate must not hide the stablecoin ways.
    options = submissionFeeOptions(stableMinor, [], at, { contracts });
  }
  return options.flatMap((option) =>
    typeof option.contract === "string" && ADDRESS.test(option.contract)
      ? [
          {
            network: option.network,
            networkName: `${NETWORK_NAMES[option.network] ?? option.network}${option.chainId === null ? "" : ` (chain ${option.chainId})`}`,
            symbol: option.symbol,
            token: option.token,
            contract: option.contract,
            keptTo: option.keptTo,
            amount: option.amount,
            decimals: option.decimals,
            stable: option.symbol !== "SLOP",
          },
        ]
      : [],
  );
}

/** Base units as a short decimal: 75000000000000000000 at 18 is "75". */
function unitsText(amount: string, decimals: number): string {
  const value = BigInt(amount);
  const unit = 10n ** BigInt(decimals);
  const fraction = (value % unit)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/u, "");
  return fraction === "" ? `${value / unit}` : `${value / unit}.${fraction}`;
}

/** The published SLOP rates, newest first. No table or no rows: no SLOP. */
async function feeRates(db: store.D1Database): Promise<SubmissionFeeRate[]> {
  try {
    const rows = await (db as store.D1Database<store.D1QueryStatement>)
      .prepare(
        "SELECT effective_at, slop_per_usd FROM submission_fee_rates ORDER BY effective_at DESC LIMIT 8",
      )
      .all<{ effective_at: string; slop_per_usd: string }>();
    return rows.results.map((row) => ({
      effectiveAt: row.effective_at,
      slopPerUsd: row.slop_per_usd,
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// The comment. Plain rules, every address Slop publishes for this fee, and no
// promise beyond the rules themselves.

export type FeeOutcomeWhy = "merged" | "undecided" | "closed";
export type FeeReleaseWhy = "setting-off" | "author-exempt";

type CommentFacts = {
  owner: string;
  repo: string;
  number: number;
  repositoryId: number;
  item: string;
  stableMinor: string;
  ways: readonly FeeWay[];
};

/** The stablecoins on offer, as "USDC or USDG". */
function stableNames(ways: readonly FeeWay[]): string {
  return [
    ...new Set(ways.filter((way) => way.stable).map((way) => way.symbol)),
  ].join(" or ");
}

function outcomeRules(ways: readonly FeeWay[]): string[] {
  const slop = ways.some((way) => !way.stable);
  return [
    "- This pull request is merged: the deposit goes back to the wallet that paid it.",
    `- No maintainer merges or closes it within ${SUBMISSION_FEE_REFUND_UNDECIDED_DAYS} days of the deposit: the deposit goes back.`,
    `- It is closed without a merge and is still closed ${SUBMISSION_FEE_KEPT_AFTER_CLOSED_DAYS} days later: a ${stableNames(ways)} deposit is kept by Slop${slop ? ", and a SLOP deposit is burned" : ""}.`,
  ];
}

export function feeNeededComment(facts: CommentFacts): string {
  const amount = unitsText(facts.stableMinor, 6);
  const slop = facts.ways.some((way) => !way.stable);
  const names = stableNames(facts.ways);
  return [
    FEE_MARKER,
    "**Submission fee needed before Slopbot reviews this pull request**",
    `This project asks outside contributors for a refundable submission fee: **${amount} ${names}**${slop ? ", or SLOP at half that price" : ""}. Slopbot's review is free and starts once a deposit for this pull request is seen. Slopbot never closes a pull request for an unpaid fee, and a maintainer can review and merge this one without it.`,
    "**What happens to a deposit**",
    [
      ...outcomeRules(facts.ways),
      "- A deposit that names another item, token or destination, or a lower amount than listed here, does not count and goes back.",
    ].join("\n"),
    "**How to pay**",
    `Pay page: https://slop.cash/fee/${facts.owner}/${facts.repo}/${facts.number}`,
    "Or use the deposit contract directly: approve the contract for the amount on the token, then call `deposit(item, token, amount, keptTo)` with one row of this table. Any wallet can pay, and a refund goes to the wallet that paid.",
    `\`item\`: \`${facts.item}\``,
    [
      "| Pay with | Network | Amount | Token | Deposit contract | `keptTo` |",
      "|---|---|---|---|---|---|",
      ...facts.ways.map(
        (way) =>
          `| ${way.symbol} | ${way.networkName} | ${unitsText(way.amount, way.decimals)} ${way.symbol} (\`${way.amount}\` base units) | \`${way.token}\` | \`${way.contract}\` | \`${way.keptTo}\` |`,
      ),
    ].join("\n"),
    ...(slop
      ? [
          `The SLOP amount is half the fee at Slop's published rate when this comment was written, and it changes when the rate does. Before paying in SLOP, read the amount due now at https://slop.cash/api/v1/submission-fee/items/${facts.repositoryId}/${facts.number}.`,
        ]
      : []),
    "The only valid addresses for this fee are the ones Slop publishes: in this comment from Slopbot and on slop.cash. Nobody from Slop or from this project sends a payment address in a message or in another comment.",
    "If you are an AI agent, do not move money. Hand this to the person you work for, who makes the payment.",
  ].join("\n\n");
}

export function feePaidComment(
  facts: CommentFacts & {
    paidNetwork: string | null;
    paidDepositId: number | null;
    outcome: { kind: "refund_due" | "kept_due"; why: FeeOutcomeWhy } | null;
  },
): string {
  const network = facts.ways.find((way) => way.network === facts.paidNetwork);
  const where =
    facts.paidDepositId !== null && network
      ? `: deposit ${facts.paidDepositId} on ${network.networkName}`
      : "";
  const outcome =
    facts.outcome === null
      ? []
      : [
          facts.outcome.kind === "kept_due"
            ? `**Fee kept.** This pull request stayed closed without a merge for ${SUBMISSION_FEE_KEPT_AFTER_CLOSED_DAYS} days, so the deposit is kept: a ${stableNames(facts.ways)} deposit by Slop${facts.ways.some((way) => !way.stable) ? ", a SLOP deposit burned" : ""}.`
            : facts.outcome.why === "merged"
              ? "**Refund due.** This pull request was merged, so the deposit is due back to the wallet that paid it."
              : `**Refund due.** No maintainer merged or closed this pull request within ${SUBMISSION_FEE_REFUND_UNDECIDED_DAYS} days of the deposit, so it is due back to the wallet that paid it.`,
        ];
  return [
    FEE_MARKER,
    "**Submission fee received**",
    `A deposit for this pull request was seen${where}. Slopbot reviews this pull request as usual.`,
    ...outcome,
    "**What happens to the deposit**",
    outcomeRules(facts.ways).join("\n"),
    "The only valid addresses for this fee are the ones Slop publishes. Nobody from Slop or from this project sends a payment address in a message or in another comment.",
  ].join("\n\n");
}

export function feeReleasedComment(why: FeeReleaseWhy): string {
  return [
    FEE_MARKER,
    "**No submission fee is needed for this pull request**",
    `${
      why === "setting-off"
        ? "This project no longer asks a submission fee."
        : "Its author now has write access to the repository or is a member of its organisation."
    } Slopbot reviews this pull request as usual. Do not send a deposit for it: one sent now does not count and goes back.`,
  ].join("\n\n");
}

// ---------------------------------------------------------------------------
// D1 rows.

type ItemRow = {
  project_id: string;
  item: string;
  stable_minor: string;
  asked_at: string;
  paid_at: string | null;
  paid_network: string | null;
  paid_deposit_id: number | null;
  outcome: string | null;
};

type GateState = "recorded" | "asking" | "asked" | "paid" | "released";
type GateRow = {
  state: GateState;
  reason: string;
  comment_id: number | null;
  updated_at: string;
  next_check_at: string | null;
};

function itemRow(db: store.D1Database, job: PullRef) {
  return db
    .prepare(
      `SELECT project_id, item, stable_minor, asked_at, paid_at, paid_network, paid_deposit_id, outcome
       FROM submission_fee_items WHERE repository_id = ? AND pull_number = ?`,
    )
    .bind(job.repositoryId, job.number)
    .first<ItemRow>();
}

function gateRow(db: store.D1Database, job: PullRef) {
  return db
    .prepare(
      `SELECT state, reason, comment_id, updated_at, next_check_at
       FROM slopbot_fee_gates WHERE repository_id = ? AND pull_number = ?`,
    )
    .bind(job.repositoryId, job.number)
    .first<GateRow>();
}

async function saveGate(
  db: store.D1Database,
  job: PullRef,
  next: {
    state: GateState;
    reason: string;
    commentId: number | null;
    nextCheckAt: string | null;
  },
  at: string,
) {
  await db
    .prepare(
      `INSERT INTO slopbot_fee_gates (repository_id, pull_number, installation_id, owner, repo, state, reason, comment_id, updated_at, next_check_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(repository_id, pull_number) DO UPDATE SET
         installation_id = excluded.installation_id, owner = excluded.owner, repo = excluded.repo,
         state = excluded.state, reason = excluded.reason, comment_id = excluded.comment_id,
         updated_at = excluded.updated_at, next_check_at = excluded.next_check_at`,
    )
    .bind(
      job.repositoryId,
      job.number,
      job.installationId,
      job.owner,
      job.repo,
      next.state,
      next.reason.slice(0, 300),
      next.commentId,
      at,
      next.nextCheckAt,
    )
    .run();
}

/**
 * When the project's setting was last turned on: the time of the first
 * revision after the latest one that had it off. Null while it is off. Every
 * revision is immutable, so this never moves for a setting that stays on.
 */
export async function feeSettingSince(
  db: store.D1Database,
  projectId: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT MIN(r.created_at) AS since FROM project_revisions r
       WHERE r.project_id = ?1 AND r.revision > COALESCE((
         SELECT MAX(off.revision) FROM project_revisions off
         WHERE off.project_id = ?1
           AND COALESCE(json_extract(off.manifest, '$.slopbot.submissionFee.enabled'), 0) <> 1
       ), 0)`,
    )
    .bind(projectId)
    .first<{ since: string | null }>();
  return row?.since ?? null;
}

/** Whether the project's stored setting is on, read like the dispatcher. */
async function feeSettingOn(
  db: store.D1Database,
  projectId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT 1 AS ok FROM projects WHERE id = ? AND json_extract(manifest, '$.slopbot.submissionFee.enabled') = 1",
    )
    .bind(projectId)
    .first();
  return row !== null;
}

/** True while Slopbot has asked for this pull request's fee and none is paid. */
export async function feeUnpaid(
  db: store.D1Database,
  repositoryId: number,
  pullNumber: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM slopbot_fee_gates g
       JOIN submission_fee_items i ON i.repository_id = g.repository_id AND i.pull_number = g.pull_number
       WHERE g.repository_id = ? AND g.pull_number = ? AND g.state IN ('asking','asked') AND i.paid_at IS NULL`,
    )
    .bind(repositoryId, pullNumber)
    .first();
  return row !== null;
}

// ---------------------------------------------------------------------------
// GitHub writes.

function labelPath(job: PullRef, label?: string) {
  return `/repos/${job.owner}/${job.repo}/issues/${job.number}/labels${label === undefined ? "" : `/${encodeURIComponent(label)}`}`;
}

async function addLabel(github: GitHubClient, job: PullRef, label: string) {
  const result = await github.request<{ name: string }[]>(
    "POST",
    labelPath(job),
    { labels: [label] },
  );
  if (
    result.status !== 200 ||
    !Array.isArray(result.data) ||
    !result.data.some((entry) => entry.name === label)
  )
    throw new GitHubError(
      result.status,
      "GitHub did not confirm the label addition",
    );
}

async function removeLabel(github: GitHubClient, job: PullRef, label: string) {
  const removed = await github.request<unknown>(
    "DELETE",
    labelPath(job, label),
  );
  if (removed.status !== 200 && removed.status !== 404)
    throw new GitHubError(
      removed.status,
      "GitHub did not confirm the label removal",
    );
}

/**
 * Write Slopbot's one fee comment and return its id. The stored id is used
 * first; otherwise the comment is found by the App's own account and the
 * marker, never by text alone, so a pasted marker is not Slopbot's comment.
 */
async function writeFeeComment(
  env: FeeEnv,
  github: GitHubClient,
  job: PullRef,
  storedId: number | null,
  body: string,
): Promise<number> {
  let id = storedId;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (id === null)
      id = await findReviewComment(
        github,
        job.owner,
        job.repo,
        job.number,
        env.SLOPBOT_APP_USER_ID,
        FEE_MARKER,
      );
    if (id === null) break;
    const updated = await github.request<{ id: number }>(
      "PATCH",
      `/repos/${job.owner}/${job.repo}/issues/comments/${id}`,
      { body },
    );
    if (updated.status === 200 && updated.data?.id === id) return id;
    if (updated.status !== 404)
      throw new GitHubError(
        updated.status,
        "GitHub did not confirm the comment update",
      );
    // The stored comment was deleted: look once more, then post a new one.
    id = null;
  }
  const created = await github.request<{ id: number }>(
    "POST",
    `/repos/${job.owner}/${job.repo}/issues/${job.number}/comments`,
    { body },
  );
  if (
    created.status !== 201 ||
    created.data === null ||
    !Number.isSafeInteger(created.data.id) ||
    created.data.id <= 0
  )
    throw new GitHubError(
      created.status,
      "GitHub did not confirm the comment creation",
    );
  return created.data.id;
}

function commentFacts(
  job: PullRef,
  row: Pick<ItemRow, "item" | "stable_minor">,
  ways: readonly FeeWay[],
): CommentFacts {
  return {
    owner: job.owner,
    repo: job.repo,
    number: job.number,
    repositoryId: job.repositoryId,
    item: row.item,
    stableMinor: row.stable_minor,
    ways,
  };
}

/** True for a first ask still held by a job that may be writing it. */
function askInFlight(gate: GateRow, at: string): boolean {
  return (
    gate.state === "asking" &&
    Date.parse(gate.updated_at) > Date.parse(at) - FEE_ASK_LEASE_MS
  );
}

/** An ask that can be taken back: finished, or abandoned by a dead job. */
function askStands(gate: GateRow | null, at: string): gate is GateRow {
  return (
    gate !== null &&
    (gate.state === "asked" ||
      (gate.state === "asking" && !askInFlight(gate, at)))
  );
}

/**
 * The fee stopped applying before it was paid: take the ask back. The label
 * comes off and the comment says so, open or closed, so a pull request that
 * is reopened later does not still read as waiting for a fee.
 */
async function releaseFee(
  env: FeeEnv,
  github: GitHubClient,
  job: PullRef,
  gate: GateRow,
  why: FeeReleaseWhy,
  at: string,
) {
  await removeLabel(github, job, FEE_NEEDED_LABEL);
  const commentId = await writeFeeComment(
    env,
    github,
    job,
    gate.comment_id,
    feeReleasedComment(why),
  );
  await saveGate(
    env.SLOPBOT_DB,
    job,
    { state: "released", reason: why, commentId, nextCheckAt: null },
    at,
  );
}

/**
 * An author who was asked and has since gained write access, or joined the
 * organisation, is no longer an outside contributor. The review skips such an
 * author before it reaches the gate, so the ask is taken back here.
 */
export async function releaseExemptFee(
  env: FeeEnv,
  input: { job: PullRef; github: GitHubClient; now?: Date },
): Promise<boolean> {
  if (feeMode(env.SUBMISSION_FEE_MODE) !== "live" || feeWays().length === 0)
    return false;
  const db = env.SLOPBOT_DB;
  const at = (input.now ?? new Date()).toISOString();
  const gate = await gateRow(db, input.job);
  if (!askStands(gate, at)) return false;
  const row = await itemRow(db, input.job);
  if (row === null || row.paid_at !== null) return false;
  await releaseFee(env, input.github, input.job, gate, "author-exempt", at);
  return true;
}

// ---------------------------------------------------------------------------
// The gate, called by the review before any model call.

export type FeeGateInput = {
  job: PullRef;
  github: GitHubClient;
  projectId: string;
  exemption: Exemption;
  /** When GitHub says the pull request was opened. */
  openedAt: string | null | undefined;
  /**
   * False when the review would be refused for another reason even if the fee
   * were paid (the month's free reviews are used up): nothing new is asked.
   */
  mayAsk: boolean;
  now?: Date;
};

/**
 * Decide whether this review waits for a submission fee. Returns
 * `FEE_NEEDED_REASON` when it does, null when the review runs. The caller has
 * already skipped closed and merged items, drafts, bots and (unless the
 * repository reviews them) exempt authors, and passes pull requests of a
 * project open to contributor work only.
 */
export async function gateSubmissionFee(
  env: FeeEnv,
  input: FeeGateInput,
): Promise<typeof FEE_NEEDED_REASON | null> {
  const mode = feeMode(env.SUBMISSION_FEE_MODE);
  if (mode === "off") return null;
  const ways = feeWays();
  if (ways.length === 0) return null;
  const db = env.SLOPBOT_DB;
  const { job, github } = input;
  const at = (input.now ?? new Date()).toISOString();
  const row = await itemRow(db, job);
  const gate = await gateRow(db, job);
  // A deposit was accepted: the review runs. The scheduled check swaps the
  // label and times the outcome.
  if (mode === "live" && row !== null && row.paid_at !== null) return null;

  const project = await registeredProject(db, job);
  const fee =
    project !== null && project.id === input.projectId
      ? submissionFeeSetting(project)
      : null;
  const since =
    fee === null ? null : await feeSettingSince(db, input.projectId);
  const opened = Date.parse(input.openedAt ?? "");
  const applies =
    fee !== null &&
    input.exemption === "not-exempt" &&
    since !== null &&
    Number.isFinite(opened) &&
    opened > Date.parse(since);

  if (mode === "dry_run") {
    // Record what live would ask, so nothing past the monthly cap. Nothing
    // is written to GitHub and the review runs as it does today.
    if (applies && fee !== null && row === null && input.mayAsk) {
      await db
        .prepare(
          `INSERT OR IGNORE INTO submission_fee_items (repository_id, pull_number, project_id, item, stable_minor, asked_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          job.repositoryId,
          job.number,
          input.projectId,
          submissionFeeItem(job.repositoryId, job.number),
          fee.amountMinor,
          at,
        )
        .run();
      await db
        .prepare(
          `INSERT OR IGNORE INTO slopbot_fee_gates (repository_id, pull_number, installation_id, owner, repo, state, reason, comment_id, updated_at, next_check_at)
           VALUES (?, ?, ?, ?, ?, 'recorded', ?, NULL, ?, NULL)`,
        )
        .bind(
          job.repositoryId,
          job.number,
          job.installationId,
          job.owner,
          job.repo,
          `${FEE_NEEDED_REASON}: record only, review ran`,
          at,
        )
        .run();
    }
    return null;
  }

  if (!applies || fee === null) {
    // An earlier ask no longer applies: the owner turned the setting off, or
    // the author gained write access. Unknown exemption changes nothing, and
    // an ask another job is still writing is left to finish first.
    if (askStands(gate, at) && (fee === null || input.exemption === "exempt")) {
      await releaseFee(
        env,
        github,
        job,
        gate,
        fee === null ? "setting-off" : "author-exempt",
        at,
      );
      return null;
    }
    // Otherwise an ask already made stands until it is paid or released.
    return gate?.state === "asked" || gate?.state === "asking"
      ? FEE_NEEDED_REASON
      : null;
  }

  // `paid` with no payment: the Worker withdrew a deposit that a chain
  // reorganisation removed. The review waits again; the fee check puts the
  // label and comment back.
  if (gate?.state === "asked" || gate?.state === "paid")
    return FEE_NEEDED_REASON;
  if (!input.mayAsk) return null;

  // First sight. One job takes the ask; another that arrives meanwhile waits
  // for it without writing a second comment.
  const claimed = await db
    .prepare(
      `INSERT INTO slopbot_fee_gates (repository_id, pull_number, installation_id, owner, repo, state, reason, comment_id, updated_at, next_check_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'asking', ?6, NULL, ?7, NULL)
       ON CONFLICT(repository_id, pull_number) DO UPDATE SET
         installation_id = excluded.installation_id, owner = excluded.owner, repo = excluded.repo,
         state = 'asking', reason = excluded.reason, updated_at = excluded.updated_at, next_check_at = NULL
       WHERE slopbot_fee_gates.state IN ('recorded', 'released')
          OR (slopbot_fee_gates.state = 'asking' AND slopbot_fee_gates.updated_at <= ?8)`,
    )
    .bind(
      job.repositoryId,
      job.number,
      job.installationId,
      job.owner,
      job.repo,
      FEE_NEEDED_REASON,
      at,
      new Date(Date.parse(at) - FEE_ASK_LEASE_MS).toISOString(),
    )
    .run();
  if ((claimed.meta?.changes ?? 0) !== 1) return FEE_NEEDED_REASON;

  // The amount is fixed here: a later change of the setting applies to pull
  // requests first asked after it. A row that was only recorded, or released,
  // takes the amount of this real first ask.
  const item = submissionFeeItem(job.repositoryId, job.number);
  await db
    .prepare(
      `INSERT INTO submission_fee_items (repository_id, pull_number, project_id, item, stable_minor, asked_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(repository_id, pull_number) DO UPDATE SET
         project_id = excluded.project_id, stable_minor = excluded.stable_minor, asked_at = excluded.asked_at
       WHERE submission_fee_items.paid_at IS NULL`,
    )
    .bind(
      job.repositoryId,
      job.number,
      input.projectId,
      item,
      fee.amountMinor,
      at,
    )
    .run();
  if (!(await scopeAllowed(db, job, "contributor")))
    throw new Error("Repository is not active in the Slop project registry");
  const commentId = await writeFeeComment(
    env,
    github,
    job,
    gate?.comment_id ?? null,
    feeNeededComment(
      commentFacts(
        job,
        { item, stable_minor: fee.amountMinor },
        feeWays(fee.amountMinor, await feeRates(db), at),
      ),
    ),
  );
  await addLabel(github, job, FEE_NEEDED_LABEL);
  await db
    .prepare(
      `UPDATE slopbot_fee_gates SET state = 'asked', comment_id = ?, updated_at = ?
       WHERE repository_id = ? AND pull_number = ? AND state = 'asking'`,
    )
    .bind(commentId, at, job.repositoryId, job.number)
    .run();
  return FEE_NEEDED_REASON;
}

// ---------------------------------------------------------------------------
// The outcome. Pure: every fact is read by the caller.

export type FeeOutcomeFacts = {
  paidAt: string;
  merged: boolean;
  /** Closed without a merge. */
  closed: boolean;
  closedAt: string | null;
};

export type FeeOutcome =
  | {
      outcome: "refund_due" | "kept_due";
      why: FeeOutcomeWhy;
      nextCheckAt: null;
    }
  | { outcome: null; why: null; nextCheckAt: string };

export function feeOutcome(facts: FeeOutcomeFacts, now: Date): FeeOutcome {
  if (facts.merged)
    return { outcome: "refund_due", why: "merged", nextCheckAt: null };
  const paid = Date.parse(facts.paidAt);
  const time = now.getTime();
  const wait = (until: number): FeeOutcome => ({
    outcome: null,
    why: null,
    nextCheckAt: new Date(until).toISOString(),
  });
  if (facts.closed) {
    const closedAt = Date.parse(facts.closedAt ?? "");
    // Without a close time, wait rather than keep a fee on a guess.
    if (!Number.isFinite(closedAt) || !Number.isFinite(paid))
      return wait(time + FEE_RECHECK_MS);
    // A deposit made after the close still gets the full wait.
    const due =
      Math.max(closedAt, paid) + SUBMISSION_FEE_KEPT_AFTER_CLOSED_DAYS * DAY_MS;
    return time >= due
      ? { outcome: "kept_due", why: "closed", nextCheckAt: null }
      : wait(due);
  }
  if (!Number.isFinite(paid)) return wait(time + FEE_RECHECK_MS);
  const due = paid + SUBMISSION_FEE_REFUND_UNDECIDED_DAYS * DAY_MS;
  return time >= due
    ? { outcome: "refund_due", why: "undecided", nextCheckAt: null }
    : // A merge or close whose webhook was lost is still seen within a day.
      wait(Math.min(due, time + FEE_RECHECK_MS));
}

// ---------------------------------------------------------------------------
// The scheduled and event-driven check of one asked pull request.

type Pull = {
  number: number;
  state: string;
  draft?: boolean;
  merged?: boolean;
  closed_at?: string | null;
  labels?: { name: string }[];
};

export function feeJob(base: Omit<FeeJob, "kind" | "itemKind">): FeeJob {
  return { kind: "submission_fee", itemKind: "pull_request", ...base };
}

/**
 * True when an event for this pull request should queue a fee check: a paid
 * fee with no outcome yet. With `unmarkedOnly`, only one whose label Slopbot
 * has not swapped yet.
 */
export async function feeCheckWanted(
  env: Pick<FeeEnv, "SLOPBOT_DB" | "SUBMISSION_FEE_MODE">,
  job: Pick<Job, "repositoryId"> & { number: number },
  unmarkedOnly = false,
): Promise<boolean> {
  if (feeMode(env.SUBMISSION_FEE_MODE) !== "live") return false;
  const row = await env.SLOPBOT_DB.prepare(
    `SELECT 1 AS ok FROM submission_fee_items i
       JOIN slopbot_fee_gates g ON g.repository_id = i.repository_id AND g.pull_number = i.pull_number
       WHERE i.repository_id = ?1 AND i.pull_number = ?2 AND i.paid_at IS NOT NULL AND i.outcome IS NULL
         AND (?3 = 0 OR g.state <> 'paid')`,
  )
    .bind(job.repositoryId, job.number, unmarkedOnly ? 1 : 0)
    .first();
  return row !== null;
}

/**
 * Re-read one asked pull request: mark it paid and release its review, set
 * the refund or kept outcome when it is due, or take the ask back when the
 * project stopped asking. `review` is true when the skipped review should
 * run now.
 */
export async function refreshSubmissionFee(
  env: FeeEnv,
  job: FeeJob,
  now: Date = new Date(),
): Promise<{ outcome: string; review: boolean }> {
  const done = (outcome: string, review = false) => ({ outcome, review });
  if (feeMode(env.SUBMISSION_FEE_MODE) !== "live")
    return done("submission fee is not live");
  const ways = feeWays();
  if (ways.length === 0) return done("no deposit contract is published");
  const db = env.SLOPBOT_DB;
  const at = now.toISOString();
  const row = await itemRow(db, job);
  const gate = await gateRow(db, job);
  if (row === null || gate === null) return done("no submission fee asked");
  if (!(await store.installationActive(db, job.installationId)))
    return done("installation removed or suspended");
  const github = await GitHubClient.forInstallation(
    env.SLOPBOT_APP_ID,
    env.SLOPBOT_APP_PRIVATE_KEY,
    job.installationId,
  );
  const pull = await github.get<Pull>(
    `/repos/${job.owner}/${job.repo}/pulls/${job.number}`,
  );
  if (pull === null) return done("pull request not readable");
  const merged = pull.merged === true;
  const open = pull.state === "open" && !merged;
  const reviewable = open && pull.draft !== true;

  if (row.paid_at === null) {
    // The stored setting, whatever the project's status: a paused project
    // whose owner turned the fee off still has its asks taken back.
    if (askStands(gate, at) && !(await feeSettingOn(db, row.project_id))) {
      await releaseFee(env, github, job, gate, "setting-off", at);
      return done("submission fee released: setting off", reviewable);
    }
    if (gate.state === "paid") {
      // The Worker withdrew the payment before it was final (the deposit's
      // block was reorganised away). The pull request is asked again.
      if (await scopeAllowed(db, job, "contributor")) {
        await removeLabel(github, job, FEE_PAID_LABEL);
        if (open) await addLabel(github, job, FEE_NEEDED_LABEL);
      }
      const commentId = await writeFeeComment(
        env,
        github,
        job,
        gate.comment_id,
        feeNeededComment(
          commentFacts(
            job,
            row,
            feeWays(row.stable_minor, await feeRates(db), at),
          ),
        ),
      );
      await saveGate(
        db,
        job,
        {
          state: "asked",
          reason: `${FEE_NEEDED_REASON}: payment withdrawn`,
          commentId,
          nextCheckAt: null,
        },
        at,
      );
      return done("submission fee payment withdrawn; asked again");
    }
    await saveGate(
      db,
      job,
      {
        state: gate.state,
        reason: gate.reason,
        commentId: gate.comment_id,
        nextCheckAt: null,
      },
      at,
    );
    return done("submission fee not paid");
  }

  // A job is still writing the first ask: let it finish, then look again.
  if (askInFlight(gate, at)) {
    await saveGate(
      db,
      job,
      {
        state: gate.state,
        reason: gate.reason,
        commentId: gate.comment_id,
        nextCheckAt: new Date(now.getTime() + FEE_ASK_LEASE_MS).toISOString(),
      },
      gate.updated_at,
    );
    return done("submission fee ask in progress");
  }
  const facts = commentFacts(
    job,
    row,
    feeWays(row.stable_minor, await feeRates(db), at),
  );
  const paidFacts = {
    ...facts,
    paidNetwork: row.paid_network,
    paidDepositId: row.paid_deposit_id,
  };
  let commentId = gate.comment_id;
  let review = false;
  if (gate.state !== "paid") {
    // Labels need a project open to contributor work; the comment does not.
    if (await scopeAllowed(db, job, "contributor")) {
      await removeLabel(github, job, FEE_NEEDED_LABEL);
      await addLabel(github, job, FEE_PAID_LABEL);
    }
    commentId = await writeFeeComment(
      env,
      github,
      job,
      commentId,
      feePaidComment({ ...paidFacts, outcome: null }),
    );
    review = reviewable;
  }

  let reason = "fee-paid";
  let nextCheckAt: string | null = null;
  if (row.outcome === null) {
    const decided = feeOutcome(
      {
        paidAt: row.paid_at,
        merged,
        closed: pull.state !== "open" && !merged,
        closedAt: pull.closed_at ?? null,
      },
      now,
    );
    nextCheckAt = decided.nextCheckAt;
    if (decided.outcome !== null) {
      // Slopbot only ever sets a due outcome on a paid, undecided row.
      const written = await db
        .prepare(
          `UPDATE submission_fee_items SET outcome = ?, outcome_at = ?
           WHERE repository_id = ? AND pull_number = ? AND paid_at IS NOT NULL AND outcome IS NULL`,
        )
        .bind(decided.outcome, at, job.repositoryId, job.number)
        .run();
      if ((written.meta?.changes ?? 0) === 1) {
        reason = `${decided.outcome}: ${decided.why}`;
        commentId = await writeFeeComment(
          env,
          github,
          job,
          commentId,
          feePaidComment({
            ...paidFacts,
            outcome: { kind: decided.outcome, why: decided.why },
          }),
        );
      }
    }
  } else reason = row.outcome;
  await saveGate(
    db,
    job,
    { state: "paid", reason, commentId, nextCheckAt },
    at,
  );
  return done(
    gate.state === "paid" ? `submission fee: ${reason}` : "submission fee paid",
    review,
  );
}

/** The review job that runs once a pull request's fee is paid or released. */
export function feeReviewJob(
  job: FeeJob,
  at: string,
): Extract<Job, { kind: "review" }> {
  return {
    kind: "review",
    deliveryId: `fee-review:${job.repositoryId}:${job.number}:${at}`,
    installationId: job.installationId,
    repositoryId: job.repositoryId,
    owner: job.owner,
    repo: job.repo,
    itemKind: "pull_request",
    number: job.number,
  };
}

/**
 * Scheduled: queue the checks no webhook announces. A newly paid pull
 * request, a paid one whose timer is due, one whose payment was withdrawn,
 * and an asked one whose project no longer has the setting on.
 */
export async function dispatchFeeChecks(
  env: Pick<FeeEnv, "SUBMISSION_FEE_MODE"> & {
    SLOPBOT_DB: store.D1Database<store.D1QueryStatement>;
  },
  queue: Queue,
  now: Date = new Date(),
): Promise<number> {
  if (feeMode(env.SUBMISSION_FEE_MODE) !== "live" || feeWays().length === 0)
    return 0;
  const db = env.SLOPBOT_DB;
  const at = now.toISOString();
  const due = await db
    .prepare(
      `SELECT g.repository_id, g.pull_number, g.installation_id, g.owner, g.repo
       FROM slopbot_fee_gates g
       JOIN submission_fee_items i ON i.repository_id = g.repository_id AND i.pull_number = g.pull_number
       WHERE (g.next_check_at IS NOT NULL AND g.next_check_at <= ?1)
          OR (g.next_check_at IS NULL AND g.state <> 'paid' AND i.paid_at IS NOT NULL)
          OR (g.state = 'paid' AND i.paid_at IS NULL AND i.outcome IS NULL
              AND (g.next_check_at IS NULL OR g.next_check_at <= ?1 OR g.next_check_at > ?3))
          OR (g.next_check_at IS NULL AND g.state = 'asked' AND i.paid_at IS NULL AND NOT EXISTS (
                SELECT 1 FROM projects p WHERE p.id = i.project_id
                  AND json_extract(p.manifest, '$.slopbot.submissionFee.enabled') = 1))
       ORDER BY g.next_check_at IS NULL, g.next_check_at, g.updated_at LIMIT ?2`,
    )
    // ?3: a time later than any claim below, so a paid row's own timer does
    // not hide a withdrawn payment while a fresh claim still does.
    .bind(
      at,
      FEE_DISPATCH_BATCH,
      new Date(now.getTime() + FEE_ASK_LEASE_MS).toISOString(),
    )
    .all<{
      repository_id: number;
      pull_number: number;
      installation_id: number;
      owner: string;
      repo: string;
    }>();
  const rows = due.results;
  for (const row of rows) {
    // Claim before sending, so an overlapping run does not queue it twice;
    // the job sets the next time itself.
    await db
      .prepare(
        "UPDATE slopbot_fee_gates SET next_check_at = ? WHERE repository_id = ? AND pull_number = ?",
      )
      .bind(
        new Date(now.getTime() + FEE_ASK_LEASE_MS).toISOString(),
        row.repository_id,
        row.pull_number,
      )
      .run();
    await queue.send(
      feeJob({
        deliveryId: `fee:${row.repository_id}:${row.pull_number}:${at}`,
        installationId: row.installation_id,
        repositoryId: row.repository_id,
        owner: row.owner,
        repo: row.repo,
        number: row.pull_number,
      }),
    );
  }
  return rows.length;
}
