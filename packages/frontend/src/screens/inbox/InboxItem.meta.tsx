import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { notices } from "./fixtures.ts";
import type { InboxItemProps } from "./InboxItem.tsx";

const onMark = fn();
const onAcknowledge = fn();

export const meta: ComponentMeta<InboxItemProps> = {
  args: { notice: notices.caseNotice, onMark, onAcknowledge },
  examples: {
    Read: { notice: notices.payment },
    Appeal: { notice: notices.appeal },
    Acknowledged: { notice: notices.acknowledged },
  },
  decorator: (story) => <ol>{story()}</ol>,
  play: {
    // spec/operations/notifications.md, "Only the current recipient reads or acknowledges, and only case notices ask for acknowledgment"
    Default: async () => {
      onAcknowledge.mockClear();
      onMark.mockClear();
      await userEvent.click(screen.getByRole("button", { name: /^Acknowledge:/u }));
      await expect(onAcknowledge).toHaveBeenCalledWith(notices.caseNotice);
      await userEvent.click(screen.getByRole("button", { name: /^Mark as read:/u }));
      await expect(onMark).toHaveBeenCalledWith([notices.caseNotice.eventKey]);
    },
    // spec/operations/notifications.md, "Only the current recipient reads or acknowledges, and only case notices ask for acknowledgment"
    Read: async () => {
      await expect(screen.queryByRole("img", { name: "Unread" })).toBeNull();
      await expect(screen.queryByRole("button", { name: /^Mark as read:/u })).toBeNull();
    },
    // spec/operations/notifications.md, "Only the current recipient reads or acknowledges, and only case notices ask for acknowledgment"
    Appeal: async () => {
      await expect(screen.queryByRole("button", { name: /^Acknowledge:/u })).toBeNull();
      await expect(screen.getByRole("link", { name: /Open appeal on GitHub$/u })).toBeTruthy();
    },
  },
};
