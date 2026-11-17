import { expect, fn, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { RetryProps } from "./parts.tsx";
import { appealCase } from "./fixtures.ts";

export const meta: ComponentMeta<RetryProps> = {
  args: { record: appealCase, busy: false, error: null, onRetry: fn() },
  examples: { Unavailable: { record: { ...appealCase, appealTriage: { state: "unavailable", proposedOutcome: null, rationale: null, confidence: null, escalationReasons: [] } } } },
  play: {
    // spec/security/cases.md, "Slopbot drafts advice for each appeal and always escalates a private case"
    Default: async () => {
      await expect(screen.getByText("Every private security case goes to a moderator; Slopbot's confidence is below 0.9")).toBeTruthy();
      await expect(screen.getByText("Slopbot draft. The appeal text can try to influence it; a moderator decides.")).toBeTruthy();
    },
  },
};
