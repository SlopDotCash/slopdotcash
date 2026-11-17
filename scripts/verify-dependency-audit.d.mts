import type { SpawnSyncReturns } from "node:child_process";

type AuditResult = Pick<SpawnSyncReturns<string>, "status" | "stdout"> &
  Partial<Pick<SpawnSyncReturns<string>, "error" | "signal" | "stderr">>;

type AuditReport = Record<string, Record<string, unknown>[]>;

export function readAuditReport(result: AuditResult): AuditReport;
export function verifyPicomatchBackports(root: string): void;
export function verifyAuditFindings(report: AuditReport, root: string): boolean;
