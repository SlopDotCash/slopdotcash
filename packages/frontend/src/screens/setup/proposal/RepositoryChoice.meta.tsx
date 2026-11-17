import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { repositories } from "./fixtures.ts";
import type { RepositoryChoiceProps } from "./RepositoryChoice.tsx";

const onChoose = fn();
const onRetryList = fn();

export const meta: ComponentMeta<RepositoryChoiceProps> = {
  args: { selected: "", onChoose, list: { status: "ready", repositories }, onRetryList },
  examples: {
    Loading: { list: { status: "loading" } },
    ListFailed: { list: { status: "error", message: "GitHub lookup failed." } },
    NoRepositories: { list: { status: "ready", repositories: [] } },
    LookupFailed: { selected: "octo-org/engine", error: "GitHub lookup failed.", onRetryLookup: fn() },
  },
  play: {
    // spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
    Default: async () => {
      onChoose.mockClear();
      const picker = screen.getByLabelText("GitHub repository");
      await expect([...picker.querySelectorAll("option")].map((option) => option.textContent)).toEqual(["Choose a repository", "octo-org/engine", "octocat/hello-world", "Enter repository…"]);
      await userEvent.selectOptions(picker, "Enter repository…");
      await expect(onChoose).toHaveBeenCalledWith("");
      await expect(screen.getByLabelText("GitHub repository").tagName).toBe("INPUT");
    },
    // spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
    Loading: async () => {
      const picker = screen.getByLabelText("GitHub repository");
      await expect([picker.hasAttribute("disabled"), picker.querySelector("option")?.textContent]).toEqual([true, "Loading repositories…"]);
    },
    // spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
    ListFailed: async () => {
      onRetryList.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Retry repositories" }));
      await expect(onRetryList).toHaveBeenCalledOnce();
    },
    // spec/ui/controls.md, "An invalid field is described by its error, then its hint"
    LookupFailed: async () => {
      const field = screen.getByLabelText("GitHub repository");
      await expect([field.getAttribute("aria-describedby"), document.getElementById("field-repository-error")?.textContent]).toEqual(["field-repository-error", "GitHub lookup failed."]);
    },
  },
};
