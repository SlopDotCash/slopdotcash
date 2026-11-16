import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { Button } from "./Button.tsx";
import type { ConfirmDialogProps } from "./ConfirmDialog.tsx";

const onSend = fn();

/** Tries every way out of the shown dialog and returns the events its owner received. */
const leave = async () => {
  onSend.mockClear();
  await screen.findByRole("alertdialog", { name: "Remove Umia Protocol?" });
  await userEvent.click(screen.getByRole("button", { name: "Remove" }), { pointerEventsCheck: 0 });
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }), { pointerEventsCheck: 0 });
  await userEvent.keyboard("{Escape}");
  return onSend.mock.calls;
};

export const meta: ComponentMeta<ConfirmDialogProps> = {
  args: {
    state: { phase: "Closed", confirmed: 0, completed: 0 },
    onSend,
    title: "Remove Umia Protocol?",
    children: "Its listing and skills go. Funded obligations stay payable.",
    confirmLabel: "Remove",
    destructive: true,
    reason: "The vault has a payment in flight.",
    trigger: <Button variant="destructive">Remove project</Button>,
  },
  examples: {
    Asking: { state: { phase: "Asking", confirmed: 0, completed: 0 } },
    Working: { state: { phase: "Working", confirmed: 1, completed: 0 } },
    Refused: { state: { phase: "Refused", confirmed: 1, completed: 0 } },
  },
  play: {
    // spec/ui/confirmation.md, "Only an explicit confirm starts the work"
    Default: async () => {
      onSend.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Remove project" }));
      await expect(onSend.mock.calls).toEqual([[{ type: "open" }]]);
    },
    // spec/ui/confirmation.md, "Only an explicit confirm starts the work"
    Asking: async () => {
      await expect(await leave()).toEqual([[{ type: "confirm" }], [{ type: "cancel" }], [{ type: "cancel" }]]);
      await expect(screen.queryByRole("alert")).toBeNull();
    },
    // spec/ui/confirmation.md, "The work's answer closes the dialog or keeps it open with the reason"
    Working: async () => {
      await expect(await leave()).toEqual([]);
      await expect(screen.getByRole("button", { name: "Remove" }).getAttribute("aria-busy")).toBe("true");
    },
    // spec/ui/confirmation.md, "The work's answer closes the dialog or keeps it open with the reason"
    Refused: async () => {
      await expect(await leave()).toEqual([[{ type: "confirm" }], [{ type: "cancel" }], [{ type: "cancel" }]]);
      await expect(screen.getByRole("alert").textContent).toBe("The vault has a payment in flight.");
    },
  },
};
