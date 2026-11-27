// spec/security/routineDecisions.md, "The pass reads only an unappealed undecided report once per case revision and mode"; spec/security/routineDecisions.md, "Two independent calls must agree before a close, and a plausible loss of funds closes nothing"
import type { RoutineOutcome } from "../../gen/security__cases.ts";
import type { Basis, Hold, Mode } from "../../gen/security__routineDecisions.ts";
import type { RoutineSeverity } from "../analysis/prompts.ts";
import type { RoutineOutcomeName } from "./reasons.ts";

export type RoutineMode = "off" | "dry_run" | "live";
export type ActiveMode = Exclude<RoutineMode, "off">;
export type BasisName = "digest" | "two-calls" | "clock" | "hold";
export type HoldName = "loss-plausible" | "calls-disagreed" | "analysis-unavailable" | "github-advisory" | "report-not-stored" | "proof-still-missing";

export const modes: Readonly<Record<ActiveMode, Mode>> = { dry_run: "DryRun", live: "Live" };

export const outcomeNames: Readonly<Record<RoutineOutcome, Exclude<RoutineOutcomeName, "unavailable">>> = {
  RoutineDuplicate: "duplicate",
  RoutineOutOfScope: "does-not-qualify",
  RoutineNeedsProof: "needs-proof",
  RoutineNoProof: "no-proof-received",
  RoutineAcknowledged: "acknowledged",
};
export const outcomes: Readonly<Record<Exclude<RoutineOutcomeName, "unavailable">, RoutineOutcome>> = {
  duplicate: "RoutineDuplicate",
  "does-not-qualify": "RoutineOutOfScope",
  "needs-proof": "RoutineNeedsProof",
  "no-proof-received": "RoutineNoProof",
  acknowledged: "RoutineAcknowledged",
};

export const basisNames: Readonly<Record<Basis, BasisName>> = { ByDigest: "digest", ByTwoCalls: "two-calls", ByClock: "clock", ByHold: "hold" };
export const bases: Readonly<Record<BasisName, Basis>> = { digest: "ByDigest", "two-calls": "ByTwoCalls", clock: "ByClock", hold: "ByHold" };

export const holdNames: Readonly<Record<Hold, HoldName | null>> = {
  NoHold: null,
  LossPlausible: "loss-plausible",
  CallsDisagreed: "calls-disagreed",
  AnalysisUnavailable: "analysis-unavailable",
  GithubAdvisory: "github-advisory",
  ReportNotStored: "report-not-stored",
  ProofStillMissing: "proof-still-missing",
};
export const holds: Readonly<Record<HoldName, Hold>> = {
  "loss-plausible": "LossPlausible",
  "calls-disagreed": "CallsDisagreed",
  "analysis-unavailable": "AnalysisUnavailable",
  "github-advisory": "GithubAdvisory",
  "report-not-stored": "ReportNotStored",
  "proof-still-missing": "ProofStillMissing",
};

export const severityRanks: Readonly<Record<RoutineSeverity, number>> = { critical: 5, high: 4, medium: 3, low: 2, informational: 1, unresolved: 0 };
export const rankedSeverities: ReadonlyArray<RoutineSeverity> = ["unresolved", "informational", "low", "medium", "high", "critical"];

/** @throws {never} */
export function routineMode(value: string | undefined): RoutineMode {
  return value === "dry_run" || value === "live" ? value : "off";
}

/** @throws {never} */
export function severityOfRank(rank: number): RoutineSeverity {
  return rankedSeverities[rank] ?? "unresolved";
}

/** @throws {never} */
export function isRoutineSeverity(value: string | null): value is RoutineSeverity {
  return value !== null && Object.hasOwn(severityRanks, value);
}
