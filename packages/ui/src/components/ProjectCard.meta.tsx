import type { ComponentMeta } from "vibestack/stories";
import type { ProjectCardProps } from "./ProjectCard.tsx";

export const meta: ComponentMeta<ProjectCardProps> = {
  // The link the card becomes, which no type can supply.
  args: {
    children: <a href="#umia" />,
    name: "Umia Protocol",
    description: "Onchain venture funding with milestone escrow.",
    amount: "2,500.00 USDC",
    note: "This month",
  },
};
