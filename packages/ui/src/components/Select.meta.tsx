import type { ComponentMeta } from "vibestack/stories";
import type { SelectProps } from "./Select.tsx";

export const meta: ComponentMeta<SelectProps> = {
  args: {
    "aria-label": "Network",
    children: (
      <>
        <option>Base</option>
        <option>Ethereum</option>
        <option>Solana</option>
      </>
    ),
  },
};
