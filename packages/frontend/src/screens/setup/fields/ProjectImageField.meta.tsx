import { fn } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { ProjectImageFieldProps } from "./ProjectImageField.tsx";

export const meta: ComponentMeta<ProjectImageFieldProps> = {
  args: { value: "", onChange: fn(), ownerLogin: "octo-org" },
  examples: { NoOwner: { ownerLogin: "" } },
};
