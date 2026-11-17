import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { ClosureConsentProps } from "./ClosureConsent.tsx";

const onChange = fn();

export const meta: ComponentMeta<ClosureConsentProps> = {
  args: { value: "false", onChange },
  examples: { Saved: { value: "true" }, NotExactlyYes: { value: "yes" }, Compact: { compact: true } },
  play: {
    // spec/backend/closureConsent.md, "The new form starts unchecked and an existing form reflects only its exact saved setting"
    Default: async () => {
      onChange.mockClear();
      const box = screen.getByRole("checkbox", { name: "Allow automatic closure by Slopbot" });
      await expect(box.getAttribute("aria-checked")).toBe("false");
      await userEvent.click(box);
      await expect(onChange).toHaveBeenCalledWith("true");
    },
    // spec/backend/closureConsent.md, "The new form starts unchecked and an existing form reflects only its exact saved setting"
    Saved: async () => {
      await expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
    },
    // spec/backend/closureConsent.md, "The new form starts unchecked and an existing form reflects only its exact saved setting"
    NotExactlyYes: async () => {
      await expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
    },
  },
};
