import type { ComponentMeta } from "vibestack/stories";
import { Button } from "./Button.tsx";
import type { PageHeaderProps } from "./PageHeader.tsx";

export const meta: ComponentMeta<PageHeaderProps> = {
  args: { title: "Points" },
  examples: {
    "With actions": { title: "Inbox", actions: <Button variant="outline">Mark all read</Button> },
    "With lead": { eyebrow: <a href="#project">Umia Protocol</a>, title: "Umia Protocol · November 2026", lead: "1 Nov 2026–30 Nov 2026" },
  },
};
