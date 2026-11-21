import { expect, screen, userEvent, waitFor } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { Button } from "./Button.tsx";
import { DialogClose, DialogContent, DialogDescription, DialogFooter, type DialogProps, DialogTitle, DialogTrigger } from "./Dialog.tsx";

const children = (
  <>
    <DialogTrigger asChild>
      <Button variant="destructive">Delete</Button>
    </DialogTrigger>
    <DialogContent>
      <DialogTitle>Delete the order?</DialogTitle>
      <DialogDescription>Order 1042 and its history go for good.</DialogDescription>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Keep</Button>
        </DialogClose>
        <Button variant="destructive">Delete</Button>
      </DialogFooter>
    </DialogContent>
  </>
);

export const meta: ComponentMeta<DialogProps> = {
  args: { children },
  examples: { Open: { defaultOpen: true } },
  play: {
    // spec/ui/controls.md, "A dialog takes focus when it opens, keeps it inside, and gives it back to its trigger when dismissed"
    Default: async () => {
      // Focus goes back a moment after the dialog closes.
      const trigger = screen.getByRole("button", { name: "Delete" });
      trigger.focus();
      await userEvent.keyboard("{Enter}");
      const dialog = await screen.findByRole("dialog", { name: "Delete the order?" });
      await expect([dialog.contains(document.activeElement), dialog.getAttribute("aria-describedby") === screen.getByText("Order 1042 and its history go for good.").id]).toEqual([true, true]);
      for (let press = 0; press < 4; press++) await userEvent.tab();
      await expect(dialog.contains(document.activeElement)).toBe(true);
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect([screen.queryByRole("dialog"), document.activeElement]).toEqual([null, trigger]));
      await userEvent.click(trigger);
      await userEvent.click(await screen.findByRole("button", { name: "Close" }));
      await waitFor(() => expect([screen.queryByRole("dialog"), document.activeElement]).toEqual([null, trigger]));
    },
  },
};
