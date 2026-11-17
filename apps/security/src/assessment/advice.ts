// spec/security/journey.md, "Screening, human routing review and owner notification use the live records"; spec/security/assessment.md, "Attempts are permanent, version-bound and finish once"

export type SeverityHint = "critical" | "high" | "medium" | "low" | "unknown";

export interface Advice {
  readonly severityHint: SeverityHint;
  readonly lossHint: "possible" | "unknown";
  readonly priority: "urgent" | "normal";
}

export interface StructuredReport {
  readonly severity?: string;
  readonly cvss?: string;
}

export const adviserId = "deterministic-v1";

const severityHints: ReadonlyArray<string> = ["critical", "high", "medium", "low"];
const unknownAdvice: Advice = { severityHint: "unknown", lossHint: "unknown", priority: "normal" };

type Weights = Readonly<Record<string, number>>;

function weight(metrics: ReadonlyMap<string, string>, key: string, table: Weights): number | undefined {
  return table[metrics.get(key) ?? ""];
}

function isSeverityHint(value: unknown): value is SeverityHint {
  return typeof value === "string" && (severityHints.includes(value) || value === "unknown");
}

/** @throws {never} */
export function cvss3BaseScore(vector: string): number | null {
  const match = /^CVSS:3\.[01]\/(.+)$/u.exec(vector);
  if (match === null) return null;
  const metrics = new Map((match[1] ?? "").split("/").map((part) => {
    const [key = "", value = ""] = part.split(":");
    return [key, value] as const;
  }));
  const scope = metrics.get("S");
  const impact = { H: 0.56, L: 0.22, N: 0 };
  const av = weight(metrics, "AV", { N: 0.85, A: 0.62, L: 0.55, P: 0.2 });
  const ac = weight(metrics, "AC", { L: 0.77, H: 0.44 });
  const pr = weight(metrics, "PR", scope === "C" ? { N: 0.85, L: 0.68, H: 0.5 } : { N: 0.85, L: 0.62, H: 0.27 });
  const ui = weight(metrics, "UI", { N: 0.85, R: 0.62 });
  const c = weight(metrics, "C", impact);
  const i = weight(metrics, "I", impact);
  const a = weight(metrics, "A", impact);
  if ((scope !== "U" && scope !== "C") || av === undefined || ac === undefined || pr === undefined || ui === undefined || c === undefined || i === undefined || a === undefined) return null;
  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impactScore = scope === "U" ? 6.42 * iss : 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15;
  if (impactScore <= 0) return 0;
  const exploitability = 8.22 * av * ac * pr * ui;
  const raw = scope === "U" ? Math.min(impactScore + exploitability, 10) : Math.min(1.08 * (impactScore + exploitability), 10);
  const scaled = Math.round(raw * 100000);
  return scaled % 10000 === 0 ? scaled / 100000 : (Math.floor(scaled / 10000) + 1) / 10;
}

/** @throws {never} */
export function severityFromScore(score: number): SeverityHint {
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  if (score > 0) return "low";
  return "unknown";
}

/** @throws {never} */
export function deterministicAdvice(report: StructuredReport): Advice {
  const score = report.cvss === undefined ? null : cvss3BaseScore(report.cvss);
  const severityHint = score !== null ? severityFromScore(score) : isSeverityHint(report.severity) ? report.severity : "unknown";
  const integrityHigh = report.cvss !== undefined && /\/I:H(?:\/|$)/u.test(report.cvss);
  return {
    severityHint,
    lossHint: severityHint === "critical" && integrityHigh ? "possible" : "unknown",
    priority: severityHint === "critical" ? "urgent" : "normal",
  };
}

/** @throws {never} */
export function checkedAdvice(value: unknown): Advice {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length !== 3) return unknownAdvice;
  const { severityHint, lossHint, priority } = value as Readonly<Record<string, unknown>>;
  if (!isSeverityHint(severityHint) || (lossHint !== "possible" && lossHint !== "unknown") || (priority !== "urgent" && priority !== "normal")) return unknownAdvice;
  return { severityHint, lossHint, priority };
}
