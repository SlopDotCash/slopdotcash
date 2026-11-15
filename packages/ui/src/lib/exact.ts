import { focusRing } from "./cn.ts";

/** An exact value a person may need whole, such as an amount, an address or a command: one line, scrolled by key or pointer, never cut short. Give its element `tabIndex={0}` and a name. */
export const exactValue = `${focusRing} min-w-0 overflow-x-auto rounded-sm whitespace-nowrap font-mono tabular-nums`;
