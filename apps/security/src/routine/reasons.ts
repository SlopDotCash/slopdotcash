// spec/security/routineDecisions.md, "Duplicates, published lines and the proof clock close; a report on GitHub and every hold go to the owner"; spec/security/routineDecisions.md, "The reporter appeals a routine close once, to the owner, and the pass never reads the report again"
import type { MissingEvidence } from "../analysis/prompts.ts";

export type RoutineOutcomeName = "duplicate" | "does-not-qualify" | "needs-proof" | "no-proof-received" | "acknowledged" | "unavailable";

export interface ReasonFacts {
  readonly outcome: RoutineOutcomeName;
  readonly exclusionLine: string | null;
  readonly proofDueAt: string | null;
  readonly missing: ReadonlyArray<MissingEvidence>;
}

export const routineActorGithubId = "slop";
export const routineProofNextAction = "Add reproduction steps or a runnable proof";

const missingWords: Readonly<Record<MissingEvidence, string>> = {
  "reproduction-steps": "reproduction steps",
  "runnable-proof": "a runnable proof (a test, a script or exact commands)",
  "affected-code": "the affected code",
  "source-revision": "the source revision you tested",
};

const appealSentence = "If you think this is wrong, you can appeal once and the project owner will review the report.";

function missingText(missing: ReadonlyArray<MissingEvidence>): string {
  const words = missing.map((word) => missingWords[word]);
  if (words.length === 0) return "reproduction steps or a runnable proof";
  if (words.length === 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;
}

/** @throws {never} */
export function routineReason(facts: ReasonFacts): string {
  switch (facts.outcome) {
    case "duplicate":
      return `Slop's screening closed this report as a duplicate of an earlier report to the same program. Only the first report of a finding is considered. ${appealSentence}`;
    case "does-not-qualify":
      return `Slop's screening closed this report because it matches the program's published "Does not qualify" list: "${facts.exclusionLine ?? ""}". ${appealSentence}`;
    case "needs-proof":
      return `Slop's screening did not find ${missingText(facts.missing)} in this report. Add this to your saved report by ${facts.proofDueAt?.slice(0, 10)} (UTC). If no new version arrives by then, the report closes as no proof received.`;
    case "no-proof-received":
      return `No new version of this report arrived within 14 days of the request for proof, so it is closed as no proof received. ${appealSentence}`;
    default:
      return "Slop's screening read this report and passed it to the project owner for review.";
  }
}
