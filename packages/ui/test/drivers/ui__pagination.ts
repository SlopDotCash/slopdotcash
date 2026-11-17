// spec/ui/pagination.md, "Story: Move through pages without leaving the list"; "The page stays within the pages that exist"
import { createElement, type FunctionComponent } from "react";
import type { Driver, Options } from "../../gen/ui__pagination.conformance.ts";
import type { Event, Pages } from "../../gen/ui__pagination.ts";
import { closeComponents, loadComponent, mount, type Page } from "./ui__confirmation.ts";

type Paging = typeof import("../../src/components/Pagination.tsx");

const labels = { back: "Previous page", forward: "Next page" } as const;
const label = "Projects";

let page: Page | undefined;
let held: Pages;
let resize: ((event: Event) => void) | undefined;

async function list(): Promise<FunctionComponent> {
  const { Pagination, usePagination } = await loadComponent<Paging>("/src/components/Pagination.tsx");
  return function List() {
    const [state, send] = usePagination();
    held = state;
    resize = send;
    return createElement(Pagination, { state, onSend: send, label, backLabel: labels.back, forwardLabel: labels.forward });
  };
}

const shown = (): Pages => {
  const nav = page?.host.querySelector(`nav[aria-label="${label}"]`);
  if (!nav) return { page: 1, pages: 1 };
  const read = nav.querySelector('[role="status"] > span:not([aria-hidden])')?.textContent ?? "";
  const counted = /^Page (\d+) of (\d+)$/.exec(read);
  if (!counted) throw new Error(`The pagination shows "${read}" where it reads "Page x of y".`);
  return { page: Number(counted[1]), pages: Number(counted[2]) };
};

const same = (a: Pages, b: Pages) => a.page === b.page && a.pages === b.pages;

export const driver: Driver & AsyncDisposable = {
  reset: async () => {
    await page?.close();
    page = await mount(await list());
  },
  dispatch: async (_key, event) => {
    if (event.type === "resize") {
      const before = held;
      await page?.settle(() => resize?.(event));
      return held === before ? "refused" : "accepted";
    }
    const before = shown();
    await page?.press(labels[event.type]);
    return same(shown(), before) ? "refused" : "accepted";
  },
  observe: shown,
  [Symbol.asyncDispose]: async () => {
    await page?.close();
    await closeComponents();
  },
};

export const options: Options = { keys: ["list"] };
