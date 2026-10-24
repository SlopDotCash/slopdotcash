/**
 * Inbox event statements (PRD NOT-01, migration 0024). Each writer adds one
 * of these to the same D1 batch as its source change, after that change, so
 * the notification commits only with it. Every statement reads its facts
 * back from the committed source row, so a change that did not happen writes
 * nothing, and the (event_key, recipient) key makes a replay a no-op.
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

/**
 * A later manifest revision reaches the account that listed the project (its
 * applicant, or its self-service creator) and its GitHub steward, never the
 * account that made the revision. Revision 1 lists the project; its creator
 * made it, so it sends no notice.
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
              recipient, 'project_revision', r.project_id, r.reason,
              '/projects/' || r.project_id, r.created_at, ?4
         FROM project_revisions r
         JOIN (
           ${LISTED_BY("?1")}
           UNION
           SELECT json_extract(manifest, '$.steward.github.actorId')
             FROM project_revisions
            WHERE project_id = ?1 AND revision = ?2
              AND json_type(manifest, '$.steward.github.actorId') = 'text'
         )
        WHERE r.project_id = ?1 AND r.revision = ?2 AND r.revision > 1
          AND r.manifest_sha256 = ?3 AND r.created_at = ?4
          AND recipient IS NOT r.actor_github_id
          AND recipient GLOB '[1-9]*' AND recipient NOT GLOB '*[^0-9]*'
       ${ONCE}`,
    )
    .bind(projectId, revision, manifestSha256, at);
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

/** SQL that keeps only canonical GitHub account ids as recipients. */
const GITHUB_ID = (column: string) =>
  `typeof(${column}) = 'text' AND length(${column}) BETWEEN 1 AND 20
   AND ${column} GLOB '[1-9]*' AND ${column} NOT GLOB '*[^0-9]*'`;

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
         JOIN (
           ${LISTED_BY("(SELECT project_id FROM project_enforcements WHERE id = ?1)")}
           UNION
           SELECT json_extract(manifest, '$.steward.github.actorId')
             FROM projects
            WHERE id = (SELECT project_id FROM project_enforcements WHERE id = ?1)
         )
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
