import "../src/main.css";
import { ManagedRuntime } from "effect";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { Machine } from "../gen/app.effect.vibe";
import { App } from "../src/App.tsx";
import { pathTo } from "../src/address.ts";
import { routes } from "../src/routes.vibe";

const opened: { root: Root; runtime: ManagedRuntime.ManagedRuntime<Machine, unknown> }[] = [];
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;

/** The page loaded at `path`, `search` and `hash` from `hostname`, as main.tsx loads it. */
async function load(path: string, search = "", hash = "", hostname = "slop.cash") {
  for (const { root } of opened) await act(() => Promise.resolve(root.unmount()));
  const runtime = ManagedRuntime.make(routes);
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  opened.push({ root, runtime });
  await act(() => Promise.resolve(root.render(<App runtime={runtime} path={path} search={search} hash={hash} hostname={hostname} />)));
}

beforeAll(() => { environment.IS_REACT_ACT_ENVIRONMENT = true; document.documentElement.className = "dark"; });
afterEach(async () => {
  for (const { root, runtime } of opened.splice(0)) { await act(() => Promise.resolve(root.unmount())); await runtime.dispose(); }
  document.body.replaceChildren();
});
afterAll(() => { environment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment; });

const heading = () => page.getByRole("heading", { level: 1 });
const canonical = () => document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
const robots = () => document.head.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content;

// spec/app/index.md, "Story: Open a page by its address"
// Each page is one main landmark with one heading between the header and the footer; an address that names nothing
// offers the way back, and the header's links are reached from the keyboard in reading order.
it("Open a page by its address, an old one included, and one that names nothing", async () => {
  // spec/app/index.md, "A route carries exactly the identifiers its page needs"
  await load(pathTo(["projects", "slop", "security"]));
  await expect.element(heading()).toHaveTextContent("slop security bounty");
  expect(document.querySelectorAll("main")).toHaveLength(1);
  await expect.poll(() => [document.title, canonical(), robots()]).toEqual(["slop security bounty · Slop", "https://slop.cash/projects/slop/security", undefined]);

  // spec/app/index.md, "An old address opens the page that replaced it"
  await load("/wallet");
  await expect.element(heading()).toHaveTextContent("Settings");
  await expect.poll(() => [document.title, canonical()]).toEqual(["Account · Slop", "https://slop.cash/account"]);
  await load("/projects/slop/manage/", "", "#security-settings");
  await expect.element(heading()).toHaveTextContent("slop security bounty");

  // spec/app/index.md, "The shell shows one route, opened from the address"
  await load("/points", "?x=1");
  await expect.element(heading()).toHaveTextContent("Settings");
  await load("/points");
  await expect.element(heading()).toHaveTextContent("Leaderboard");

  // spec/app/index.md, "Each address names exactly one route kind, and an address that names none is unknown"
  await load("/projects/slop/unknown-section");
  await expect.element(heading()).toHaveTextContent("Page not found");
  await expect.poll(() => [document.title, canonical(), robots()]).toEqual(["Page not found · Slop", undefined, "noindex"]);
  await expect.element(page.getByRole("link", { name: "See open projects" })).toHaveAttribute("href", "/");
  await load("/projects/%E0%A4%A");
  await expect.element(heading()).toHaveTextContent("Page not found");

  await load("/how-it-works", "", "", "www.slop.tech.");
  await expect.element(page.getByRole("link", { name: "Slop home" })).toHaveTextContent("slop.tech");
  await expect.element(page.getByRole("link", { name: "How It Works" })).toHaveAttribute("aria-current", "page");
  await userEvent.keyboard("{Tab}");
  await expect.poll(() => document.activeElement?.getAttribute("aria-label")).toBe("Slop home");
  expect(getComputedStyle(document.activeElement!).boxShadow).not.toBe("none");
  await userEvent.keyboard("{Tab}");
  await expect.poll(() => document.activeElement?.textContent).toBe("How It Works");
  await userEvent.keyboard("{Tab}");
  await expect.poll(() => document.activeElement?.textContent).toBe("Log in");
});
