// spec/frontend/presentation.md, "The campaign keeps one stable accessible heading and respects reduced motion"

export const campaignLead = "MAKE MONEY";

export const campaignActions = ["SHIPPING OPEN SOURCE.", "SECURING THE WEB.", "HACKING THE PLANET.", "BUILDING AGI."] as const;

export const campaignHeading = `${campaignLead} ${campaignActions[0]}`;

const holdMs = 2_400;
const typeMs = 55;
const deleteMs = 30;
const gapMs = 220;

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

export const firstFrame: CampaignFrame = { action: 0, characters: campaignActions[0].length, phase: "holding" };

/** @throws {never} */
export function actionOf(frame: CampaignFrame): string {
  return campaignActions[frame.action % campaignActions.length] ?? campaignActions[0];
}

/** @throws {never} */
export function campaignTick(frame: CampaignFrame): CampaignTick {
  switch (frame.phase) {
    case "holding":
      return { delayMs: holdMs, next: { ...frame, phase: "deleting" } };
    case "deleting":
      return frame.characters > 0
        ? { delayMs: deleteMs, next: { ...frame, characters: frame.characters - 1 } }
        : { delayMs: gapMs, next: { action: (frame.action + 1) % campaignActions.length, characters: 0, phase: "typing" } };
    case "typing":
      return frame.characters < actionOf(frame).length
        ? { delayMs: typeMs, next: { ...frame, characters: frame.characters + 1 } }
        : { delayMs: 1, next: { ...frame, phase: "holding" } };
    default: {
      const _exhaustive: never = frame.phase;
      return _exhaustive;
    }
  }
}

/** @throws {never} */
export function animatedHeading(frame: CampaignFrame): string {
  return `${campaignLead} ${actionOf(frame).slice(0, frame.characters)}`;
}
