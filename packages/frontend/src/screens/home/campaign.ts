// spec/frontend/presentation.md, "The campaign keeps one stable accessible heading and respects reduced motion"; spec/frontend/presentation.md, "Home offers a Contributor / Maintainer switch whose journey sets the heading, the prompt and every agent's skill address together"
import { type Campaign, heroDeleteMs, heroGapMs, heroHoldMs, heroTypeMs } from "../../../gen/frontend__presentation.ts";

export type { Campaign };

export type CampaignPhase = "holding" | "deleting" | "typing";

export interface CampaignFrame {
  readonly action: number;
  readonly characters: number;
  readonly phase: CampaignPhase;
}

export interface CampaignTick {
  readonly delayMs: number;
  readonly next: CampaignFrame;
}

/** @throws {never} */
export function actionOf(campaign: Campaign, frame: CampaignFrame): string {
  return campaign.actions[frame.action % campaign.actions.length] ?? "";
}

/** @throws {never} */
export function firstFrameOf(campaign: Campaign): CampaignFrame {
  return { action: 0, characters: actionOf(campaign, { action: 0, characters: 0, phase: "holding" }).length, phase: "holding" };
}

/** @throws {never} */
export function campaignTick(campaign: Campaign, frame: CampaignFrame): CampaignTick {
  switch (frame.phase) {
    case "holding":
      return { delayMs: heroHoldMs, next: { ...frame, phase: "deleting" } };
    case "deleting":
      return frame.characters > 0
        ? { delayMs: heroDeleteMs, next: { ...frame, characters: frame.characters - 1 } }
        : { delayMs: heroGapMs, next: { action: (frame.action + 1) % campaign.actions.length, characters: 0, phase: "typing" } };
    case "typing":
      return frame.characters < actionOf(campaign, frame).length
        ? { delayMs: heroTypeMs, next: { ...frame, characters: frame.characters + 1 } }
        : { delayMs: 1, next: { ...frame, phase: "holding" } };
    default: {
      const _exhaustive: never = frame.phase;
      return _exhaustive;
    }
  }
}

/** @throws {never} */
export function animatedHeading(campaign: Campaign, frame: CampaignFrame): string {
  return `${campaign.lead} ${actionOf(campaign, frame).slice(0, frame.characters)}`;
}
