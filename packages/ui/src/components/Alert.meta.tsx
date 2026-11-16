import type { ComponentMeta } from "vibestack/stories";
import type { AlertProps } from "./Alert.tsx";
import { Button } from "./Button.tsx";

// Each variant once, with the default announcement its variant implies, and one with the control that answers it.
export const meta: ComponentMeta<AlertProps> = {
  args: { children: "Projects may be outdated." },
  examples: {
    Info: { variant: "info", children: "Sign in to see your payouts." },
    Ok: { variant: "ok", children: "Wallet linked." },
    Warn: { variant: "warn", children: "Projects may be outdated." },
    Destructive: { variant: "destructive", children: "Projects are unavailable." },
    "With action": { variant: "warn", children: "Projects may be outdated.", action: <Button variant="outline" size="sm">Try again</Button> },
  },
};
