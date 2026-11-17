// spec/frontend/presentation.md, "The campaign keeps one stable accessible heading and respects reduced motion"
import { Arbitrary } from "effect";
import { contract } from "vibestack/testing";
import { animatedHeading, campaignActions, campaignLead, campaignTick, type CampaignFrame, firstFrame } from "./campaign.ts";

interface Cycle {
  readonly returned: boolean;
  readonly totalMs: number;
  readonly headings: ReadonlyArray<string>;
}

const stepLimit = 10_000;

function cycleFrom(start: CampaignFrame): Cycle {
  const headings: string[] = [];
  let frame = start;
  let totalMs = 0;
  for (let step = 0; step < stepLimit; step += 1) {
    const { delayMs, next } = campaignTick(frame);
    totalMs += delayMs;
    frame = next;
    headings.push(animatedHeading(frame));
    if (frame.action === start.action && frame.characters === start.characters && frame.phase === start.phase) return { returned: true, totalMs, headings };
  }
  return { returned: false, totalMs, headings };
}

const lettersTyped = campaignActions.reduce((total, action) => total + action.length, 0);
const fullCycleMs = campaignActions.length * (2_400 + 220 + 1) + lettersTyped * (30 + 55);

export const campaignCyclesThroughEveryActionAndBack = contract({
  input: Arbitrary.Constant(firstFrame),
  run: cycleFrom,
  deterministic: true,
  invariant: (_start, cycle) =>
    cycle.returned &&
    cycle.totalMs === fullCycleMs &&
    cycle.headings.every((heading) => heading.startsWith(`${campaignLead} `)) &&
    campaignActions.every((action) => cycle.headings.includes(`${campaignLead} ${action}`)),
});
