// What only a browser shows of spec/ui/index.md: each control kind's primitive in every `Shown`, compared
// with `moves` and `showsRing`; the heights controls are laid out at; and the 44px square each control is hit in,
// on the design tokens in Chromium.
import "@repo/design-system/fonts";
import "@repo/design-system/theme.css";
import "../styles.css";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { cdp, userEvent } from "vitest/browser";
import { type ControlKind, type Focus, heightPx, type Motion, moves, type Shown, showsRing, targetPx } from "../gen/ui.ts";
import {
  Button, Checkbox, ConfirmDialog, CopyButton, Dialog, DialogContent, DialogTitle, Disclosure, FileField, Identity, Input, NavTab, NavTabs, Pagination,
  Progress, RadioGroup, SegmentedControl, Select, SiteFooter, Skeleton, Spinner, Switch, Table, TableHead, TableHeader, TableRow, Textarea, useConfirmation,
} from "../src/index.ts";

const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previous = environment.IS_REACT_ACT_ENVIRONMENT;
let root: Root | undefined;

async function show(node: ReactNode) {
  await act(() => Promise.resolve(root?.unmount()));
  document.body.replaceChildren();
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "flex flex-col items-start gap-12 p-12";
  root = createRoot(host);
  await act(() => Promise.resolve(root!.render(node)));
  return host;
}
/** Presses or releases the mouse at the middle of `element`, as a person's pointer does. */
async function mouse(type: "mousePressed" | "mouseReleased", element: Element) {
  const box = element.getBoundingClientRect();
  await cdp().send("Input.dispatchMouseEvent", { type, x: box.left + box.width / 2, y: box.top + box.height / 2, button: "left", clickCount: 1 });
}
const motion = (value: "reduce" | "no-preference") =>
  cdp().send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value }] });

beforeAll(() => { environment.IS_REACT_ACT_ENVIRONMENT = true; document.documentElement.className = "dark"; });
afterEach(async () => {
  await act(() => Promise.resolve(root?.unmount()));
  root = undefined;
  document.body.replaceChildren();
  await motion("no-preference");
});
afterAll(() => { environment.IS_REACT_ACT_ENVIRONMENT = previous; });

const nothing = () => {};

function RemovalConfirmation() {
  const [state, send] = useConfirmation();
  return (
    <div className="min-h-[200vh]">
      <ConfirmDialog state={state} onSend={send} title="Remove this project?" confirmLabel="Remove" reason="In flight." trigger={<Button>Remove project</Button>}>
        Its listing goes.
      </ConfirmDialog>
    </div>
  );
}

it('locks the page with external styles and keeps confirmation modal (spec/ui/confirmation.md, "Only an explicit confirm starts the work")', async () => {
  const host = await show(<RemovalConfirmation />);
  const trigger = host.querySelector("button")!;
  const dialog = () => document.querySelector('[role="alertdialog"]');
  const scroll = () => getComputedStyle(document.documentElement).overflowY;
  const before = { styles: document.head.querySelectorAll("style").length, scroll: scroll() };
  const keys = (input: string) => act(() => userEvent.keyboard(input));

  trigger.focus();
  await keys("{Enter}");
  await expect.poll(() => document.activeElement?.textContent).toBe("Cancel");
  expect(dialog()).not.toBeNull();
  expect(document.head.querySelectorAll("style")).toHaveLength(before.styles);
  expect(scroll()).toBe("hidden");

  await keys("{Tab}");
  await expect.poll(() => document.activeElement?.textContent).toBe("Remove");
  await keys("{Tab}");
  await expect.poll(() => document.activeElement?.textContent).toBe("Cancel");
  const backdrop = document.elementFromPoint(8, 8)!;
  expect(backdrop.getAttribute("aria-hidden")).toBe("true");
  await act(() => userEvent.click(backdrop, { position: { x: 8, y: 8 } }));
  expect(dialog()).not.toBeNull();

  await keys("{Escape}");
  await expect.poll(() => document.activeElement).toBe(trigger);
  expect(dialog()).toBeNull();
  expect(scroll()).toBe(before.scroll);
});

/** The primitive of each kind (spec/ui/index.md, "Each control kind has one primitive, and every component has stories"), as a page would show it. */
const samples: Record<ControlKind, ReactNode> = {
  Action: <Button size="sm">Save</Button>,
  Text: <Input aria-label="Name" />,
  LongText: <Textarea aria-label="Reason" />,
  Choice: <Select aria-label="Network"><option>Base</option></Select>,
  OneOf: <RadioGroup legend="Network" options={[{ value: "base", label: "Base" }]} />,
  ViewSwitch: <SegmentedControl aria-label="Period" options={[{ value: "month", label: "Month" }, { value: "year", label: "Year" }]} value="month" onValueChange={nothing} />,
  Toggle: <Switch aria-label="Email" />,
  Check: <Checkbox aria-label="Agree" />,
  FileChoice: <FileField aria-label="Project logo" onFiles={nothing} />,
  Paging: <Pagination state={{ page: 2, pages: 5 }} onSend={nothing} />,
  Reveal: <Disclosure summary="Earlier cycles">October</Disclosure>,
  CopyText: <CopyButton text="pnpm install" />,
  Confirm: (
    <ConfirmDialog state={{ phase: "Closed", confirmed: 0, completed: 0 }} onSend={nothing} title="Remove?" confirmLabel="Remove" reason="In flight."
      trigger={<Button variant="destructive">Remove project</Button>}>
      Its listing goes.
    </ConfirmDialog>
  ),
};
const kinds = Object.keys(samples) as ControlKind[];

/** The focusable controls under `host`; a hidden file input is reached and hit through the label that holds it. */
const controls = (host: Element) =>
  [...host.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea")]
    .filter((element) => element.getAttribute("aria-hidden") !== "true")
    .map((element) => (element.matches(".sr-only") ? element.closest("label")! : element));

/** The elements under `host` that transition or animate. */
const moving = (host: Element) =>
  [host, ...host.querySelectorAll("*")].filter((element) => {
    const style = getComputedStyle(element);
    const transitions = style.transitionProperty !== "none" && style.transitionDuration.split(",").some((duration) => parseFloat(duration) > 0);
    return style.animationName !== "none" || transitions;
  });

/** Every motion and focus, in an order that reaches each focus from another. */
const states: [Motion, Focus][] = [
  ["FullMotion", "KeyboardFocus"], ["FullMotion", "Unfocused"], ["FullMotion", "PointerFocus"],
  ["ReducedMotion", "PointerFocus"], ["ReducedMotion", "Unfocused"], ["ReducedMotion", "KeyboardFocus"],
];

// spec/ui/index.md, "A shown control stands still under reduced motion, and keyboard focus shows its ring"
it("shows each control kind as `moves` and `showsRing` say, in every motion and focus", async () => {
  for (const kind of kinds) {
    const host = await show(<>{samples[kind]}</>);
    const start = document.body.insertBefore(Object.assign(document.createElement("span"), { tabIndex: -1 }), host);
    const away = document.body.appendChild(Object.assign(document.createElement("p"), { textContent: "Away" }));
    const control = controls(host)[0];
    const unfocused = getComputedStyle(control).boxShadow;

    /** Brings the page to `shown`, then says what it shows. */
    const bring = async (shown: Shown) => {
      await motion(shown.motion === "ReducedMotion" ? "reduce" : "no-preference");
      (document.activeElement as HTMLElement | null)?.blur();
      if (shown.focus === "KeyboardFocus") { start.focus(); await userEvent.keyboard("{Tab}"); }
      // Pressed on the control and released away from it: focused by the pointer, and never activated.
      if (shown.focus === "PointerFocus") { await mouse("mousePressed", control); await mouse("mouseReleased", away); }
      const style = getComputedStyle(control);
      return { still: moving(host).length === 0, ring: style.boxShadow !== unfocused, outline: style.outlineStyle };
    };

    for (const [preferred, focus] of states) {
      const shown: Shown = { kind, motion: preferred, focus };
      const seen = await bring(shown);
      expect({ shown, ...seen }).toEqual({ shown, still: moves(shown) ? seen.still : true, ring: showsRing(shown), outline: "none" });
    }
  }
});

// spec/ui/index.md, "A shown control stands still under reduced motion, and keyboard focus shows its ring": the indicators that are not controls
it("stands the spinner, the skeleton and an unknown progress still under reduced motion, and moves them otherwise", async () => {
  const host = await show(<><Spinner /><Skeleton /><Progress aria-label="Upload" value={null} /></>);
  const indicators = () => [host.querySelector("svg")!, host.querySelector("[aria-hidden].h-4")!, host.querySelector("[role=progressbar] > div")!]
    .map((element) => getComputedStyle(element).animationName);
  expect(indicators().filter((name) => name === "none")).toEqual([]);
  await motion("reduce");
  expect(indicators()).toEqual(["none", "none", "none"]);
});

// spec/ui/index.md, "Buttons are 48px high, 40px small, fields 52px, and every control can be hit in a 44px square"
it("lays controls out at the heights the spec gives", async () => {
  const host = await show(<><Button size="sm">Small</Button><Button>Regular</Button><Input aria-label="Name" /><Select aria-label="Network"><option>Base</option></Select></>);
  const height = (selector: string) => host.querySelector(selector)!.getBoundingClientRect().height;
  const [small, regular] = [...host.querySelectorAll("button")].map((button) => button.getBoundingClientRect().height);
  expect([small, regular, height("input"), height("select")]).toEqual([heightPx("Small"), heightPx("Regular"), heightPx("Field"), heightPx("Field")]);
});

// spec/ui/index.md, "Buttons are 48px high, 40px small, fields 52px, and every control can be hit in a 44px square"
it("can hit every control anywhere in a 44px square centered on it", async () => {
  const others: Record<string, ReactNode> = {
    "the close button of a dialog": <Dialog open><DialogContent><DialogTitle>Settings</DialogTitle></DialogContent></Dialog>,
    "a tab of the navigation": <NavTabs label="Main"><NavTab href="/how-it-works">How It Works</NavTab></NavTabs>,
    "a sorting column header": <Table label="Points"><TableHeader><TableRow><TableHead onSort={nothing}>#</TableHead></TableRow></TableHeader></Table>,
    "a link of the footer": <SiteFooter><a href="mailto:hello@slop.cash">X</a></SiteFooter>,
    "a contributor's name": <Identity login="ab" href="/contributors/ab" />,
  };
  const missed: string[] = [];
  for (const [name, node] of [...kinds.map((kind) => [kind, samples[kind]] as const), ...Object.entries(others)]) {
    await show(<>{node}</>);
    for (const control of controls(document.body).filter((element) => !element.matches("[role=region]"))) {
      // Where around the control a pointer reaches it, every 2px: a box at least 44px each way, hit throughout.
      const box = control.getBoundingClientRect();
      const hits: (readonly [number, number])[] = [];
      for (let dx = -40; dx <= 40; dx += 2) for (let dy = -40; dy <= 40; dy += 2) {
        const [x, y] = [box.left + box.width / 2 + dx, box.top + box.height / 2 + dy];
        const hit = document.elementFromPoint(x, y);
        if (hit && control.contains(hit)) hits.push([x, y] as const);
      }
      const span = (axis: 0 | 1) => Math.max(...hits.map((hit) => hit[axis])) - Math.min(...hits.map((hit) => hit[axis])) + 2;
      const [width, height] = [Math.min(span(0), 82), Math.min(span(1), 82)];
      if (width < targetPx || height < targetPx || hits.length * 4 < width * height * 0.9) missed.push(`${name}: ${control.textContent || control.getAttribute("aria-label")} ${width}x${height}`);
    }
  }
  expect(missed).toEqual([]);
});
