import type { ComponentProps } from "react";
import type { ComponentMeta } from "vibestack/stories";
import { Fact, type Facts } from "./parts.tsx";

export const meta: ComponentMeta<ComponentProps<typeof Facts>> = {
  args: { children: <Fact term="Run">run_1</Fact> },
};
