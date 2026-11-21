import type { ComponentMeta } from "vibestack/stories";
import { readPresentation, setupPresentation, shown } from "../../gen/ui__status.ts";
import type { StatusProps } from "./Status.tsx";

// One example of each tone.
export const meta: ComponentMeta<StatusProps> = {
  args: { presentation: shown("Positive", "Check", "Paid") },
  examples: {
    Queued: { presentation: shown("Neutral", "Clock", "Queued") },
    Held: { presentation: shown("Caution", "Pause", "Held") },
    "Under review": { presentation: shown("Notice", "Eye", "Under review") },
    Refused: { presentation: setupPresentation("SetupRefused") },
    Checking: { presentation: setupPresentation("SetupChecking") },
    "Not allowed": { presentation: readPresentation("Denied") },
  },
};
