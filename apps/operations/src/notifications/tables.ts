// spec/operations/notifications.md, "Story: Save each notice once with its source change"
export const notificationWrites = [
  "notifications",
  "security_notification_outbox",
  "activity_notification_outbox",
  "security_notification_delivery_events",
  "activity_notification_delivery_events",
] as const;
