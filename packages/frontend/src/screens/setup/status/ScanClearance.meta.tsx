import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { incomplete } from "./fixtures.ts";
import type { ScanClearanceProps } from "./ScanClearance.tsx";

export const meta: ComponentMeta<ScanClearanceProps> = {
  args: { view: incomplete },
  examples: { Cleared: { view: null } },
  play: {
    // spec/security/enforcement.md, "Each repository clears on its own admission, exemption or retained clean scan"
    Default: async () => {
      await expect(screen.getByRole("region", { name: "Why the scan did not clear" })).toBeTruthy();
      await expect(screen.getByText("1 artifact held")).toBeTruthy();
    },
  },
};
