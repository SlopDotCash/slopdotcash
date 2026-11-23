import "../src/main.css";
import { NotFoundHead } from "@repo/frontend/app";
import type { RegistryBoot } from "@repo/frontend/reads/registry";
import { NotFound } from "@repo/ui";
import { ManagedRuntime } from "effect";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { Machine } from "../gen/app.effect.vibe";
import { App, type AppProps } from "../src/App.tsx";
import { openingOf, pathTo } from "../src/address.ts";
import { opened, routes } from "../src/routes.vibe";

const mounted: { root: Root; runtime: ManagedRuntime.ManagedRuntime<Machine, unknown> }[] = [];
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;

const boot: RegistryBoot = { freshness: { tag: "RegistryCurrent" }, projects: [{ id: "slop", name: "slop", slug: "slop" }], error: undefined };

const unknownContributor: NonNullable<AppProps["content"]> = (route, frame) =>
  route.kind === "Profile" ? <NotFound title={`@${route.login} not found`}><NotFoundHead /></NotFound> : frame();

async function load(path: string, { search = "", hash = "", hostname = "slop.cash", content }: { search?: string; hash?: string; hostname?: string; content?: AppProps["content"] } = {}) {
  for (const { root } of mounted) await act(() => Promise.resolve(root.unmount()));
  const runtime = ManagedRuntime.make(routes);
  await runtime.runPromise(opened(openingOf(path, search, hash)));
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  mounted.push({ root, runtime });
  await act(() => Promise.resolve(root.render(<App runtime={runtime} hostname={hostname} content={content} registry={(render) => render(boot)} />)));
}

beforeAll(() => { environment.IS_REACT_ACT_ENVIRONMENT = true; document.documentElement.className = "dark"; });
afterEach(async () => {
  for (const { root, runtime } of mounted.splice(0)) { await act(() => Promise.resolve(root.unmount())); await runtime.dispose(); }
  document.body.replaceChildren();
});
afterAll(() => { environment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment; });

const heading = () => page.getByRole("heading", { level: 1 });
const canonical = () => document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
const robots = () => document.head.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content;
const head = () => [document.title, canonical(), robots()];

it('Open a page by its address, an old one included, and one that names nothing (spec/app/index.md, "Story: Open a page by its address")', async () => {
  // spec/app/index.md, "A route carries exactly the identifiers its page needs"
  await load(pathTo(["projects", "slop", "security"]));
  await expect.element(heading()).toHaveTextContent("slop security bounty");
  expect(document.querySelectorAll("main")).toHaveLength(1);
  await expect.poll(head).toEqual(["slop security bounty · Slop", "https://slop.cash/projects/slop/security", undefined]);
  await load("/fee/octocat/slop/7");
  await expect.element(heading()).toHaveTextContent("Submission fee");
  await expect.poll(head).toEqual(["Submission fee · Slop", undefined, "noindex"]);
  await load("/fee/report/sc_abcdefgh");
  await expect.element(heading()).toHaveTextContent("Report deposit");
  await expect.poll(head).toEqual(["Report deposit · Slop", undefined, "noindex"]);

  // spec/app/index.md, "An old address opens the page that replaced it"
  await load("/wallet");
  await expect.element(heading()).toHaveTextContent("Settings");
  await expect.poll(() => [document.title, canonical()]).toEqual(["Account · Slop", "https://slop.cash/account"]);
  await load("/projects/slop/manage/", { hash: "#security-settings" });
  await expect.element(heading()).toHaveTextContent("slop security bounty");

  // spec/app/index.md, "The shell shows one route, opened from the address"
  await load("/points", { search: "?x=1" });
  await expect.element(heading()).toHaveTextContent("Settings");
  await load("/points");
  await expect.element(heading()).toHaveTextContent("Contributors");

  // spec/app/index.md, "Each address names exactly one route kind, and an address that names none is unknown"
  await load("/projects/slop/unknown-section");
  await expect.element(heading()).toHaveTextContent("Page not found");
  await expect.poll(head).toEqual(["Page not found · Slop", undefined, "noindex"]);
  await expect.element(page.getByRole("link", { name: "See open projects" })).toHaveAttribute("href", "/");
  await load("/projects/%E0%A4%A");
  await expect.element(heading()).toHaveTextContent("Page not found");
  // spec/frontend/routes.md, "Each route has one title, canonical and index policy, and private routes never name a private identifier"
  await load("/contributors/ghost", { content: unknownContributor });
  await expect.element(heading()).toHaveTextContent("@ghost not found");
  await expect.poll(head).toEqual(["ghost · Slop", undefined, "noindex"]);

  // spec/frontend/presentation.md, "The wordmark and footer domain follow the serving host"
  await load("/how-it-works", { hostname: "www.slop.tech." });
  await expect.element(page.getByRole("link", { name: "Slop home" })).toHaveTextContent("slop.tech");
  await userEvent.keyboard("{Tab}");
  await expect.poll(() => document.activeElement?.getAttribute("aria-label")).toBe("Slop home");
  expect(getComputedStyle(document.activeElement!).boxShadow).not.toBe("none");
  await userEvent.keyboard("{Tab}");
  await expect.poll(() => document.activeElement?.textContent).toBe("How It Works");
  await userEvent.keyboard("{Tab}");
  await expect.poll(() => document.activeElement?.textContent).toBe("Log in");
});
