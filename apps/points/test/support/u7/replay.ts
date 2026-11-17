import { readFile } from "node:fs/promises";
import type { Activity, ClosedPull, LeaderEntry, MergedPull, PaymentReviewBasis, ReviewExclusion, ScoreEvent, ScoringFacts } from "../../../src/score/facts.vibe";

export interface OldBuilderOutput {
  readonly ledger: ReadonlyArray<ScoreEvent>;
  readonly leaders: ReadonlyArray<LeaderEntry>;
  readonly reviewExclusions: ReadonlyArray<ReviewExclusion>;
  readonly paymentReviewBasis?: PaymentReviewBasis;
}

export interface Replay {
  readonly facts: ScoringFacts;
  readonly expected: OldBuilderOutput;
}

interface StoredFacts {
  readonly windowFrom: string;
  readonly windowTo: string;
  readonly merged: MergedPull[];
  readonly closedUnmerged: ClosedPull[];
  readonly projects: [string, string][];
  readonly activity: [string, Activity][];
}

function isStored(value: unknown): value is { facts: StoredFacts; expected: OldBuilderOutput } {
  return typeof value === "object" && value !== null && "facts" in value && "expected" in value;
}

export async function oldBuilderReplay(): Promise<Replay> {
  const parsed: unknown = JSON.parse(await readFile(new URL("./replay.json", import.meta.url), "utf8"));
  if (!isStored(parsed)) throw new TypeError("replay.json is not an old builder replay");
  const { facts, expected } = parsed;
  return {
    facts: {
      windowFrom: facts.windowFrom,
      windowTo: facts.windowTo,
      merged: facts.merged,
      closedUnmerged: facts.closedUnmerged,
      contexts: [],
      joint: [],
      attributionHolds: new Set(),
      heldUnits: [],
      openReviewedAt: [],
      penalties: [],
      projects: new Map(facts.projects),
      bans: new Map(),
      activity: new Map(facts.activity),
    },
    expected,
  };
}
