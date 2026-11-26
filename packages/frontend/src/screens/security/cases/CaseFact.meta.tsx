import type { ComponentProps } from "react";
import type { ComponentMeta } from "vibestack/stories";
import type { CaseFact } from "./parts.tsx";

export const meta: ComponentMeta<ComponentProps<typeof CaseFact>> = {
  args: { term: "Case", children: "sc_1a2b3c4d" },
  decorator: (story) => <dl>{story()}</dl>,
};
