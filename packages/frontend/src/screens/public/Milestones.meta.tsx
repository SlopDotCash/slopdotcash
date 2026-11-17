import type { ComponentMeta } from "vibestack/stories";
import { type MilestonesProps, payoutTimeline } from "./PaymentLifecycle.tsx";

export const meta: ComponentMeta<MilestonesProps> = {
  args: { label: "Monthly payout timeline", milestones: payoutTimeline },
};
