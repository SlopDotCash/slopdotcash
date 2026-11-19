import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { draft, terms } from "./fixtures.ts";
import type { ReportComposerProps } from "./ReportComposer.tsx";

const onChange = fn();
const onEdit = fn();
const onSubmit = fn();

export const meta: ComponentMeta<ReportComposerProps> = {
  args: {
    login: "octocat",
    projectName: "Acme Vault",
    terms,
    draft,
    attempted: false,
    storageAvailable: true,
    phase: { kind: "compose", review: false },
    busy: false,
    error: null,
    onChange,
    onEdit,
    onSubmit,
  },
  examples: {
    Review: { phase: { kind: "compose", review: true } },
    Uncertain: { phase: { kind: "compose", review: true }, attempted: true, error: "No receipt returned. Retry." },
    NoStorage: { storageAvailable: false },
    NeedsSession: { phase: { kind: "needsSession" }, error: "Session check failed. Report kept." },
    Received: { phase: { kind: "received", message: null } },
  },
  play: {
    // spec/frontend/drafts.md, "A draft belongs to one account and project"
    Default: async () => {
      onSubmit.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Review report" }));
      await expect(onSubmit).toHaveBeenCalled();
    },
    // spec/frontend/drafts.md, "The first send fixes a key and retries keep that key and content"
    Uncertain: async () => {
      await expect(screen.queryByRole("button", { name: "Edit report" })).toBeNull();
      await expect(screen.getByRole("button", { name: "Retry same report" })).toBeTruthy();
    },
    // spec/frontend/drafts.md, "Editing keeps storage failures visible and invalidates the reviewed content"
    Review: async () => {
      onEdit.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Edit report" }));
      await expect(onEdit).toHaveBeenCalled();
    },
  },
};
