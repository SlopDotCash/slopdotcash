// spec/frontend/projections.md, "Payment states keep award, funding and settlement apart"
import { Stepper } from "@repo/ui";

export interface Milestone {
  readonly name: string;
  readonly detail: string;
}

export type MilestonesProps = {
  /** The list's accessible name. */
  label: string;
  /** The milestones in order. */
  milestones: ReadonlyArray<Milestone>;
};

/** Ordered milestones, each with the one fact a reader needs about it. */
export function Milestones({ label, milestones }: MilestonesProps) {
  return (
    <div className="flex flex-col gap-4">
      <Stepper aria-label={label} steps={milestones.map((milestone) => milestone.name)} />
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {milestones.map((milestone) => (
          <div key={milestone.name} className="flex flex-col gap-1">
            <dt className="font-medium text-foreground">{milestone.name}</dt>
            <dd className="text-muted-foreground">{milestone.detail}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export const payoutTimeline: ReadonlyArray<Milestone> = [
  { name: "Month ends", detail: "UTC" },
  { name: "72h review", detail: "Owner adjusts" },
  { name: "Locks", detail: "Automatically" },
  { name: "Paid", detail: "On chain · 2% fee" },
];

/** An ordinary award's milestones, from projection to finalized payment. */
export function PaymentLifecycle() {
  return <Stepper aria-label="Ordinary award and payment milestones" steps={["Projected", "Under review", "Approved", "Paid"]} />;
}
