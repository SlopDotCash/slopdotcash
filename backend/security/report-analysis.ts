/**
 * Automatic private analysis and routing of a new private report (PRD
 * section 8, SEC-10). The analysis only recommends: it sets a routing
 * priority and hints for the technical approvers, never severity, receipt,
 * award or disclosure, which stay human decisions.
 *
 * This routing analyzer is deterministic. The approved private model path
 * (Surplus Intelligence, PRD section 8) runs separately in `./analysis.ts`
 * and never feeds this routing step. It reads GitHub's structured severity and CVSS fields
 * and treats the free text as hostile data: it never parses instructions,
 * calls tools, chains prompts, logs or stores anything.
 */
export type AnalysisResult = {
  severityHint: "critical" | "high" | "medium" | "low" | "unknown";
  lossHint: "possible" | "unknown";
  priority: "urgent" | "normal";
};

export interface PrivateReportAnalyzer {
  readonly id: string;
  analyze(report: {
    summary: string;
    description: string;
    severity?: string;
    cvss?: string;
    cweIds?: string[];
  }): Promise<AnalysisResult>;
}

const SEVERITY_HINTS = ["critical", "high", "medium", "low"] as const;

/** The CVSS v3.x base score, or null when the vector is not v3.x. */
function cvss3BaseScore(vector: string): number | null {
  const match = /^CVSS:3\.[01]\/(.+)$/u.exec(vector);
  if (!match) return null;
  const metrics = new Map(
    match[1].split("/").map((part) => part.split(":") as [string, string]),
  );
  const weight = (key: string, table: Record<string, number>) =>
    table[metrics.get(key) ?? ""];
  const scope = metrics.get("S");
  const av = weight("AV", { N: 0.85, A: 0.62, L: 0.55, P: 0.2 });
  const ac = weight("AC", { L: 0.77, H: 0.44 });
  const pr = weight(
    "PR",
    scope === "C"
      ? { N: 0.85, L: 0.68, H: 0.5 }
      : { N: 0.85, L: 0.62, H: 0.27 },
  );
  const ui = weight("UI", { N: 0.85, R: 0.62 });
  const impact = { H: 0.56, L: 0.22, N: 0 };
  const c = weight("C", impact);
  const i = weight("I", impact);
  const a = weight("A", impact);
  if (
    (scope !== "U" && scope !== "C") ||
    [av, ac, pr, ui, c, i, a].some((value) => value === undefined)
  )
    return null;
  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impactScore =
    scope === "U"
      ? 6.42 * iss
      : 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15;
  if (impactScore <= 0) return 0;
  const exploitability = 8.22 * av * ac * pr * ui;
  const raw =
    scope === "U"
      ? Math.min(impactScore + exploitability, 10)
      : Math.min(1.08 * (impactScore + exploitability), 10);
  // CVSS v3.1 Roundup.
  const scaled = Math.round(raw * 100000);
  return scaled % 10000 === 0
    ? scaled / 100000
    : (Math.floor(scaled / 10000) + 1) / 10;
}

function severityFromScore(score: number): AnalysisResult["severityHint"] {
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  if (score > 0) return "low";
  return "unknown";
}

/** Rules only: GitHub severity or CVSS >= 9 makes a critical, urgent report. */
export const deterministicAnalyzer: PrivateReportAnalyzer = {
  id: "deterministic-v1",
  async analyze(report) {
    const score =
      report.cvss === undefined ? null : cvss3BaseScore(report.cvss);
    const severityHint =
      score !== null
        ? severityFromScore(score)
        : SEVERITY_HINTS.includes(
              report.severity as (typeof SEVERITY_HINTS)[number],
            )
          ? (report.severity as AnalysisResult["severityHint"])
          : "unknown";
    // A loss hint needs structured evidence; free text is never interpreted.
    const integrityHigh =
      report.cvss !== undefined && /\/I:H(?:\/|$)/u.test(report.cvss);
    return {
      severityHint,
      lossHint:
        severityHint === "critical" && integrityHigh ? "possible" : "unknown",
      priority: severityHint === "critical" ? "urgent" : "normal",
    };
  },
};

/** Schema check on analyzer output, so a plug-in cannot emit free text. */
export function checkedAnalysis(value: unknown): AnalysisResult {
  const result = value as Partial<AnalysisResult> | null;
  if (
    typeof result !== "object" ||
    result === null ||
    Object.keys(result).length !== 3 ||
    ![...SEVERITY_HINTS, "unknown"].includes(result.severityHint as string) ||
    !["possible", "unknown"].includes(result.lossHint as string) ||
    !["urgent", "normal"].includes(result.priority as string)
  )
    return { severityHint: "unknown", lossHint: "unknown", priority: "normal" };
  return {
    severityHint: result.severityHint as AnalysisResult["severityHint"],
    lossHint: result.lossHint as AnalysisResult["lossHint"],
    priority: result.priority as AnalysisResult["priority"],
  };
}
