import type { ComponentMeta } from "vibestack/stories";
import { copied, origin } from "./fixtures.ts";
import type { InstallPanelProps } from "./InstallPanel.tsx";

export const meta: ComponentMeta<InstallPanelProps> = {
  args: { origin, onCopy: copied, journey: "Contributor" },
  examples: { Maintainer: { journey: "Maintainer" } },
};
