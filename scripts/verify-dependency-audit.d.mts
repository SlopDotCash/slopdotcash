type AuditReport = Record<string, Record<string, unknown>[]>;

export function readAuditReport(result: {
  status: number | null;
  stdout: string;
  stderr?: string | null;
  signal?: string | null;
  error?: Error;
}): AuditReport;

export function verifyPicomatchBackports(root: string): void;
export function verifyAuditFindings(report: AuditReport, root: string): boolean;
