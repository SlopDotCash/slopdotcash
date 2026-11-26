import type { ComponentProps } from "react";
import type { ComponentMeta } from "vibestack/stories";
import type { Fact } from "./parts.tsx";

export const meta: ComponentMeta<ComponentProps<typeof Fact>> = {
  args: { term: "Run", children: "run_1" },
  decorator: (story) => <dl>{story()}</dl>,
};
