// spec/frontend/navigation.md, "Story: Resume an authorized destination after signing in"; spec/frontend/composition.md, "Sign-in keeps only a safe same-origin return destination"
import { expect } from "vitest";
import { commands } from "vitest/browser";
import { loginPath } from "../../../src/platform/environment.ts";
import type { Diagnostics, Op, Result, Role, Target, Upload, WalletSetup } from "./protocol.ts";

export const origin = "https://slop.cash";
const journeyMs = 30_000;

const ask = <O extends Op>(op: O): Promise<Result<O>> => commands.site(op);

export const named = (role: Role, name?: string, more: Omit<Target, "role" | "name"> = {}): Target => ({ role, ...(name === undefined ? {} : { name }), ...more });

export const site = {
  start: () => ask({ kind: "start" }),
  user: (id: number, login: string) => ask({ kind: "user", id, login }),
  github: (login: string) => ask({ kind: "github", login }),
  open: (path: string, tab?: string) => ask({ kind: "open", path, ...(tab === undefined ? {} : { tab }) }),
  tab: (tab: string) => ask({ kind: "tab", tab }),
  where: () => ask({ kind: "where" }),
  click: (target: Target) => ask({ kind: "click", target }),
  fill: (target: Target, value: string) => ask({ kind: "fill", target, value }),
  press: (keys: string) => ask({ kind: "press", keys }),
  read: (target: Target) => ask({ kind: "read", target }),
  focused: () => ask({ kind: "focused" }),
  refocus: () => ask({ kind: "refocus" }),
  blockCookies: () => ask({ kind: "blockCookies" }),
  upload: (target: Target, file: Upload) => ask({ kind: "upload", target, file }),
  fetch: (method: "GET" | "POST", path: string, body?: unknown) => ask({ kind: "fetch", method, path, ...(body === undefined ? {} : { body }) }),
  leaks: (text: string) => ask({ kind: "leaks", text }),
  hold: (method: string, path: string) => ask({ kind: "hold", method, path }),
  release: (method: string, path: string) => ask({ kind: "release", method, path }),
  sent: () => ask({ kind: "sent" }),
  verifications: () => ask({ kind: "verifications" }),
  sql: (text: string, ...params: ReadonlyArray<string | number | null>) => ask({ kind: "sql", text, params }),
  popups: () => ask({ kind: "popups" }),
  view: (width: number, height: number, reducedMotion: boolean) => ask({ kind: "view", width, height, reducedMotion }),
  enlarge: (target: Target) => ask({ kind: "enlarge", target }),
  restore: () => ask({ kind: "restore" }),
  layout: () => ask({ kind: "layout" }),
  allow: (...patterns: ReadonlyArray<string>) => ask({ kind: "allow", patterns }),
  diagnostics: (): Promise<Diagnostics> => ask({ kind: "diagnostics" }),
  wallets: (setup: WalletSetup) => ask({ kind: "wallets", setup }),
  walletAccount: (index: number) => ask({ kind: "walletAccount", index }),
  walletReject: () => ask({ kind: "walletReject" }),
  walletAsked: () => ask({ kind: "walletAsked" }),
  walletAddresses: () => ask({ kind: "walletAddresses" }),
};

export const shown = (target: Target) => expect.poll(() => site.read(target), { timeout: journeyMs });

export const at = (path: string) => expect.poll(() => site.where(), { timeout: journeyMs }).toBe(`${origin}${path}`);

export async function signIn(login: string, next: string, tab?: string) {
  await site.github(login);
  await site.open(loginPath(next), tab);
  await shown(named("heading", "Log in", { level: 1 })).toMatchObject({ visible: true });
  await site.click(named("button", "Continue with GitHub"));
  await at(next);
  await shown(named("button", login, { exact: false })).toMatchObject({ visible: true });
}

export async function signOut(login: string) {
  await site.click(named("button", login, { exact: false }));
  await site.click(named("menuitem", "Sign out"));
  await shown(named("link", "Log in")).toMatchObject({ visible: true });
}

export async function tabTo(name: string, limit = 60) {
  for (let step = 0; step < limit; step += 1) {
    if ((await site.focused()).name === name) return;
    await site.press("Tab");
  }
  expect((await site.focused()).name).toBe(name);
}

export async function accessible() {
  const layout = await site.layout();
  expect({ mains: layout.mains, headings: layout.headings, unnamed: layout.unnamed, overflowX: layout.overflowX, clipped: layout.clipped }).toEqual({ mains: 1, headings: 1, unnamed: [], overflowX: false, clipped: [] });
}
