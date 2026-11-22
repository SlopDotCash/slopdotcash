// spec/frontend/presentation.md, "The campaign keeps one stable accessible heading and respects reduced motion"; spec/frontend/presentation.md, "Home offers a Contributor / Maintainer switch whose journey sets the heading, the prompt and every agent's skill address together"
import { cn } from "@repo/ui";
import { campaignAccessibleHeading, campaignAnimationEnabled, campaignOf, campaignVisibleText, type HomeAudience } from "../../../gen/frontend__presentation.ts";
import { animatedHeading } from "./campaign.ts";
import { useCampaignFrame, useMotion } from "./useCampaign.ts";

function Caret() {
  return <span className="ml-1 inline-block h-[0.8em] w-[0.08em] translate-y-[0.08em] bg-primary motion-safe:animate-pulse" />;
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
    <h1 aria-label={campaignAccessibleHeading(campaign.accessibleHeading, visible)} className={cn("text-5xl leading-none font-bold tracking-tight text-foreground sm:text-6xl lg:text-7xl", className)}>
      <span aria-hidden className="flex flex-col">
        <span>{campaign.lead}</span>
        <span className="grid">
          {campaign.actions.map((action) => (
            <span key={action} className="invisible col-start-1 row-start-1">
              {action}
              <Caret />
            </span>
          ))}
          <span className="col-start-1 row-start-1 text-primary">
            {visible.slice(campaign.lead.length + 1)}
            <Caret />
          </span>
        </span>
      </span>
    </h1>
  );
}
