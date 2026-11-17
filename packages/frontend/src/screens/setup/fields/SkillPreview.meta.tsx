import { expect, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { draftManifest } from "../proposal/manifest.ts";
import { filled, registry } from "../proposal/fixtures.ts";
import type { SkillPreviewProps } from "./SkillPreview.tsx";

const { manifest } = draftManifest({ proposal: filled, actor: undefined, valid: true, now: "2026-11-17T12:00:00.000Z" });

export const meta: ComponentMeta<SkillPreviewProps> = {
  args: { manifest, provenance: { status: "ready", registry }, collapsible: false },
  examples: {
    Draft: { draft: true, compact: true },
    Preparing: { provenance: { status: "preparing" } },
    Unprepared: { provenance: { status: "failed" } },
    Committed: { manifest: { ...manifest, skill: { id: "contribute-to-engine", sourcePath: "skills/engine" } } },
  },
  play: {
    // spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"; spec/contributor/skillRendering.md, "Rendering depends only on the template commit and the approved revision"
    Default: async () => {
      await expect(screen.getByText("Contributor skill SKILL.md")).toBeTruthy();
      await userEvent.click(screen.getByRole("radio", { name: "Reviewer" }));
      await expect(screen.getByText("Reviewer skill SKILL.md")).toBeTruthy();
      await userEvent.selectOptions(screen.getByLabelText("File"), "project.json");
      await expect(screen.getByRole("group", { name: "Reviewer skill project.json" }).textContent).toContain(registry.manifestSha256);
    },
  },
};
