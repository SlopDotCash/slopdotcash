import { expect, within } from "storybook/test";
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
    Vaulted: { presentation: shown("Positive", "Check", "Vaulted"), badge: true },
    Promised: { presentation: shown("Caution", "Alert", "Promised"), badge: true },
    Configured: { presentation: shown("Neutral", "Dot", "Configured"), badge: true },
  },
  play: {
    // spec/ui/status.md, "A presentation is a tone, an icon and a word"
    Vaulted: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const badge = within(canvasElement).getByText("Vaulted");
      await expect([badge.textContent, badge.querySelector("svg")?.getAttribute("aria-hidden")]).toEqual(["Vaulted", "true"]);
    },
  },
};
