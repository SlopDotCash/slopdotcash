import type { ComponentMeta } from "vibestack/stories";
import { Avatar } from "./Avatar.tsx";
import { Button } from "./Button.tsx";
import type { PageHeaderProps } from "./PageHeader.tsx";

export const meta: ComponentMeta<PageHeaderProps> = {
  args: { title: "Payouts" },
  examples: {
    Project: { title: "example/slop-cli", icon: <Avatar name="example" size="lg" />, actions: <Button size="sm" variant="outline">Update project</Button> },
  },
};
