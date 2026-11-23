// spec/frontend/navigation.md, "Story: Resume an authorized destination after signing in"; spec/frontend/composition.md, "Sign-in keeps only a safe same-origin return destination"
import { expect } from "vitest";
import { commands } from "vitest/browser";
import { loginPath } from "../../../src/platform/environment.ts";
import type { Bucket, Diagnostics, InstallationSetup, Method, Op, Permission, RepositorySetup, Result, Role, Roles, Target, Upload, VaultPurpose, WalletSetup } from "./protocol.ts";

export const origin = "https://slop.cash";
const journeyMs = 30_000;

const ask = <O extends Op>(op: O): Promise<Result<O>> => commands.site(op);

export const named = (role: Role, name?: string, more: Omit<Target, "role" | "name"> = {}): Target => ({ role, ...(name === undefined ? {} : { name }), ...more });

export const site = {
  start: () => ask({ kind: "start" }),
  user: (id: number, login: string) => ask({ kind: "user", id, login }),
  deploy: (roles: Roles) => ask({ kind: "deploy", roles }),
  repository: (setup: RepositorySetup) => ask({ kind: "repository", setup }),
  permission: (repository: string, login: string, level: Permission) => ask({ kind: "permission", repository, login, level }),
  installation: (setup: InstallationSetup) => ask({ kind: "installation", setup }),
  githubFail: (path: string, status: number) => ask({ kind: "githubFail", path, status }),
  scanner: (method: Method, path: string, body: string) => ask({ kind: "scanner", method, path, body }),
  object: (bucket: Bucket, key: string, text: string) => ask({ kind: "object", bucket, key, text }),
  vault: ({ projectId, purpose = "ordinary" }: { readonly projectId: string; readonly purpose?: VaultPurpose }) => ask({ kind: "vault", projectId, purpose }),
  backendRpc: () => ask({ kind: "backendRpc" }),
  finalize: (chainId = 8453) => ask({ kind: "finalize", chainId }),
  branch: (repository: string, name: string, files: Readonly<Record<string, string | null>> = {}) => ask({ kind: "branch", repository, name, files }),
  github: (login: string) => ask({ kind: "github", login }),
  open: (path: string, tab?: string) => ask({ kind: "open", path, ...(tab === undefined ? {} : { tab }) }),
  tab: (tab: string) => ask({ kind: "tab", tab }),
  where: () => ask({ kind: "where" }),
  click: (target: Target) => ask({ kind: "click", target }),
  fill: (target: Target, value: string) => ask({ kind: "fill", target, value }),
  select: (target: Target, label: string) => ask({ kind: "select", target, label }),
  press: (keys: string) => ask({ kind: "press", keys }),
  read: (target: Target) => ask({ kind: "read", target }),
  focused: () => ask({ kind: "focused" }),
  refocus: () => ask({ kind: "refocus" }),
  blockCookies: () => ask({ kind: "blockCookies" }),
  upload: (target: Target, file: Upload) => ask({ kind: "upload", target, file }),
  fetch: (method: Method, path: string, body?: unknown) => ask({ kind: "fetch", method, path, ...(body === undefined ? {} : { body }) }),
  download: () => ask({ kind: "download" }),
  leaks: (text: string) => ask({ kind: "leaks", text }),
  hold: (method: string, path: string) => ask({ kind: "hold", method, path }),
  release: (method: string, path: string) => ask({ kind: "release", method, path }),
  fail: (method: string, path: string, status: number, body: unknown) => ask({ kind: "fail", method, path, status, body }),
  unfail: (method: string, path: string) => ask({ kind: "unfail", method, path }),
  serve: (path: string, status: number, body: unknown) => ask({ kind: "serve", path, status, body }),
  unserve: (path: string) => ask({ kind: "unserve", path }),
  clock: (iso: string) => ask({ kind: "clock", iso }),
  sent: () => ask({ kind: "sent" }),
  verifications: () => ask({ kind: "verifications" }),
  sql: (text: string, ...params: ReadonlyArray<string | number | null>) => ask({ kind: "sql", text, params }),
  popups: () => ask({ kind: "popups" }),
  view: (width: number, height: number, reducedMotion: boolean) => ask({ kind: "view", width, height, reducedMotion }),
  enlarge: (target: Target) => ask({ kind: "enlarge", target }),
  restore: () => ask({ kind: "restore" }),
  layout: () => ask({ kind: "layout" }),
  box: (target: Target) => ask({ kind: "box", target }),
  scrollY: () => ask({ kind: "scrollY" }),
  wheel: (dx: number, dy: number) => ask({ kind: "wheel", dx, dy }),
  allow: (...patterns: ReadonlyArray<string>) => ask({ kind: "allow", patterns }),
  diagnostics: (): Promise<Diagnostics> => ask({ kind: "diagnostics" }),
  wallets: (setup: WalletSetup) => ask({ kind: "wallets", setup }),
  walletAccount: (index: number) => ask({ kind: "walletAccount", index }),
  walletReject: () => ask({ kind: "walletReject" }),
  walletFail: (method: string) => ask({ kind: "walletFail", method }),
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
