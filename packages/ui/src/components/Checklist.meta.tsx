import type { ComponentMeta } from "vibestack/stories";
import type { ChecklistProps } from "./Checklist.tsx";

export const meta: ComponentMeta<ChecklistProps> = {
  args: {
    items: [
      { id: "authority", label: "Authority", status: "SetupReady", value: "slop-cash/web" },
      { id: "slopbot", label: "Slopbot", status: "SetupChecking" },
      { id: "security", label: "Security", status: "SetupRefused" },
      { id: "funding", label: "Funding", status: "SetupMissing" },
    ],
  },
  examples: {
    Unavailable: { items: [{ id: "authority", label: "Authority", status: "SetupUnavailable" }] },
  },
};
