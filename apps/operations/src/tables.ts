// spec/operations/notifications.md, "Story: Save each notice once with its source change"; spec/operations/paymentJobs.md, "Story: Respect service authorization and settle each configured network independently"; spec/operations/backup.md, "Story: Complete one verifiable backup cycle at a time"
import { backupWrites } from "./backup/tables.ts";
import { jobWrites } from "./jobs/tables.ts";
import { notificationWrites } from "./notifications/tables.ts";

export const writes = [...notificationWrites, ...jobWrites, ...backupWrites] as const;
