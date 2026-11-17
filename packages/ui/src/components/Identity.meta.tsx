import type { ComponentMeta } from "vibestack/stories";
import type { IdentityProps } from "./Identity.tsx";

export const meta: ComponentMeta<IdentityProps> = {
  args: { login: "octocat" },
  examples: {
    Linked: { href: "#octocat", detail: "Maintainer" },
    Small: { size: "sm" },
    // The heading of a profile page.
    Profile: { size: "lg", detail: "Joined October 2026" },
  },
};
