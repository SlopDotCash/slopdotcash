import { expect, fn, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { PaginationProps } from "./Pagination.tsx";

const onSend = fn();

/** Presses both moves and returns the events the list received. */
const press = async (canvasElement: HTMLElement) => {
  onSend.mockClear();
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: "Previous page" }), { pointerEventsCheck: 0 });
  await userEvent.click(canvas.getByRole("button", { name: "Next page" }), { pointerEventsCheck: 0 });
  return onSend.mock.calls;
};

export const meta: ComponentMeta<PaginationProps> = {
  args: { state: { page: 2, pages: 5 }, onSend },
  examples: { First: { state: { page: 1, pages: 5 } }, Last: { state: { page: 5, pages: 5 } } },
  // spec/ui/pagination.md, "The page stays within the pages that exist"
  play: {
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => expect(await press(canvasElement)).toEqual([[{ type: "back" }], [{ type: "forward" }]]),
    First: async ({ canvasElement }: { canvasElement: HTMLElement }) => expect(await press(canvasElement)).toEqual([[{ type: "forward" }]]),
    Last: async ({ canvasElement }: { canvasElement: HTMLElement }) => expect(await press(canvasElement)).toEqual([[{ type: "back" }]]),
  },
};
