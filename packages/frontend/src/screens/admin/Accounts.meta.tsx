import type { ComponentMeta } from "vibestack/stories";
import type { ComponentProps } from "react";
import type { Accounts } from "./parts.tsx";

export const meta: ComponentMeta<ComponentProps<typeof Accounts>> = {
  args: {
    accounts: [{ githubLogin: "octo-reviewer" }, { githubLogin: "slop-admin" }],
  },
  examples: {
    Single: { accounts: [{ githubLogin: "octo-reviewer" }] },
    Empty: { accounts: [] },
  },
};
