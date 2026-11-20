// spec/backend/accounts.md, "Confirmed closure ends every session, hides the membership, disconnects X and withdraws both email consents"; spec/operations/notifications.md, "Account closure suppresses every waiting notice of the account in the same write"
export const writes = [
  "points_members",
  "points_sessions",
  "points_x_flows",
  "points_x_links",
  "points_x_claims",
  "points_telegram_flows",
  "points_telegram_links",
  "notification_email_preferences",
  "notification_email_destinations",
  "notification_email_verifications",
  "notification_email_unsubscribe_tokens",
  "security_notification_outbox",
  "activity_notification_outbox",
] as const;
