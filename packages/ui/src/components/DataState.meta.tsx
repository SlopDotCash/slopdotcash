import { expect, type fn, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { DataStateProps } from "./DataState.tsx";

type Context = { args: DataStateProps; canvasElement: HTMLElement };

const rows = (
  <ul className="flex flex-col gap-2 text-sm">
    <li>slop/web</li>
    <li>slop/contracts</li>
  </ul>
);

/** The live region's politeness, whether the rows are shown, and whether Retry is offered. */
const shown = (canvasElement: HTMLElement) => {
  const canvas = within(canvasElement);
  return [canvasElement.querySelector("[aria-live]")?.getAttribute("aria-live"), canvas.queryByText("slop/web") !== null, canvas.queryByRole("button", { name: "Retry" }) !== null];
};

/** Activates Retry by `act` and returns how many times it asked again; the spy is shared by every story. */
const retries = async ({ args, canvasElement }: Context, act: (button: HTMLElement) => Promise<void>) => {
  const before = (args.onRetry as ReturnType<typeof fn>).mock.calls.length;
  await act(within(canvasElement).getByRole("button", { name: "Retry" }));
  return (args.onRetry as ReturnType<typeof fn>).mock.calls.length - before;
};

export const meta: ComponentMeta<DataStateProps> = {
  args: { status: "Current", children: rows },
  play: {
    // spec/ui/status.md, "Read states show loading, emptiness, staleness and failure differently"
    StatusStale: async (context: Context) => {
      await expect(shown(context.canvasElement)).toEqual(["polite", true, true]);
      await expect(await retries(context, (button) => userEvent.click(button))).toBe(1);
    },
    // spec/ui/status.md, "Read states show loading, emptiness, staleness and failure differently"
    StatusFailed: async (context: Context) => {
      await expect(shown(context.canvasElement)).toEqual(["assertive", false, true]);
      await expect(await retries(context, async (button) => {
        button.focus();
        await userEvent.keyboard("{Enter}");
      })).toBe(1);
    },
    // spec/ui/status.md, "Read states show loading, emptiness, staleness and failure differently"
    StatusDenied: ({ canvasElement }: Context) => expect(shown(canvasElement)).toEqual(["assertive", false, false]),
    // spec/ui/status.md, "Read states show loading, emptiness, staleness and failure differently": Loading is announced
    // politely, from a live region no busy container holds back.
    StatusLoading: async ({ canvasElement }: Context) => {
      await expect(shown(canvasElement)).toEqual(["polite", false, false]);
      const live = canvasElement.querySelector("[aria-live]")!;
      await expect([live.textContent, live.closest("[aria-busy='true']")]).toEqual(["Loading", null]);
    },
  },
};
