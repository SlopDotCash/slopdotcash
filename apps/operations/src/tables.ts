import { jobWrites } from "./jobs/tables.ts";
import { notificationWrites } from "./notifications/tables.ts";

export const writes = [...notificationWrites, ...jobWrites] as const;
