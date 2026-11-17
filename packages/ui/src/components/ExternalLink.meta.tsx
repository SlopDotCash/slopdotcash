import type { ComponentMeta } from "vibestack/stories";
import type { ExternalLinkProps } from "./ExternalLink.tsx";

export const meta: ComponentMeta<ExternalLinkProps> = {
  args: { href: "https://github.com/octocat", children: "octocat on GitHub", className: "text-primary underline underline-offset-4" },
  examples: {
    Labelled: { children: "@octocat", label: "octocat on GitHub" },
    // A link that shows nothing is named by `label`.
    Empty: { children: undefined, label: "octocat on GitHub" },
  },
};
