import { expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { NotFoundProps } from "./NotFound.tsx";

export const meta: ComponentMeta<NotFoundProps> = {
  examples: { Project: { title: "Project not found", children: <p className="text-sm text-muted-foreground">This project isn't listed.</p>, as: "section" } },
  play: {
    // spec/ui/controls.md, "The keyboard reaches a row of links in the order shown, and one navigation tab at most is current":
    // the way back is the one link, to the projects.
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      await userEvent.tab();
      const back = within(canvasElement).getByRole("link", { name: "See open projects" });
      await expect([document.activeElement, back.getAttribute("href")]).toEqual([back, "/"]);
      await userEvent.tab({ shift: true });
      await expect(canvasElement.contains(document.activeElement)).toBe(false);
    },
  },
};
