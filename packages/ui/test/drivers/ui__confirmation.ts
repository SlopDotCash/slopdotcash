// spec/ui/confirmation.md, "Story: Confirm an irreversible step"; "Only an explicit confirm starts the work"; "The work's answer closes the dialog or keeps it open with the reason"
import path from "node:path";
import { act, createElement, type FunctionComponent } from "react";
import { createRoot } from "react-dom/client";
import { createServer } from "vite";
import { builtinEnvironments } from "vitest/runtime";
import type { Driver, Options } from "../../gen/ui__confirmation.conformance.ts";
import type { Event, Phase } from "../../gen/ui__confirmation.ts";

await builtinEnvironments["happy-dom"].setup(globalThis, {});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const components = await createServer({
  configFile: false,
  root: path.join(import.meta.dirname, "../.."),
  logLevel: "silent",
  appType: "custom",
  server: { middlewareMode: true, hmr: false, ws: false },
});

export const loadComponent = <Module>(file: string) => components.ssrLoadModule(file) as Promise<Module>;

export const closeComponents = () => components.close();

export type Page = {
  host: HTMLElement;
  settle: (work: () => unknown) => Promise<void>;
  press: (name: string) => Promise<void>;
  close: () => Promise<void>;
};

const reachable = (name: string) =>
  [...document.querySelectorAll("button")].find((button) => (button.getAttribute("aria-label") ?? button.textContent) === name && !button.closest('[aria-hidden="true"]'));

export async function mount(view: FunctionComponent): Promise<Page> {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const settle = (work: () => unknown) =>
    act(async () => {
      await work();
      await new Promise((resolve) => setImmediate(resolve));
    });
  await settle(() => root.render(createElement(view)));
  return {
    host,
    settle,
    press: (name) => settle(() => reachable(name)?.click()),
    close: async () => {
      await settle(() => root.unmount());
      host.remove();
    },
  };
}

type Dialog = typeof import("../../src/components/ConfirmDialog.tsx");
type Buttons = typeof import("../../src/components/Button.tsx");

const labels = { open: "Delete", confirm: "Delete project", cancel: "Cancel" } as const;
const reason = "The project could not be deleted.";

let page: Page | undefined;
let answer: ((succeeded: boolean) => void) | undefined;

async function owner(): Promise<FunctionComponent> {
  const [{ ConfirmDialog, useConfirmation }, { Button }] = await Promise.all([
    loadComponent<Dialog>("/src/components/ConfirmDialog.tsx"),
    loadComponent<Buttons>("/src/components/Button.tsx"),
  ]);
  return function Owner() {
    const [state, send] = useConfirmation();
    const onSend = (event: Event) => {
      send(event);
      if (event.type === "confirm")
        answer = (succeeded) => {
          answer = undefined;
          send({ type: "finish", succeeded });
        };
    };
    return createElement(ConfirmDialog, {
      state,
      onSend,
      title: "Delete this project?",
      children: "Its page and installation are removed.",
      confirmLabel: labels.confirm,
      cancelLabel: labels.cancel,
      destructive: true,
      reason,
      trigger: createElement(Button, { variant: "destructive" }, labels.open),
    });
  };
}

const shown = (): Phase => {
  const dialog = document.querySelector('[role="alertdialog"]');
  if (!dialog) return "Closed";
  const confirm = [...dialog.querySelectorAll("button")].find((button) => button.textContent?.includes(labels.confirm));
  if (confirm?.getAttribute("aria-busy") === "true") return "Working";
  if ([...dialog.querySelectorAll('[role="alert"]')].some((alert) => alert.textContent === reason)) return "Refused";
  return "Asking";
};

export const driver: Driver<Phase> & AsyncDisposable = {
  reset: async () => {
    await page?.close();
    answer = undefined;
    page = await mount(await owner());
  },
  dispatch: async (_key, event) => {
    const before = shown();
    if (page) await (event.type === "finish" ? page.settle(() => answer?.(event.succeeded)) : page.press(labels[event.type]));
    return shown() === before ? "refused" : "accepted";
  },
  observe: shown,
  [Symbol.asyncDispose]: async () => {
    await page?.close();
    await closeComponents();
  },
};

export const options: Options<Phase> = { keys: ["dialog"], view: (confirmation) => confirmation.phase };
