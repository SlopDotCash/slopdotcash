import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { initial, type RequestedPage } from "../../../gen/frontend__requestedRepos.ts";
import { sessions } from "../../fixtures.ts";
import type { RequestedView } from "./flow.vibe";
import type { RequestedReposProps } from "./RequestedRepos.tsx";

const onAct = fn();
const onSignedOutFlag = fn();
const signedOut: RequestedPage = { ...initial, lifetime: 2 };
const signedIn: RequestedPage = { ...signedOut, actor: "583231" };
const ready = (page: RequestedPage): RequestedPage => ({ ...page, board: "BoardReady", loading: false });
const repos = [
  { repo: "vitejs/vite", count: 3, newestAt: "2026-11-20T09:00:00.000Z" },
  { repo: "honojs/hono", count: 1, newestAt: "2026-11-18T14:30:00.000Z" },
];
const board = { repos, mine: null };
const mine = {
  repos,
  mine: [
    { repo: "vitejs/vite", expiresAt: "2027-02-18T09:00:00.000Z", listedAs: null },
    { repo: "slop-cash/slop", expiresAt: "2027-02-01T09:00:00.000Z", listedAs: "slop" },
  ],
};
const shown = (page: RequestedPage, change: Partial<RequestedView> = {}): RequestedView => ({ page, board: undefined, done: undefined, problem: undefined, viewer: undefined, ...change });

export const meta: ComponentMeta<RequestedReposProps> = {
  args: {
    view: shown(ready(signedOut), { board }),
    origin: "https://slop.cash",
    flag: null,
    session: sessions.signedOut,
    signInHref: "/login?next=%2Frequested",
    onAct,
    onRetry: fn(),
    onSignedOutFlag,
    onCopy: () => Promise.resolve(),
  },
  examples: {
    Loading: { view: shown(signedOut) },
    Failed: { view: shown({ ...signedOut, board: "BoardFailed", loading: false }) },
    Empty: { view: shown(ready(signedOut), { board: { repos: [], mine: null } }) },
    SignedOutFlag: { flag: "vitejs/vite", signInHref: "/login?next=%2Frequested%3Fflag%3Dvitejs%252Fvite" },
    InvalidFlag: { flag: "not a repo" },
    SignedInFlags: { view: shown(ready(signedIn), { board: mine, viewer: { login: "octocat", referralCode: "DrewBuilds" } }), session: sessions.member },
    SignedInConfirm: { view: shown(ready(signedIn), { board: mine }), session: sessions.member, flag: "honojs/hono" },
    Saving: { view: shown({ ...ready(signedIn), pending: 2 }, { board: mine }), session: sessions.member },
    Refused: {
      view: shown({ ...ready(signedIn), notice: "ActRefused" }, { board: mine, problem: "Only members with merged work on Slop can flag a repo." }),
      session: sessions.member,
    },
  },
  play: {
    // spec/frontend/requestedRepos.md, "Story: See requested repos, flag one, renew or withdraw it"
    Default: async () => {
      onSignedOutFlag.mockClear();
      await expect(screen.getByRole("button", { name: "Copy pitch for vitejs/vite" })).toBeEnabled();
      await userEvent.type(screen.getByRole("textbox", { name: "Repository" }), "https://github.com/vitejs/vite.git{Enter}");
      await expect(onSignedOutFlag).toHaveBeenCalledWith("vitejs/vite");
      await expect(screen.queryByRole("heading", { name: "Your flags" })).toBeNull();
    },
    // spec/frontend/requestedRepos.md, "A board read keeps a ready board on screen and a failed one offers Try again"
    Failed: async () => {
      await expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    },
    // spec/frontend/requestedRepos.md, "Story: See requested repos, flag one, renew or withdraw it"
    SignedOutFlag: async () => {
      await expect(screen.getByRole("link", { name: "Sign in with GitHub" }).getAttribute("href")).toBe("/login?next=%2Frequested%3Fflag%3Dvitejs%252Fvite");
    },
    // spec/frontend/requestedRepos.md, "One flag, renew or withdraw is in flight per lifetime, a success reloads the board and a refusal changes nothing else"
    SignedInFlags: async () => {
      onAct.mockClear();
      await expect(screen.queryByRole("button", { name: "Renew slop-cash/slop" })).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "Withdraw vitejs/vite" }));
      await expect(onAct).toHaveBeenCalledWith("vitejs/vite", "withdraw");
    },
    // spec/frontend/requestedRepos.md, "One flag, renew or withdraw is in flight per lifetime, a success reloads the board and a refusal changes nothing else"
    Saving: async () => {
      await expect([screen.getByRole("button", { name: "Renew vitejs/vite" }), screen.getByRole("button", { name: "Withdraw vitejs/vite" })].every((button) => button.hasAttribute("disabled"))).toBe(true);
    },
  },
};
