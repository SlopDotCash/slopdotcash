/** NOT-01 optional activity delivery; essential wallet notices do not use the activity preference. */
import type { SecurityD1Database } from "../../backend/security/handler";
import { SENDER_ADDRESS } from "./contracts";
import {
  claimDueDeliveries,
  destinationDigest,
  inboxNoticeMime,
  parseMailPilotConfig,
  recordDelivery,
  retryWithoutProviderCall,
} from "./security";

type VerifiedDestination = {
  email: string;
  verifiedAt: string;
  evidenceReference: string;
};
export type ActivityMailConfig = {
  inboxUrl: string;
  recipients: Record<string, VerifiedDestination>;
};
export type ActivityMailDependencies = {
  db: SecurityD1Database;
  moderatorGithubIds?: ReadonlySet<string>;
  config: ActivityMailConfig;
  fromAddress: string;
  now(): Date;
  sendEmail(from: string, to: string, mime: string): Promise<void>;
};
export function parseActivityMailConfig(
  raw: string,
): ActivityMailConfig | null {
  return parseMailPilotConfig(raw, false) as ActivityMailConfig | null;
}
export async function activityMailEligibility(
  config: ActivityMailConfig,
  githubId: string,
  now: Date,
) {
  const destination = config.recipients[githubId];
  if (!destination || Date.parse(destination.verifiedAt) > now.getTime())
    return { available: false } as const;
  return {
    available: true,
    email: destination.email,
    destinationVersion: await destinationDigest(destination),
  } as const;
}

type Delivery = {
  id: string;
  event_key: string;
  recipient_github_id: string;
  essential: number;
  destination_version: string | null;
  attempts: number;
};
export async function dispatchActivityMail(
  deps: ActivityMailDependencies,
): Promise<void> {
  if (!SENDER_ADDRESS.test(deps.fromAddress))
    throw new Error("Invalid mail sender");
  const now = deps.now();
  for await (const row of claimDueDeliveries<Delivery>(
    deps.db,
    "activity",
    now,
  )) {
    if (row.event_key.startsWith("slopbot-appeal:")) {
      const appeal = await deps.db
        .prepare(
          "SELECT appellant_github_id, resolved_at FROM slopbot_appeals WHERE appeal_key = ? AND escalated_at IS NOT NULL",
        )
        .bind(row.event_key.slice("slopbot-".length))
        .first<{ appellant_github_id: string; resolved_at: string | null }>();
      if (
        !deps.moderatorGithubIds?.has(row.recipient_github_id) ||
        !appeal ||
        appeal.resolved_at !== null ||
        appeal.appellant_github_id === row.recipient_github_id
      ) {
        await recordDelivery(deps, row, "suppressed", null, "activity");
        continue;
      }
    }
    // A scam-closure account review (owner decision D4) mails only a current
    // moderator, never the author, and only while its penalty stands.
    if (row.event_key.startsWith("slopbot-scam-review:")) {
      const penalty = await deps.db
        .prepare(
          "SELECT author_github_id, reversed_at FROM slopbot_penalties WHERE item_node_id = ? AND category = 'scam' AND moderator_review = 1",
        )
        .bind(row.event_key.slice("slopbot-scam-review:".length))
        .first<{ author_github_id: string; reversed_at: string | null }>();
      if (
        !deps.moderatorGithubIds?.has(row.recipient_github_id) ||
        !penalty ||
        penalty.reversed_at !== null ||
        penalty.author_github_id === row.recipient_github_id
      ) {
        await recordDelivery(deps, row, "suppressed", null, "activity");
        continue;
      }
    }
    const destination = await activityMailEligibility(
      deps.config,
      row.recipient_github_id,
      now,
    );
    const preference = await deps.db
      .prepare(
        "SELECT enabled,destination_version FROM notification_email_preferences WHERE github_id=?",
      )
      .bind(row.recipient_github_id)
      .first<{ enabled: number; destination_version: string | null }>();
    // An essential notice whose operator-verified record is not yet in effect
    // made no provider call: retry it on the bounded schedule. Optional mail
    // never retries here, because its consent names one effective destination.
    if (
      !destination.available &&
      row.essential &&
      deps.config.recipients[row.recipient_github_id]
    ) {
      await retryWithoutProviderCall(deps, row, "activity");
      continue;
    }
    if (
      !destination.available ||
      (!row.essential &&
        (preference?.enabled !== 1 ||
          preference.destination_version !== destination.destinationVersion ||
          row.destination_version !== destination.destinationVersion))
    ) {
      await recordDelivery(deps, row, "suppressed", null, "activity");
      continue;
    }
    // Recipient and consent are resolved on the server immediately before this one-recipient send.
    await deps.db
      .prepare(
        "UPDATE activity_notification_outbox SET destination_digest=? WHERE id=?",
      )
      .bind(destination.destinationVersion, row.id)
      .run();
    const text = row.essential
      ? "Your Slop account has a security notice."
      : "Your Slop inbox has an activity update.";
    const mime = inboxNoticeMime({
      from: deps.fromAddress,
      to: destination.email,
      subject: "Slop inbox notice",
      date: now,
      deliveryId: row.id,
      attempt: row.attempts + 1,
      text: `${text}\n\nSign in: ${deps.config.inboxUrl}\n\nDo not reply with approvals, evidence or payment details.\n`,
    });
    try {
      await deps.sendEmail(deps.fromAddress, destination.email, mime);
    } catch {
      // The binding gives no definite non-acceptance receipt. The outcome stays
      // uncertain until independent evidence reconciles it; only `not-accepted`
      // evidence permits the next bounded attempt.
      await recordDelivery(deps, row, "ambiguous", null, "activity");
      continue;
    }
    await recordDelivery(deps, row, "provider-accepted", null, "activity");
  }
}
