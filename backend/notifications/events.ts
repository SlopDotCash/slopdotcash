/**
 * Inbox event statements (PRD NOT-01, migrations 0024 and 0063). Each writer
 * adds one of these to the same D1 batch as its source change, after that
 * change, so the notification commits only with it. Every statement reads its
 * facts back from the committed source row, so a change that did not happen
 * writes nothing, and the (event_key, recipient) key makes a replay a no-op:
 * one source transition is one event.
 *
 * Notices report outcomes and exceptions, not routine admission steps:
 * setup completion (`project_ready`), failed checks (`project_scan_failed`,
 * `project_installation_lost`), payment exceptions (`payout_held`,
 * `payout_exception`) and private report receipts
 * (`security_report_received`). Only private case notices that ask a role
 * holder to act (`security_case`) carry an acknowledgment and escalation;
 * every other notice is read state only.
 */

type Preparer<S> = {
  prepare(query: string): { bind(...values: unknown[]): S };
};

const INSERT = `INSERT INTO notifications (
  event_key, recipient_github_id, kind, subject, detail, action_path,
  source_at, created_at
)`;
const ONCE = "ON CONFLICT (event_key, recipient_github_id) DO NOTHING";

/**
 * The account that listed a project: the applicant of an approved
 * application, or the creator of revision 1 of a self-service project.
 */
const LISTED_BY = (
  projectId: string,
) => `SELECT a.applicant_github_id AS recipient
             FROM projects p
             JOIN project_applications a ON a.id = p.source_application_id
            WHERE p.id = ${projectId}
           UNION
           SELECT first.actor_github_id
             FROM projects p
             JOIN project_revisions first
               ON first.project_id = p.id AND first.revision = 1
            WHERE p.id = ${projectId} AND p.source_application_id IS NULL
              AND first.actor_github_id IS NOT NULL`;

/** SQL that keeps only canonical GitHub account ids as recipients. */
const GITHUB_ID = (column: string) =>
  `typeof(${column}) = 'text' AND length(${column}) BETWEEN 1 AND 20
   AND ${column} GLOB '[1-9]*' AND ${column} NOT GLOB '*[^0-9]*'`;

/**
 * The people who answer for a project: the account that listed it and its
 * current GitHub steward. `project` is a SQL expression for the project id.
 */
const PROJECT_OWNERS = (project: string) => `(
  ${LISTED_BY(project)}
  UNION
  SELECT json_extract(manifest, '$.steward.github.actorId')
    FROM projects
   WHERE id = ${project}
)`;

/**
 * A manifest revision reaches the account that listed the project (its
 * applicant, or its self-service creator) and its GitHub steward, never the
 * account that made the revision. A revision that makes the project active,
 * from nothing or from paused, is setup completion or a return to work and is
 * reported as `project_ready`; any other later revision is
 * `project_revision`. A first revision that is not active only lists the
 * project, so it writes nothing.
 */
export function notifyProjectRevision<S>(
  db: Preparer<S>,
  projectId: string,
  revision: number,
  manifestSha256: string,
  at: string,
): S {
  return db
    .prepare(
      `${INSERT}
       SELECT 'project-revision:' || r.project_id || ':' || r.revision,
              recipient,
              CASE WHEN r.ready THEN 'project_ready' ELSE 'project_revision' END,
              r.project_id, CASE WHEN r.ready THEN NULL ELSE r.reason END,
              '/projects/' || r.project_id, r.created_at, ?4
         FROM (
           SELECT rev.*,
                  json_extract(rev.manifest, '$.status') = 'active' AND
                  COALESCE((SELECT json_extract(prior.manifest, '$.status')
                              FROM project_revisions prior
                             WHERE prior.project_id = rev.project_id
                               AND prior.revision = rev.revision - 1),
                           'none') <> 'active' AS ready
             FROM project_revisions rev
            WHERE rev.project_id = ?1 AND rev.revision = ?2
              AND rev.manifest_sha256 = ?3 AND rev.created_at = ?4
         ) r
         JOIN (
           ${LISTED_BY("?1")}
           UNION
           SELECT json_extract(manifest, '$.steward.github.actorId')
             FROM project_revisions
            WHERE project_id = ?1 AND revision = ?2
              AND json_type(manifest, '$.steward.github.actorId') = 'text'
         )
        WHERE (r.revision > 1 OR r.ready)
          AND recipient IS NOT r.actor_github_id
          AND ${GITHUB_ID("recipient")}
       ${ONCE}`,
    )
    .bind(projectId, revision, manifestSha256, at);
}

/**
 * A completed scan that could not establish clearance (state `incomplete`)
 * reaches the project's owners, once per assessment. A malicious result is
 * reported by its enforcement record instead; a clean result needs no notice
 * because the project status shows it.
 */
export function notifyProjectScanFailed<S>(
  db: Preparer<S>,
  assessmentId: string,
): S {
  return db
    .prepare(
      `${INSERT}
       SELECT 'project-scan:' || v.id, owners.recipient, 'project_scan_failed',
              v.project_id, NULL, '/projects/' || v.project_id,
              v.completed_at, v.completed_at
         FROM vetting_assessments v
         JOIN ${PROJECT_OWNERS("(SELECT project_id FROM vetting_assessments WHERE id = ?1)")} owners
        WHERE v.id = ?1 AND v.state = 'incomplete' AND v.completed_at IS NOT NULL
          AND ${GITHUB_ID("owners.recipient")}
       ${ONCE}`,
    )
    .bind(assessmentId);
}

/**
 * Slopbot's GitHub installation was suspended or removed at `at`. Each
 * project with a registered repository under that account reaches its
 * owners once, because reviews stop until Slopbot is installed again.
 */
export function notifySlopbotInstallationLost<S>(
  db: Preparer<S>,
  installationId: number,
  at: string,
): S {
  return db
    .prepare(
      `${INSERT}
       SELECT 'slopbot-installation:' || i.installation_id || ':' || ?2 || ':' || p.id,
              owners.recipient, 'project_installation_lost', p.id, NULL,
              '/projects/' || p.id, ?2, ?2
         FROM slopbot_installations i
         JOIN projects p ON EXISTS (
           SELECT 1 FROM project_repositories r
            WHERE r.project_id = p.id
              AND substr(r.repository_key, 1, length(i.account_login) + 1) =
                  lower(i.account_login) || '/'
         )
         JOIN (
           SELECT p2.id AS project_id, a.applicant_github_id AS recipient
             FROM projects p2
             JOIN project_applications a ON a.id = p2.source_application_id
           UNION
           SELECT p2.id, first.actor_github_id
             FROM projects p2
             JOIN project_revisions first
               ON first.project_id = p2.id AND first.revision = 1
            WHERE p2.source_application_id IS NULL
              AND first.actor_github_id IS NOT NULL
           UNION
           SELECT id, json_extract(manifest, '$.steward.github.actorId')
             FROM projects
         ) owners ON owners.project_id = p.id
        WHERE i.installation_id = ?1
          AND (i.removed_at = ?2 OR i.suspended_at = ?2)
          AND ${GITHUB_ID("owners.recipient")}
       ${ONCE}`,
    )
    .bind(installationId, at);
}

/** A finalized reservation: an award is now set aside for the contributor. */
export function notifyAwardReserved<S>(
  db: Preparer<S>,
  obligationId: string,
  at: string,
): S {
  return db
    .prepare(
      `${INSERT}
       SELECT 'payment-reserved:' || id, github_user_id, 'award_reserved',
              project_id, NULL, '/earnings', created_at, ?
         FROM payment_obligations WHERE id = ?
       ${ONCE}`,
    )
    .bind(at, obligationId);
}

/** A finalized payout transaction to the contributor's authorized wallet. */
export function notifyPaymentPaid<S>(
  db: Preparer<S>,
  obligationId: string,
  transactionId: string,
  at: string,
): S {
  return db
    .prepare(
      `${INSERT}
       SELECT 'payment-paid:' || o.id, o.github_user_id, 'payment_paid',
              o.project_id, NULL, '/earnings', e.observed_at, ?
         FROM payment_obligations o
         JOIN payment_events e
           ON e.obligation_id = o.id AND e.kind = 'paid'
          AND e.transaction_id = o.paid_transaction
        WHERE o.id = ? AND o.state = 'paid' AND o.paid_transaction = ?
       ${ONCE}`,
    )
    .bind(at, obligationId, transactionId);
}

/** A held payout; each hold is its own event, keyed by its time. */
export function notifyPayoutHeld<S>(
  db: Preparer<S>,
  obligationId: string,
  heldAt: string,
): S {
  return db
    .prepare(
      `${INSERT}
       SELECT 'payout-held:' || q.obligation_id || ':' || q.updated_at,
              o.github_user_id, 'payout_held', o.project_id, NULL,
              '/earnings', q.updated_at, ?
         FROM payment_outbox q
         JOIN payment_obligations o ON o.id = q.obligation_id
        WHERE q.obligation_id = ? AND q.state = 'held' AND q.updated_at = ?
       ${ONCE}`,
    )
    .bind(heldAt, obligationId, heldAt);
}

/** A new or replacement payout wallet is an account-security event. */
export function notifyWalletChanged<S>(
  db: Preparer<S>,
  claimId: string,
  at: string,
): S {
  return db
    .prepare(
      `${INSERT}
       SELECT 'wallet-claim:' || id, github_user_id, 'wallet_changed', chain,
              NULL, '/account#wallets', created_at, ?
         FROM wallet_claims WHERE id = ?
       ${ONCE}`,
    )
    .bind(at, claimId);
}

/**
 * A held payout is a payout exception for the project's GitHub steward
 * (migration 0029). The row names only the project, never the contributor or
 * a wallet. A payment database without the project registry has no steward
 * row and writes nothing.
 */
export function notifyPayoutException<S>(
  db: Preparer<S>,
  obligationId: string,
  heldAt: string,
): S {
  return db
    .prepare(
      `${INSERT}
       SELECT 'payout-exception:' || q.obligation_id || ':' || q.updated_at,
              json_extract(p.manifest, '$.steward.github.actorId'),
              'payout_exception', o.project_id, NULL,
              '/projects/' || o.project_id, q.updated_at, ?
         FROM payment_outbox q
         JOIN payment_obligations o ON o.id = q.obligation_id
         JOIN projects p ON p.id = o.project_id
        WHERE q.obligation_id = ? AND q.state = 'held' AND q.updated_at = ?
          AND ${GITHUB_ID("json_extract(p.manifest, '$.steward.github.actorId')")}
       ${ONCE}`,
    )
    .bind(heldAt, obligationId, heldAt);
}

/**
 * An underfunded frozen month is a payout exception for the project's GitHub
 * steward (PRD sections 6 and 9; owner decision D1). The key has no time, so
 * each project month sends one notice however often the coordinator retries.
 * The row names only the project and month, never an amount or a contributor.
 */
export function notifyMonthlyUnderfunded<S>(
  db: Preparer<S>,
  projectId: string,
  period: string,
  at: string,
): S {
  return db
    .prepare(
      `${INSERT}
       SELECT 'monthly-underfunded:' || r.project_id || ':' || r.period,
              json_extract(p.manifest, '$.steward.github.actorId'),
              'payout_exception', r.project_id,
              'The ' || r.period || ' monthly awards wait for funds. No award is created until the vault covers the whole month.',
              '/projects/' || r.project_id || '/awards', r.frozen_at, ?
         FROM monthly_payment_runs r
         JOIN projects p ON p.id = r.project_id
        WHERE r.project_id = ? AND r.period = ?
          AND r.obligations_created_at IS NULL
          AND ${GITHUB_ID("json_extract(p.manifest, '$.steward.github.actorId')")}
       ${ONCE}`,
    )
    .bind(at, projectId, period);
}

/**
 * An ADM-06 enforcement record reaches the applicant who listed the project
 * and its current GitHub steward. The row carries no reason or evidence
 * reference: those stay in the admin panel. The project page shows the
 * public restriction state.
 */
export function notifyProjectEnforcement<S>(
  db: Preparer<S>,
  recordId: string,
): S {
  return db
    .prepare(
      `${INSERT}
       SELECT 'project-enforcement:' || e.id, recipient,
              CASE e.action
                WHEN 'quarantine' THEN 'project_quarantined'
                WHEN 'ban' THEN 'project_banned'
                WHEN 'request_reinstatement' THEN 'reinstatement_requested'
                WHEN 'reinstate' THEN 'project_reinstated'
                WHEN 'deny_reinstatement' THEN 'reinstatement_denied' END,
              e.project_id, NULL, '/projects/' || e.project_id,
              e.created_at, e.created_at
         FROM project_enforcements e
         JOIN ${PROJECT_OWNERS("(SELECT project_id FROM project_enforcements WHERE id = ?1)")}
        WHERE e.id = ?1 AND ${GITHUB_ID("recipient")}
          AND e.action IN ('quarantine', 'ban', 'request_reinstatement',
                           'reinstate', 'deny_reinstatement')
       ${ONCE}`,
    )
    .bind(recordId);
}

/**
 * VET-06 bans reach configured operators and known affected contributors.
 * Membership resolves immutable contribution actor IDs to inbox identities.
 * Payment records also reach contributors who have no points membership.
 * Superseded and zero-credit outcomes do not select an affected contributor.
 * This reads no private trace records and copies no security evidence.
 */
export function notifyVettingBanAudience<S>(
  db: Preparer<S>,
  recordId: string,
  operatorGithubIds: readonly string[],
): S {
  return db
    .prepare(
      `${INSERT}
    SELECT 'project-enforcement:' || e.id, audience.recipient,
           'project_banned', e.project_id, NULL,
           CASE WHEN audience.recipient IN (SELECT value FROM json_each(?2))
                THEN '/admin' ELSE '/projects/' || e.project_id END,
           e.created_at, e.created_at
      FROM project_enforcements e
      JOIN (
        SELECT value AS recipient FROM json_each(?2)
        UNION
        SELECT m.github_id FROM points_revisions r
          JOIN points_members m ON m.actor_id = json_extract(r.payload, '$.award.actor.id')
         WHERE json_extract(r.payload, '$.award.projectId') =
               (SELECT project_id FROM project_enforcements WHERE id = ?1)
           AND json_extract(r.payload, '$.award.amount') > 0
           AND NOT EXISTS (SELECT 1 FROM points_revisions successor WHERE successor.previous = r.id)
        UNION
        SELECT github_user_id FROM payment_obligations
         WHERE project_id = (SELECT project_id FROM project_enforcements WHERE id = ?1)
        UNION
        SELECT github_user_id FROM payment_direct_transfers
         WHERE project_id = (SELECT project_id FROM project_enforcements WHERE id = ?1)
      ) audience
     WHERE e.id = ?1 AND e.action = 'ban' AND e.actor_role = 'vetting-service'
       AND ${GITHUB_ID("audience.recipient")}
    ${ONCE}`,
    )
    .bind(recordId, JSON.stringify(operatorGithubIds));
}

/**
 * A reinstatement request reaches the moderators who may decide it: the
 * caller passes only those who did not place the restriction (ELG-02).
 */
export function notifyReinstatementReviewers<S>(
  db: Preparer<S>,
  recordId: string,
  reviewers: readonly string[],
): S {
  return db
    .prepare(
      `${INSERT}
       SELECT 'reinstatement-review:' || e.id, r.value, 'reinstatement_review',
              e.project_id, NULL, '/admin', e.created_at, e.created_at
         FROM project_enforcements e, json_each(?2) r
        WHERE e.id = ?1 AND e.action = 'request_reinstatement'
          AND r.value <> e.actor_github_id AND ${GITHUB_ID("r.value")}
       ${ONCE}`,
    )
    .bind(recordId, JSON.stringify(reviewers));
}

/**
 * A private security case event (SEC-09). The row holds only the private case
 * reference and a sign-in link: no project, title, severity, amount, reason
 * or advisory. It is written only when this request's own audit event landed
 * at `revision`, so a stale or replayed request writes nothing, and never to
 * the person who acted. `awardState` additionally requires that award state
 * after the change.
 */
export function notifySecurityCase<S>(
  db: Preparer<S>,
  input: {
    caseId: string;
    revision: number;
    idempotencyKey: string;
    recipients: readonly string[];
    awardState?: string;
  },
): S {
  return db
    .prepare(
      `${INSERT}
       SELECT 'security-case:' || e.case_id || ':' || e.case_revision, r.value,
              'security_case', e.case_id, NULL, '/security', e.at, e.at
         FROM security_case_events e, json_each(?4) r
        WHERE e.case_id = ?1 AND e.case_revision = ?2
          AND e.idempotency_key = ?3 AND r.value <> e.actor_github_id
          AND ${GITHUB_ID("r.value")}
          AND (?5 IS NULL OR (SELECT award_state FROM security_cases
                               WHERE id = e.case_id) = ?5)
       ${ONCE}`,
    )
    .bind(
      input.caseId,
      input.revision,
      input.idempotencyKey,
      JSON.stringify(input.recipients),
      input.awardState ?? null,
    );
}

/**
 * Verified receipt of a private report reaches its reporter once per case
 * (PRD section 8). The row holds only the private case reference and a
 * sign-in link. Its private mail uses the receipt template, which asks for
 * no acknowledgment and never escalates for a missed one.
 */
export function notifySecurityReportReceived<S>(
  db: Preparer<S>,
  caseId: string,
): S {
  return db
    .prepare(
      `${INSERT}
       SELECT 'security-receipt:' || c.id, c.reporter_github_id,
              'security_report_received', c.id, NULL, '/security',
              c.verified_at, c.verified_at
         FROM security_cases c
        WHERE c.id = ? AND c.submission_state = 'verified'
          AND c.verified_at IS NOT NULL
          AND ${GITHUB_ID("c.reporter_github_id")}
       ${ONCE}`,
    )
    .bind(caseId);
}

/** Escalation and its moderator notices commit together. Replays use one key. */
export function notifySlopbotAppeal<S>(
  db: Preparer<S>,
  appealKey: string,
  recipient: string,
  at: string,
): S {
  return db
    .prepare(
      `${INSERT}
    SELECT 'slopbot-' || a.appeal_key, ?2, 'slopbot_appeal_review',
           a.item_node_id, NULL, ?4, a.escalated_at, ?3
      FROM slopbot_appeals a
     WHERE a.appeal_key = ?1 AND a.escalated_at IS NOT NULL
       AND a.resolved_at IS NULL AND a.appellant_github_id <> ?2
       AND ${GITHUB_ID("?2")}
    ${ONCE}`,
    )
    .bind(
      appealKey,
      recipient,
      at,
      `/api/v1/notifications/appeals/${encodeURIComponent(appealKey)}`,
    );
}

/** The same-site route that rechecks moderator access, then opens the item. */
export const SCAM_REVIEW_PATH = "/api/v1/notifications/scam-reviews/";
const GITHUB_OWNER = /^[A-Za-z0-9_.-]{1,39}$/u;
const GITHUB_REPO = /^[A-Za-z0-9_.-]{1,100}$/u;
const GITHUB_LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/u;

export type ScamReviewTarget = {
  owner: string;
  repo: string;
  itemKind: "pull_request" | "issue";
  number: number;
};

/** The stored action path of a scam review notice. Rejects any target that
 * is not a canonical GitHub owner, repository, item kind and number. */
export function scamReviewPath(target: ScamReviewTarget): string {
  if (
    !GITHUB_OWNER.test(target.owner) ||
    !GITHUB_REPO.test(target.repo) ||
    (target.itemKind !== "pull_request" && target.itemKind !== "issue") ||
    !Number.isSafeInteger(target.number) ||
    target.number < 1
  )
    throw new Error("Invalid scam review target");
  const kind = target.itemKind === "pull_request" ? "pull" : "issues";
  return `${SCAM_REVIEW_PATH}${target.owner}/${target.repo}/${kind}/${target.number}`;
}

/** The GitHub item behind a stored scam review action path, or null. */
export function scamReviewGitHubUrl(path: string): string | null {
  if (!path.startsWith(SCAM_REVIEW_PATH)) return null;
  const parts = path.slice(SCAM_REVIEW_PATH.length).split("/");
  const [owner = "", repo = "", kind, number = ""] = parts;
  if (
    parts.length !== 4 ||
    (kind !== "pull" && kind !== "issues") ||
    !/^[1-9]\d{0,15}$/u.test(number) ||
    !GITHUB_OWNER.test(owner) ||
    !GITHUB_REPO.test(repo)
  )
    return null;
  return `https://github.com/${owner}/${repo}/${kind}/${number}`;
}

/**
 * Owner decision D4 (PRD section 11): a confirmed Slopbot close in the
 * "Scam or malicious" category asks each configured moderator to review the
 * author's account. The facts come from the committed penalty row, so a close
 * that recorded no moderator-review penalty writes nothing, and the item's
 * node ID keys the event, so a retry or replay never adds a second notice.
 * The author never receives the notice about their own account.
 */
export function notifySlopbotScamReview<S>(
  db: Preparer<S>,
  input: ScamReviewTarget & {
    itemNodeId: string;
    authorLogin: string;
    recipient: string;
    at: string;
  },
): S {
  if (!GITHUB_LOGIN.test(input.authorLogin))
    throw new Error("Invalid scam review author");
  const path = scamReviewPath(input);
  return db
    .prepare(
      `${INSERT}
    SELECT 'slopbot-scam-review:' || p.item_node_id, ?2,
           'slopbot_scam_review', p.project_id, ?3, ?4, p.recorded_at, ?5
      FROM slopbot_penalties p
     WHERE p.item_node_id = ?1 AND p.category = 'scam' AND p.reversed_at IS NULL
       AND p.moderator_review = 1 AND p.author_github_id <> ?2
       AND ${GITHUB_ID("?2")}
    ${ONCE}`,
    )
    .bind(
      input.itemNodeId,
      input.recipient,
      `Review the account of @${input.authorLogin} after a scam closure on ${input.owner}/${input.repo}#${input.number}.`,
      path,
      input.at,
    );
}
