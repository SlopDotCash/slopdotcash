// spec/ui/copy.md, "Story: Copy a value and know whether it worked"; "Copying starts from ready and reports the browser's answer"; "Success settles back to ready; failure stays until the next attempt"
import { createElement } from "react";
import type { Driver, Options } from "../../gen/ui__copy.conformance.ts";
import type { CopyStatus } from "../../gen/ui__copy.ts";
import { closeComponents, loadComponent, mount, type Page } from "./ui__confirmation.ts";
import type * as CopyingModule from "../../src/components/CopyButton.tsx";

type Copying = typeof CopyingModule;

const label = "Copy address";
const restAfter = 86_400_000;

const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
const resting = new Set<AbortController>();
Object.assign(AbortSignal, {
  timeout: (ms: number) => {
    if (ms !== restAfter) return originalTimeout(ms);
    const controller = new AbortController();
    resting.add(controller);
    return controller.signal;
  },
});

const elapse = () => {
  for (const controller of resting) {
    resting.delete(controller);
    controller.abort();
  }
};

let page: Page | undefined;
let write: ((written: boolean) => void) | undefined;

const clipboard = () =>
  new Promise<void>((resolve, reject) => {
    write = (written) => {
      write = undefined;
      if (written) resolve();
      else reject(new Error("The browser refused to write to the clipboard."));
    };
  });

const shown = (): CopyStatus => {
  const announced = page?.host.querySelector('[role="status"]')?.textContent ?? "";
  if (page?.host.querySelector("button")?.getAttribute("aria-busy") === "true") return "Copying";
  return announced === "" ? "Ready" : announced === "Copied" ? "Copied" : "CopyFailed";
};

export const driver: Driver<CopyStatus> & AsyncDisposable = {
  reset: async () => {
    await page?.close();
    write = undefined;
    resting.clear();
    const { CopyButton } = await loadComponent<Copying>("/src/components/CopyButton.tsx");
    page = await mount(() => createElement(CopyButton, { text: "0x5aFE0000000000000000000000000000000c0FFE", onCopy: clipboard, label, restAfter }));
  },
  dispatch: async (_key, event) => {
    const before = shown();
    if (page)
      switch (event.type) {
        case "copy":
          await page.press(label);
          break;
        case "answer":
          await page.settle(() => write?.(event.written));
          break;
        case "rest":
          await page.settle(elapse);
          break;
        default: {
          const _exhaustive: never = event;
          return _exhaustive;
        }
      }
    return shown() === before ? "refused" : "accepted";
  },
  observe: shown,
  [Symbol.asyncDispose]: async () => {
    await page?.close();
    await closeComponents();
  },
};

export const options: Options<CopyStatus> = { keys: ["value"], view: (copy) => copy.status };
