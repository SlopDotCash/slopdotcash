import type { RepositoryAccessReader } from "../../backend/projects/setup";
/** SEC-16 restricted pilot. No public route, caller-supplied destination or case content. */

import {
  type SecurityD1Database,
  securityNotificationAccess,
} from "../../backend/security/handler";
import { reportingAuthorityUnavailable } from "../../backend/security/project-access";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { EMAIL_ADDRESS, SENDER_ADDRESS } from "./contracts";
import { encodeQuotedPrintable } from "./handler";

type Destination = {
  email: string;
  verifiedAt: string;
  evidenceReference: string;
  backupGithubId: string;
};
export type SecurityMailConfig = {
  /** Operators attest Cloudflare verified-destination eligibility AND actor control. */
  recipients: Record<string, Destination>;
  inboxUrl: string;
};
export type SecurityMailDependencies = {
  db: SecurityD1Database;
  config: SecurityMailConfig;
  /** Slop moderators, who decide escalated private-case disputes. */
  moderatorGithubIds?: ReadonlySet<string>;
  repositoryAccess?: RepositoryAccessReader;
  fromAddress: string;
  now(): Date;
  sendEmail(from: string, to: string, mime: string): Promise<void>;
};

type Delivery = {
  id: string;
  event_key: string;
  recipient_github_id: string;
  case_id: string;
  template_version: string;
  state: string;
  attempts: number;
  destination_digest: string | null;
  created_at: string;
  acknowledged_at: string | null;
  escalation_of: string | null;
};
const ID = /^[1-9]\d{0,19}$/u;
const MAX_ATTEMPTS = 5;
/**
 * A reporter's receipt (migration 0063) is informational. It is delivered and
 * escalated on delivery failure like any private notice, but it asks for no
 * acknowledgment, so a missing acknowledgment never escalates it.
 */
const RECEIPT_TEMPLATE = "security-receipt-v1";

/**
 * A mail pilot secret, never a manifest or browser input: the inbox URL and
 * each recipient's operator-verified destination. A security pilot names a
 * distinct backup recipient for each one. Returns null when malformed.
 */
export function parseMailPilotConfig(raw: string, backup: boolean): unknown {
  try {
    const config = JSON.parse(raw) as {
      inboxUrl: string;
      recipients: Record<string, Partial<Destination>>;
    };
    if (Object.keys(config).sort().join() !== "inboxUrl,recipients")
      return null;
    const url = new URL(config.inboxUrl);
    if (
      url.protocol !== "https:" ||
      url.pathname !== "/inbox" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      return null;
    if (
      !config.recipients ||
      typeof config.recipients !== "object" ||
      Array.isArray(config.recipients)
    )
      return null;
    const keys = backup
      ? "backupGithubId,email,evidenceReference,verifiedAt"
      : "email,evidenceReference,verifiedAt";
    for (const [id, value] of Object.entries(config.recipients)) {
      if (!ID.test(id) || !value || Object.keys(value).sort().join() !== keys)
        return null;
      if (
        typeof value.email !== "string" ||
        !EMAIL_ADDRESS.test(value.email) ||
        (backup &&
          (!ID.test(value.backupGithubId ?? "") || value.backupGithubId === id))
      )
        return null;
      if (
        typeof value.verifiedAt !== "string" ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value.verifiedAt) ||
        new Date(value.verifiedAt).toISOString() !== value.verifiedAt
      )
        return null;
      if (
        typeof value.evidenceReference !== "string" ||
        value.evidenceReference.trim().length === 0
      )
        return null;
    }
    return config;
  } catch {
    return null;
  }
}
export function parseSecurityMailConfig(
  raw: string,
): SecurityMailConfig | null {
  return parseMailPilotConfig(raw, true) as SecurityMailConfig | null;
}

/**
 * Marks stale claims ambiguous, because a process can stop after the
 * provider accepted, then claims each due row just before it is processed.
 * Concurrent workers claim once before any network operation.
 */
export async function* claimDueDeliveries<T extends { id: string }>(
  db: SecurityD1Database,
  channel: "security" | "activity",
  now: () => Date,
): AsyncGenerator<T> {
  const startedAt = now();
  const at = startedAt.toISOString();
  await db
    .prepare(`UPDATE ${channel}_notification_outbox SET state = 'ambiguous', updated_at = ?
    WHERE state = 'sending' AND claimed_at < ?`)
    .bind(at, new Date(startedAt.getTime() - 5 * 60_000).toISOString())
    .run();
  const pending = await db
    .prepare(
      `SELECT * FROM ${channel}_notification_outbox WHERE state IN ('queued','retrying') AND next_attempt_at <= ? ORDER BY created_at, id LIMIT 25`,
    )
    .bind(at)
    .all<T>();
  for (const row of pending.results ?? []) {
    // Earlier sends must not consume this delivery's five-minute claim.
    const claimedAt = now().toISOString();
    const claim = await db
      .prepare(`UPDATE ${channel}_notification_outbox SET state = 'sending', claimed_at = ?, updated_at = ?, attempts = attempts + 1
      WHERE id = ? AND state IN ('queued','retrying') AND next_attempt_at <= ?`)
      .bind(claimedAt, claimedAt, row.id, at)
      .run();
    if (claim.meta?.changes === 1) yield row;
  }
}

/** A plain-text inbox notice with a stable opaque per-attempt Message-ID:
 * no case id, project, actor or amount.
 */
export function inboxNoticeMime(notice: {
  from: string;
  to: string;
  subject: string;
  date: Date;
  deliveryId: string;
  attempt: number;
  text: string;
}): string {
  return [
    `From: ${notice.from}`,
    `To: ${notice.to}`,
    `Subject: ${notice.subject}`,
    `Date: ${notice.date.toUTCString()}`,
    `Message-ID: <slop-notice-${notice.deliveryId}-${notice.attempt}@slop.cash>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    encodeQuotedPrintable(notice.text),
  ].join("\r\n");
}

export async function recordDelivery(
  deps: Pick<SecurityMailDependencies, "db" | "now">,
  row: Pick<Delivery, "id" | "attempts">,
  state: string,
  evidence: string | null = null,
  channel: "security" | "activity" = "security",
) {
  const at = deps.now().toISOString();
  await deps.db.batch([
    deps.db
      .prepare(
        `UPDATE ${channel}_notification_outbox SET state = ?, updated_at = ? WHERE id = ? AND state = 'sending' AND attempts = ?`,
      )
      .bind(state, at, row.id, row.attempts + 1),
    deps.db
      .prepare(
        `INSERT INTO ${channel}_notification_delivery_events(delivery_id, state, evidence_reference, at, attempt, destination_digest) SELECT id, ?, ?, ?, attempts, destination_digest FROM ${channel}_notification_outbox WHERE id = ? AND state = ? AND attempts = ? AND updated_at = ?`,
      )
      .bind(state, evidence, at, row.id, state, row.attempts + 1, at),
  ]);
}

/**
 * A claimed attempt that made no provider call is a definite non-send, so a
 * retry cannot duplicate mail. Backoff doubles from one minute, and the fifth
 * attempt exhausts. A thrown send is never routed here: it stays ambiguous
 * until independent evidence reconciles it.
 */
export async function retryWithoutProviderCall(
  deps: Pick<SecurityMailDependencies, "db" | "now">,
  row: Pick<Delivery, "id" | "attempts">,
  channel: "security" | "activity" = "security",
): Promise<"retrying" | "exhausted"> {
  const state = row.attempts + 1 >= MAX_ATTEMPTS ? "exhausted" : "retrying";
  await deps.db
    .prepare(
      `UPDATE ${channel}_notification_outbox SET next_attempt_at = ? WHERE id = ?`,
    )
    .bind(
      new Date(
        deps.now().getTime() + Math.min(3600, 60 * 2 ** row.attempts) * 1000,
      ).toISOString(),
      row.id,
    )
    .run();
  await recordDelivery(deps, row, state, null, channel);
  return state;
}

export async function destinationDigest(value: object): Promise<string> {
  return sha256Hex(JSON.stringify(value));
}

function mime(
  deps: SecurityMailDependencies,
  row: Delivery,
  email: string,
): string {
  return inboxNoticeMime({
    from: deps.fromAddress,
    to: email,
    subject: "Slop private inbox notice",
    date: deps.now(),
    deliveryId: row.id,
    attempt: row.attempts + 1,
    text:
      row.template_version === RECEIPT_TEMPLATE
        ? `Your private Slop inbox has a new notice.\n\nSign in: ${deps.config.inboxUrl}\n\nDo not reply with evidence, approvals or payment details.\n`
        : `Your private Slop inbox needs attention.\n\nSign in: ${deps.config.inboxUrl}\n\nAcknowledge the notice in Slop. Do not reply with evidence, approvals or payment details.\n`,
  });
}

/** A backup gets only a generic notice and must currently have access to this case. */
async function escalate(deps: SecurityMailDependencies, row: Delivery) {
  if (row.escalation_of || row.acknowledged_at) return;
  const backupId =
    deps.config.recipients[row.recipient_github_id]?.backupGithubId;
  if (!backupId || !deps.config.recipients[backupId]) return;
  try {
    if (
      !(
        await securityNotificationAccess(
          deps.db,
          row.case_id,
          backupId,
          deps.moderatorGithubIds,
          deps.repositoryAccess,
        )
      ).allowed
    )
      return;
  } catch (error) {
    if (!reportingAuthorityUnavailable(error)) throw error;
    // No backup is authorized while GitHub is unavailable. Keep the failed
    // notice for the next escalation scan and continue the delivery queue.
    return;
  }
  const at = deps.now().toISOString();
  const eventKey = `security-escalation:${row.id}`;
  await deps.db.batch([
    deps.db
      .prepare(`INSERT INTO notifications(event_key, recipient_github_id, kind, subject, detail, action_path, source_at, created_at)
      VALUES (?, ?, 'security_case', ?, NULL, '/security', ?, ?)
      ON CONFLICT(event_key, recipient_github_id) DO NOTHING`)
      .bind(eventKey, backupId, row.case_id, at, at),
    deps.db
      .prepare(`UPDATE security_notification_outbox SET escalation_of = ?
      WHERE event_key = ? AND recipient_github_id = ? AND escalation_of IS NULL`)
      .bind(row.id, eventKey, backupId),
  ]);
}

/** One bounded drain. Concurrent workers claim once before any network operation. */
export async function dispatchSecurityMail(
  deps: SecurityMailDependencies,
): Promise<void> {
  if (!SENDER_ADDRESS.test(deps.fromAddress))
    throw new Error("Invalid mail sender");
  const now = deps.now();
  const at = now.toISOString();
  // A process can stop after the provider accepted. Never automatically resend.
  for await (const row of claimDueDeliveries<Delivery>(
    deps.db,
    "security",
    deps.now,
  )) {
    let access: Awaited<ReturnType<typeof securityNotificationAccess>>;
    try {
      access = await securityNotificationAccess(
        deps.db,
        row.case_id,
        row.recipient_github_id,
        deps.moderatorGithubIds,
        deps.repositoryAccess,
      );
    } catch {
      // An unavailable authority check sends nothing and remains retryable.
      await retryWithoutProviderCall(deps, row);
      continue;
    }
    if (!access.allowed) {
      await recordDelivery(deps, row, "suppressed");
      continue;
    }
    const destination = deps.config.recipients[row.recipient_github_id];
    if (!destination) {
      // No operator-verified destination exists for this recipient. Nothing
      // can be sent and none will appear within the retry schedule, so the
      // notice is suppressed: the inbox row stays and shows no email state.
      await recordDelivery(deps, row, "suppressed");
      continue;
    }
    if (Date.parse(destination.verifiedAt) > now.getTime()) {
      // A verified record not yet in effect made no provider call; retry it
      // on the bounded schedule.
      const state = await retryWithoutProviderCall(deps, row);
      if (state === "exhausted") await escalate(deps, row);
      continue;
    }
    await deps.db
      .prepare(
        "UPDATE security_notification_outbox SET destination_digest = ? WHERE id = ?",
      )
      .bind(await destinationDigest(destination), row.id)
      .run();
    try {
      await deps.sendEmail(
        deps.fromAddress,
        destination.email,
        mime(deps, row, destination.email),
      );
    } catch {
      // The binding has no definitive non-acceptance receipt. A thrown send is ambiguous.
      await recordDelivery(deps, row, "ambiguous");
      await escalate(deps, row);
      continue;
    }
    await recordDelivery(deps, row, "provider-accepted");
  }
  // A row this dispatcher suppressed (revoked role) sent nothing and never
  // escalates. Provider evidence of suppression is a failed delivery.
  const waiting = await deps.db
    .prepare(`SELECT * FROM security_notification_outbox
    WHERE acknowledged_at IS NULL AND escalation_of IS NULL AND state NOT IN ('queued','retrying','sending')
    AND (state <> 'suppressed' OR EXISTS (SELECT 1 FROM security_notification_delivery_events e
      WHERE e.delivery_id = security_notification_outbox.id AND e.state = 'suppressed' AND e.evidence_reference IS NOT NULL))
    AND NOT EXISTS (SELECT 1 FROM security_notification_outbox escalation WHERE escalation.escalation_of = security_notification_outbox.id)
    ORDER BY COALESCE(escalation_checked_at, created_at), id LIMIT 100`)
    .all<Delivery>();
  for (const row of waiting.results ?? []) {
    await deps.db
      .prepare(
        "UPDATE security_notification_outbox SET escalation_checked_at = ? WHERE id = ?",
      )
      .bind(at, row.id)
      .run();
    const access = await securityNotificationAccess(
      deps.db,
      row.case_id,
      row.recipient_github_id,
      deps.moderatorGithubIds,
      deps.repositoryAccess,
    );
    if (!access.allowed) continue;
    const overdue =
      row.template_version !== RECEIPT_TEMPLATE &&
      access.acknowledgeHours > 0 &&
      now.getTime() >=
        Date.parse(row.created_at) + access.acknowledgeHours * 3600_000;
    if (
      overdue ||
      ["bounced", "suppressed", "exhausted", "ambiguous"].includes(row.state)
    )
      await escalate(deps, row);
  }
}

/** Separate operator path: independent provider evidence, never email text or an open pixel. */
export async function reconcileSecurityMail(
  deps: Pick<SecurityMailDependencies, "db" | "now">,
  body: Record<string, unknown>,
  channel: "security" | "activity" = "security",
): Promise<boolean> {
  if (
    Object.keys(body).sort().join() !==
    "attempt,deliveryId,destinationDigest,evidenceReference,outcome"
  )
    return false;
  const { attempt, deliveryId, destinationDigest, evidenceReference, outcome } =
    body;
  if (
    !Number.isSafeInteger(attempt) ||
    Number(attempt) < 1 ||
    typeof destinationDigest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(destinationDigest) ||
    typeof deliveryId !== "string" ||
    !/^[a-f0-9]{32}$/u.test(deliveryId) ||
    typeof evidenceReference !== "string" ||
    evidenceReference.trim().length < 1 ||
    evidenceReference.length > 500
  )
    return false;
  if (
    !["delivered", "bounced", "suppressed", "not-accepted"].includes(
      String(outcome),
    )
  )
    return false;
  const row = await deps.db
    .prepare(`SELECT * FROM ${channel}_notification_outbox WHERE id = ?`)
    .bind(deliveryId)
    .first<Delivery>();
  if (
    !row ||
    !["provider-accepted", "ambiguous"].includes(row.state) ||
    row.attempts !== attempt ||
    row.destination_digest !== destinationDigest
  )
    return false;
  const next =
    outcome === "not-accepted"
      ? row.attempts >= MAX_ATTEMPTS
        ? "exhausted"
        : "retrying"
      : String(outcome);
  const at = deps.now().toISOString();
  const results = await deps.db.batch([
    deps.db
      .prepare(`UPDATE ${channel}_notification_outbox SET state = ?, updated_at = ?, next_attempt_at = ?, provider_reference = ?
      WHERE id = ? AND state = ? AND attempts = ? AND destination_digest = ?
      AND NOT EXISTS (SELECT 1 FROM ${channel}_notification_delivery_events WHERE evidence_reference = ?)`)
      .bind(
        next,
        at,
        new Date(deps.now().getTime() + 60_000).toISOString(),
        evidenceReference,
        row.id,
        row.state,
        attempt,
        destinationDigest,
        evidenceReference,
      ),
    deps.db
      .prepare(`INSERT INTO ${channel}_notification_delivery_events(delivery_id, state, evidence_reference, at, attempt, destination_digest)
      SELECT id, ?, ?, ?, attempts, destination_digest FROM ${channel}_notification_outbox
      WHERE id = ? AND state = ? AND updated_at = ? AND attempts = ? AND destination_digest = ? AND provider_reference = ?
      AND NOT EXISTS (SELECT 1 FROM ${channel}_notification_delivery_events WHERE evidence_reference = ?)`)
      .bind(
        next,
        evidenceReference,
        at,
        row.id,
        next,
        at,
        attempt,
        destinationDigest,
        evidenceReference,
        evidenceReference,
      ),
  ]);
  return results[0].meta?.changes === 1;
}
