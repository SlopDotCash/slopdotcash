import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { fullAward, funded, paused, terms } from "./fixtures.ts";
import type { SecurityOfferProps } from "./SecurityOffer.tsx";

export const meta: ComponentMeta<SecurityOfferProps> = {
  args: { terms },
  examples: { FullAward: { terms: fullAward }, Funded: { terms: funded }, Paused: { terms: paused }, Unpublished: { terms: undefined }, Compact: { compact: true } },
  play: {
    // spec/security/terms.md, "Paid terms carry their split, funding policy, eligibility class and asset"
    Default: async () => {
      await expect(screen.getByRole("region", { name: "Published bounty offer" })).toBeTruthy();
    },
    // spec/security/program.md, "Receipt terms come only from the open published revision"
    Paused: async () => {
      await expect(screen.queryByRole("region", { name: "Published bounty offer" })).toBeNull();
    },
  },
};
