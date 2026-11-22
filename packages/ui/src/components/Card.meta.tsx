import { expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { Button } from "./Button.tsx";
import { CardFooter, type CardProps, CardTitle } from "./Card.tsx";
import { Progress } from "./Progress.tsx";

export const meta: ComponentMeta<CardProps> = {
  args: {
    children: (
      <>
        <CardTitle>Order 1042</CardTitle>
        <Progress value={2} max={3} aria-label="Shipped" />
        <CardFooter>
          <Button>Track</Button>
        </CardFooter>
      </>
    ),
  },
  // `asChild` needs an element to become, which no type can supply.
  examples: { AsChild: { asChild: true, children: <a href="#order-1042"><CardTitle>Order 1042</CardTitle></a> } },
  play: {
    // spec/ui/controls.md, "The keyboard reaches a row of links in the order shown, and one navigation tab at most is current":
    // the card is the link it becomes, reached once, with its title inside.
    AsChild: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const card = within(canvasElement).getByRole("link", { name: "Order 1042" });
      await userEvent.tab();
      await expect([document.activeElement, canvasElement.firstElementChild, within(card).getByRole("heading").textContent]).toEqual([card, card, "Order 1042"]);
      await userEvent.tab();
      await expect(canvasElement.contains(document.activeElement)).toBe(false);
    },
  },
};
