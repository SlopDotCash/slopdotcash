import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { fullAward, paused, terms } from "./fixtures.ts";
import type { SecurityOfferProps } from "./SecurityOffer.tsx";

export const meta: ComponentMeta<SecurityOfferProps> = {
  args: { terms },
  examples: { FullAward: { terms: fullAward }, Paused: { terms: paused }, Unpublished: { terms: undefined }, Compact: { compact: true } },
  play: {
    // spec/security/terms.md, "Paid terms carry their split, funding policy, eligibility class and asset"
    Default: async () => {
      await expect(screen.getByText(/to Slop\. No additional payout fee\./u)).toBeTruthy();
    },
    // spec/security/terms.md, "Paid terms carry their split, funding policy, eligibility class and asset"
    FullAward: async () => {
      await expect(screen.getByText(/The researcher receives all of it; Slop takes no share and no payout fee\./u)).toBeTruthy();
    },
    // spec/security/program.md, "Receipt terms come only from the open published revision"
    Paused: async () => {
      await expect(screen.getByText("No paid offer is open. You can still report privately; no award is promised.")).toBeTruthy();
    },
  },
};
