// What only a browser shows of spec/ui/index.md: the heights controls are laid out at, what moves under reduced
// motion, and the ring keyboard focus draws, on the design tokens in Chromium.
import "@repo/design-system/theme.css";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { cdp, userEvent } from "vitest/browser";
import { heightPx } from "../gen/ui.ts";
import { Button, Checkbox, Input, Progress, Select, Skeleton, Spinner, Switch, Textarea } from "../src/index.ts";

const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previous = environment.IS_REACT_ACT_ENVIRONMENT;
let root: Root | undefined;

async function show(node: React.ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(() => Promise.resolve(root!.render(node)));
  return host;
}
const motion = (value: "reduce" | "no-preference") =>
  cdp().send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value }] });

beforeAll(() => { environment.IS_REACT_ACT_ENVIRONMENT = true; document.documentElement.className = "dark"; });
afterEach(async () => {
  await act(() => Promise.resolve(root?.unmount()));
  document.body.replaceChildren();
  await motion("no-preference");
});
afterAll(() => { environment.IS_REACT_ACT_ENVIRONMENT = previous; });

// spec/ui/index.md, "Controls are 40px or 48px high, and fields 52px"
it("lays controls out at the heights the spec gives", async () => {
  const host = await show(
    <>
      <Button size="sm">Small</Button>
      <Button>Regular</Button>
      <Input aria-label="Name" />
      <Select aria-label="Network"><option>Base</option></Select>
    </>,
  );
  const height = (selector: string) => host.querySelector(selector)!.getBoundingClientRect().height;
  const [small, regular] = [...host.querySelectorAll("button")].map((button) => button.getBoundingClientRect().height);
  expect([small, regular, height("input"), height("select")]).toEqual([heightPx("Small"), heightPx("Regular"), heightPx("Field"), heightPx("Field")]);
});

// spec/ui/index.md, "Under reduced motion nothing spins, pulses or slides"
it("stands still under reduced motion, and moves otherwise", async () => {
  const host = await show(
    <>
      <Spinner />
      <Skeleton />
      <Progress aria-label="Upload" value={null} />
      <Button>Save</Button>
      <Switch aria-label="Email" />
    </>,
  );
  const moving = () => ({
    spin: getComputedStyle(host.querySelector("svg")!).animationName,
    pulse: getComputedStyle(host.querySelector("[aria-hidden].h-4")!).animationName,
    bar: getComputedStyle(host.querySelector("[role=progressbar] > div")!).animationName,
    button: getComputedStyle(host.querySelector("button:not([role=switch])")!).transitionDuration,
    toggle: getComputedStyle(host.querySelector("[role=switch]")!).transitionDuration,
  });
  expect(Object.values(moving()).every((value) => value !== "none" && value !== "0s")).toBe(true);
  await motion("reduce");
  expect(moving()).toEqual({ spin: "none", pulse: "none", bar: "none", button: "0s", toggle: "0s" });
});

// spec/ui/index.md, "Keyboard focus always shows the ring"
it("shows the ring on every control reached by the keyboard", async () => {
  const host = await show(
    <>
      <Button>Save</Button>
      <Input aria-label="Name" />
      <Textarea aria-label="Reason" />
      <Select aria-label="Network"><option>Base</option></Select>
      <Checkbox aria-label="Agree" />
      <Switch aria-label="Email" />
    </>,
  );
  const ring = getComputedStyle(document.documentElement).getPropertyValue("--ring").trim();
  expect(ring).not.toBe("");
  const controls = [...host.querySelectorAll<HTMLElement>("button, input, textarea, select")];
  const seen = [];
  for (const _ of controls) {
    await userEvent.keyboard("{Tab}");
    const focused = document.activeElement as HTMLElement;
    const style = getComputedStyle(focused);
    seen.push({ control: controls.indexOf(focused), ring: style.boxShadow !== "none", outline: style.outlineStyle });
  }
  expect(seen).toEqual(controls.map((_, control) => ({ control, ring: true, outline: "none" })));
});
