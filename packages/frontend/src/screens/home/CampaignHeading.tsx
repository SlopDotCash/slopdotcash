// spec/frontend/presentation.md, "The campaign keeps one stable accessible heading and respects reduced motion"
import { cn } from "@repo/ui";
import { campaignAccessibleHeading, campaignAnimationEnabled, campaignVisibleText } from "../../../gen/frontend__presentation.ts";
import { animatedHeading, campaignActions, campaignHeading, campaignLead } from "./campaign.ts";
import { useCampaignFrame, useMotion } from "./useCampaign.ts";

function Caret() {
  return <span className="ml-1 inline-block h-[0.8em] w-[0.08em] translate-y-[0.08em] bg-primary motion-safe:animate-pulse" />;
}

export type CampaignHeadingProps = {
  className?: string;
};

/** The home page's one heading: its accessible name stays whole while the visible action types and deletes. */
export function CampaignHeading({ className }: CampaignHeadingProps) {
  const motion = useMotion();
  const frame = useCampaignFrame(campaignAnimationEnabled(motion));
  const visible = campaignVisibleText(motion, campaignHeading, animatedHeading(frame));
  return (
    <h1 aria-label={campaignAccessibleHeading(campaignHeading, visible)} className={cn("text-5xl leading-none font-bold tracking-tight text-foreground sm:text-6xl lg:text-7xl", className)}>
      <span aria-hidden className="flex flex-col">
        <span>{campaignLead}</span>
        <span className="grid">
          {campaignActions.map((action) => (
            <span key={action} className="invisible col-start-1 row-start-1">
              {action}
              <Caret />
            </span>
          ))}
          <span className="col-start-1 row-start-1 text-primary">
            {visible.slice(campaignLead.length + 1)}
            <Caret />
          </span>
        </span>
      </span>
    </h1>
  );
}
