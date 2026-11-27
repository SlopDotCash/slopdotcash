// spec/frontend/presentation.md, "The campaign keeps one stable accessible heading and respects reduced motion"; spec/frontend/presentation.md, "Home offers a Contributor / Maintainer switch whose journey sets the heading, the prompt and every agent's skill address together"
import { cn } from "@repo/ui";
import { campaignAccessibleHeading, campaignAnimationEnabled, campaignOf, campaignVisibleText, type HomeAudience } from "../../../gen/frontend__presentation.ts";
import { animatedHeading } from "./campaign.ts";
import { useCampaignFrame, useMotion } from "./useCampaign.ts";

function Caret() {
  return <span className="ml-[0.04em] inline-block h-[0.78em] w-[0.055em] translate-y-[0.04em] animate-caret bg-current motion-reduce:invisible motion-reduce:animate-none" />;
}

export type CampaignHeadingProps = {
  /** The Home journey whose campaign is shown. */
  journey: HomeAudience;
  className?: string;
};

/** The home page's one heading: its accessible name stays whole while the visible action types and deletes. */
export function CampaignHeading({ journey, className }: CampaignHeadingProps) {
  const campaign = campaignOf(journey);
  const motion = useMotion();
  const frame = useCampaignFrame(journey, campaignAnimationEnabled(motion));
  const visible = campaignVisibleText(motion, campaign.accessibleHeading, animatedHeading(campaign, frame));
  return (
    <h1 aria-label={campaignAccessibleHeading(campaign.accessibleHeading, visible)} className={cn("m-0 w-full max-w-280 text-hero leading-hero font-extrabold tracking-tighter text-foreground uppercase md:text-7xl lg:text-hero-lg xl:text-hero-xl", className)}>
      <span aria-hidden className="flex flex-col">
        <span>{campaign.lead}</span>
        <span className="grid min-w-0 grid-cols-[minmax(0,1fr)] text-title leading-display tracking-tighter text-balance text-primary max-md:mt-[0.08em] max-md:min-h-[1.8em] md:text-5xl md:leading-title lg:text-7xl xl:text-action-xl">
          {campaign.actions.map((action) => (
            <span key={action} className="invisible col-start-1 row-start-1">
              {action}
              <Caret />
            </span>
          ))}
          <span className="col-start-1 row-start-1 self-start">
            {visible.slice(campaign.lead.length + 1)}
            <Caret />
          </span>
        </span>
      </span>
    </h1>
  );
}
