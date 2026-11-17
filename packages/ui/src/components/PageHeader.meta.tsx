import type { ComponentMeta } from "vibestack/stories";
import { Button } from "./Button.tsx";
import type { PageHeaderProps } from "./PageHeader.tsx";

export const meta: ComponentMeta<PageHeaderProps> = {
  args: { title: "Points" },
  examples: { "With actions": { title: "Inbox", actions: <Button variant="outline">Mark all read</Button> } },
};
