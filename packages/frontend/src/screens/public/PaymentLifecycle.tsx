// spec/frontend/projections.md, "Payment states keep award, funding and settlement apart"
export interface Milestone {
  readonly name: string;
  readonly detail?: string;
}

export type MilestonesProps = {
  /** The list's accessible name. */
  label: string;
  /** The milestones in order. */
  milestones: ReadonlyArray<Milestone>;
};

const marker = "before:absolute before:size-3.75 before:rounded-full before:bg-primary max-lg:before:top-0.5 max-lg:before:-left-2.25 lg:before:-top-2.25 lg:before:left-0";

/** Ordered milestones on a line, each with the one fact a reader needs about it. */
export function Milestones({ label, milestones }: MilestonesProps) {
  return (
    <ol aria-label={label} className="mt-6 grid grid-cols-4 text-muted-foreground max-md:grid-cols-2 max-md:gap-y-5">
      {milestones.map((milestone) => (
        <li key={milestone.name} className={`relative grid content-start gap-1.5 leading-prose ${marker} max-lg:border-l-3 max-lg:border-foreground/22 max-lg:pt-4.5 max-lg:pb-5.5 max-lg:pl-7 lg:border-t-3 lg:border-foreground/22 lg:pt-4.5 lg:pr-4`}>
          <strong className="font-bold">{milestone.name}</strong>
          {milestone.detail ? <span className="text-sm leading-summary">{milestone.detail}</span> : null}
        </li>
      ))}
    </ol>
  );
}

export const payoutTimeline: ReadonlyArray<Milestone> = [
  { name: "Month ends", detail: "UTC" },
  { name: "72h review", detail: "Owner adjusts" },
  { name: "Locks", detail: "Automatically" },
  { name: "Paid", detail: "On chain · 2% fee" },
];

const awardMilestones: ReadonlyArray<Milestone> = [{ name: "Projected" }, { name: "Under review" }, { name: "Approved" }, { name: "Paid" }];

/** An ordinary award's milestones, from projection to finalized payment. */
export function PaymentLifecycle() {
  return <Milestones label="Ordinary award and payment milestones" milestones={awardMilestones} />;
}
