import { ExternalLink as Opens } from "lucide-react";
import { expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { ExternalLinkProps } from "./ExternalLink.tsx";

type Context = { canvasElement: HTMLElement };

const reachedByKeyboard = async (canvasElement: HTMLElement, name: string) => {
  const link = within(canvasElement).getByRole("link", { name });
  await userEvent.tab();
  await expect(document.activeElement).toBe(link);
  await expect([link.getAttribute("target"), link.getAttribute("rel")]).toEqual(["_blank", "noreferrer"]);
};

export const meta: ComponentMeta<ExternalLinkProps> = {
  args: { href: "https://github.com/example/slop-cli", children: "example/slop-cli" },
  examples: {
    "Icon only": {
      href: "https://basescan.org/tx/0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060",
      children: <Opens aria-hidden className="size-4" />,
      label: "Transaction on Basescan",
    },
  },
  play: {
    // spec/frontend/projections.md, "Interface capability requirements survive responsive and accessibility modes"
    Default: ({ canvasElement }: Context) => reachedByKeyboard(canvasElement, "example/slop-cli, opens in a new tab"),
    // spec/frontend/projections.md, "Interface capability requirements survive responsive and accessibility modes"
    "Icon only": ({ canvasElement }: Context) => reachedByKeyboard(canvasElement, "Transaction on Basescan, opens in a new tab"),
  },
};
