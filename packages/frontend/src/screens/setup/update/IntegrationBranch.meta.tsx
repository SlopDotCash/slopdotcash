import { expect, fn, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { branchChoices, stored } from "./fixtures.ts";
import type { IntegrationBranchProps } from "./IntegrationBranch.tsx";

export const meta: ComponentMeta<IntegrationBranchProps> = {
  args: { stored, choices: { state: "idle" }, name: "", error: undefined, disabled: false, onLoad: fn(), onChoose: fn() },
  examples: {
    Loading: { choices: { state: "loading" } },
    Ready: { choices: { state: "ready", choices: branchChoices } },
    Chosen: { choices: { state: "ready", choices: branchChoices }, name: "release" },
    Conflict: { choices: { state: "ready", choices: branchChoices }, name: "release", error: "Save the other settings before changing the integration branch." },
    NoOtherHead: { choices: { state: "ready", choices: [] } },
    DifferentRepository: { choices: { state: "error", message: "GitHub returned a different repository." } },
    Unverified: { stored: undefined },
  },
  play: {
    // spec/backend/projects.md, "A current repository administrator moves the integration branch with a committed declaration"
    Ready: async () => {
      await expect(screen.getByRole("combobox")).toBeTruthy();
    },
    // spec/backend/projects.md, "A current repository administrator moves the integration branch with a committed declaration"
    NoOtherHead: async () => {
      await expect([screen.queryByRole("combobox"), screen.getAllByRole("status").length > 0]).toEqual([null, true]);
    },
    // spec/backend/projects.md, "A current repository administrator moves the integration branch with a committed declaration"
    Unverified: async () => {
      await expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
    },
  },
};
