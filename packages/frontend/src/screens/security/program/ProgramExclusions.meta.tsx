import { SECURITY_DEFAULT_EXCLUSIONS } from "@repo/security/client";
import { expect, screen, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { ownerExclusions, withOwnerExclusions } from "./fixtures.ts";
import type { ProgramExclusionsProps } from "./ProgramExclusions.tsx";

export const meta: ComponentMeta<ProgramExclusionsProps> = {
  args: { scope: withOwnerExclusions.scope },
  examples: { DefaultsOnly: { scope: {} } },
  play: {
    // spec/security/terms.md, "Exclusions are frozen with the terms and stay advice"
    Default: async () => {
      const defaults = within(screen.getByRole("list", { name: "Does not qualify" })).getAllByRole("listitem");
      await expect(defaults.map((item) => item.textContent)).toEqual([...SECURITY_DEFAULT_EXCLUSIONS]);
      const owner = within(screen.getByRole("list", { name: "Also does not qualify for this program" })).getAllByRole("listitem");
      await expect(owner.map((item) => item.textContent)).toEqual([...ownerExclusions]);
    },
    // spec/security/terms.md, "Exclusions are frozen with the terms and stay advice"
    DefaultsOnly: async () => {
      await expect(screen.getByRole("heading", { name: "Does not qualify" })).toBeTruthy();
      await expect(screen.queryByRole("heading", { name: "Also does not qualify for this program" })).toBeNull();
    },
  },
};
