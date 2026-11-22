import { expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { ExternalLinkProps } from "./ExternalLink.tsx";

/** The one link of the story, reached by Tab, as the other site sees it. */
const reached = async (canvasElement: HTMLElement, name: string) => {
  await userEvent.tab();
  const link = within(canvasElement).getByRole("link", { name });
  return { focused: document.activeElement === link, href: link.getAttribute("href"), target: link.getAttribute("target"), rel: link.getAttribute("rel") };
};
const away = { focused: true, href: "https://github.com/octocat", target: "_blank", rel: "noreferrer" };

export const meta: ComponentMeta<ExternalLinkProps> = {
  args: { href: "https://github.com/octocat", children: "octocat on GitHub", className: "text-primary underline underline-offset-4" },
  examples: {
    Labelled: { children: "@octocat", label: "octocat on GitHub" },
    // A link that shows nothing is named by `label`.
    Empty: { children: undefined, label: "octocat on GitHub" },
  },
  play: {
    // spec/ui/controls.md, "A link to another site opens in a new tab and sends that site no referrer"
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      await expect(await reached(canvasElement, "octocat on GitHub")).toEqual(away);
    },
    // spec/ui/controls.md, "A link to another site opens in a new tab and sends that site no referrer": named by `label`, not the handle it shows.
    Labelled: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      await expect(await reached(canvasElement, "octocat on GitHub")).toEqual(away);
    },
  },
};
