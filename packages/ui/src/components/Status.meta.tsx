import type { ComponentMeta } from "vibestack/stories";
import { awardPresentation, paymentPresentation, readPresentation, setupPresentation } from "../../gen/ui__status.ts";
import type { StatusProps } from "./Status.tsx";

// One example of each tone, from the presentations the spec decides.
export const meta: ComponentMeta<StatusProps> = {
  args: { presentation: paymentPresentation("PaidPayment") },
  examples: {
    Queued: { presentation: paymentPresentation("ReadyToPay") },
    Held: { presentation: paymentPresentation("HeldPayment") },
    "Under review": { presentation: awardPresentation("UnderReview") },
    Refused: { presentation: setupPresentation("SetupRefused") },
    Checking: { presentation: setupPresentation("SetupChecking") },
    "Not allowed": { presentation: readPresentation("Denied") },
  },
};
