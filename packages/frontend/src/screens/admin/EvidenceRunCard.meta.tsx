import { expect, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { EvidenceRunCardProps } from "./EvidenceRunCard.tsx";
import { evidenceRun } from "./fixtures.ts";

export const meta: ComponentMeta<EvidenceRunCardProps> = {
  args: { run: evidenceRun, policyVersion: "slop-scanner-evidence-2026-10-28", selected: null, onSelect: () => undefined, item: (object) => <p>Inspecting {object.label}</p> },
  examples: {
    Selected: { selected: "4".repeat(64) },
    Empty: { run: { ...evidenceRun, objects: [] } },
  },
  play: {
    // spec/security/evidence.md, "Successful admission stays permanent and ordinary evidence waits ninety days"
    Default: async () => {
      await userEvent.click(screen.getByText("Run details and retention"));
      await expect(screen.getByText("Case open. Evidence is retained until 90 days after closure.")).toBeTruthy();
      await expect(screen.getByText("expired")).toBeTruthy();
    },
    // spec/security/privacy.md, "Read authorization comes from the current case roles and is audited before delivery"
    Selected: async () => {
      await expect(screen.getByText("Inspecting Scan report")).toBeTruthy();
      await expect(screen.getByRole("button", { name: /Select Scan report/ }).getAttribute("aria-pressed")).toBe("true");
    },
    // spec/security/evidence.md, "Successful admission stays permanent and ordinary evidence waits ninety days"
    Empty: async () => {
      await expect(screen.getByText("No retained objects.")).toBeTruthy();
    },
  },
};
