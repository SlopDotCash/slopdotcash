// spec/frontend/presentation.md, "The campaign keeps one stable accessible heading and respects reduced motion"; spec/frontend/presentation.md, "Home offers a Contributor / Maintainer switch whose journey sets the heading, the prompt and every agent's skill address together"
import { Arbitrary } from "effect";
import { contract } from "vibestack/testing";
import { type Campaign, campaignOf, heroDeleteMs, heroGapMs, heroHoldMs, heroTypeMs } from "../../../gen/frontend__presentation.ts";
import { animatedHeading, campaignTick, type CampaignFrame, firstFrameOf } from "./campaign.ts";

interface Cycle {
  readonly returned: boolean;
  readonly totalMs: number;
  readonly headings: ReadonlyArray<string>;
}

const stepLimit = 10_000;

function cycleOf(campaign: Campaign): Cycle {
  const start: CampaignFrame = firstFrameOf(campaign);
  const headings: string[] = [];
  let frame = start;
  let totalMs = 0;
  for (let step = 0; step < stepLimit; step += 1) {
    const { delayMs, next } = campaignTick(campaign, frame);
    totalMs += delayMs;
    frame = next;
    headings.push(animatedHeading(campaign, frame));
    if (frame.action === start.action && frame.characters === start.characters && frame.phase === start.phase) return { returned: true, totalMs, headings };
  }
  return { returned: false, totalMs, headings };
}

const fullCycleMs = (campaign: Campaign) =>
  campaign.actions.length * (heroHoldMs + heroGapMs + 1) + campaign.actions.reduce((total, action) => total + action.length, 0) * (heroDeleteMs + heroTypeMs);

export const eachJourneyCampaignCyclesThroughEveryActionAndBack = contract({
  input: Arbitrary.Constant([campaignOf("Contributor"), campaignOf("Maintainer")]),
  run: (campaigns) => campaigns.map(cycleOf),
  deterministic: true,
  invariant: (campaigns, cycles) =>
    campaigns.every((campaign, index) => {
      const cycle = cycles[index]!;
      return (
        cycle.returned &&
        cycle.totalMs === fullCycleMs(campaign) &&
        cycle.headings.every((heading) => heading.startsWith(`${campaign.lead} `)) &&
        campaign.actions.every((action) => cycle.headings.includes(`${campaign.lead} ${action}`)) &&
        animatedHeading(campaign, firstFrameOf(campaign)) === campaign.accessibleHeading
      );
    }),
});
