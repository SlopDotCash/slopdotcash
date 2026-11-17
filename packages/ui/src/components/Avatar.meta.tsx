import type { ComponentMeta } from "vibestack/stories";
import type { AvatarProps } from "./Avatar.tsx";

export const meta: ComponentMeta<AvatarProps> = {
  args: { name: "octocat" },
  // Named on its own, as where no login is written beside it.
  examples: { Small: { size: "sm" }, Large: { size: "lg" }, Named: { decorative: false } },
};
