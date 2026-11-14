import type { SyntheticEvent } from "react";
import { activates, focusable } from "../../gen/ui__controls.ts";

const refuse = (event: SyntheticEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

/**
 * The attributes of a control that may be disabled or busy. A busy control keeps its focus and name and says it is
 * busy; both refuse a click, and Enter and Space, which arrive as a click.
 */
// spec/ui/controls.md, "A disabled or busy control refuses activation and stays named"
export function controlState(disabled = false, busy = false) {
  const control = { disabled, busy, named: true };
  return {
    disabled: !focusable(control),
    ...(activates(control) ? {} : { "aria-disabled": true as const, onClickCapture: refuse }),
    ...(busy ? { "aria-busy": true as const } : {}),
  };
}
