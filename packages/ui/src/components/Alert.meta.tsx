import { expect, fn, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { AlertProps } from "./Alert.tsx";
import { Button } from "./Button.tsx";

type Context = { canvasElement: HTMLElement };

const retry = fn();

export const meta: ComponentMeta<AlertProps> = {
  args: { children: "Your payout wallet changed." },
  examples: {
    Retry: { variant: "destructive", children: "Payouts could not be read.", action: <Button size="sm" variant="outline" onClick={retry}>Retry</Button> },
    Silent: { variant: "warn", announcement: "Silent", children: "The vault is underfunded for this month." },
  },
  play: {
    // spec/ui/status.md, "Read states show loading, emptiness, staleness and failure differently"
    Default: ({ canvasElement }: Context) => expect(within(canvasElement).getByRole("status")).toBeVisible(),
    // spec/ui/status.md, "Read states show loading, emptiness, staleness and failure differently"
    Retry: async ({ canvasElement }: Context) => {
      retry.mockClear();
      const canvas = within(canvasElement);
      await expect(canvas.getByRole("alert")).toBeVisible();
      await userEvent.tab();
      await expect(document.activeElement).toBe(canvas.getByRole("button", { name: "Retry" }));
      await userEvent.keyboard("{Enter}");
      await expect(retry).toHaveBeenCalledTimes(1);
    },
    // spec/ui/status.md, "Read states show loading, emptiness, staleness and failure differently"
    Silent: ({ canvasElement }: Context) => expect([within(canvasElement).queryByRole("alert"), within(canvasElement).queryByRole("status")]).toEqual([null, null]),
  },
};
