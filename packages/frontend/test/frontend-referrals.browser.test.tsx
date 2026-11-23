import { Effect, Layer, ManagedRuntime } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { Route } from "../gen/app.ts";
import { type PageRuntime, pageServices } from "../src/app/runtime.vibe";
import { referralMessages } from "../src/flows/account/referral.vibe";
import { ReferralSection } from "../src/referrals/index.ts";
import { BrowserSession } from "../src/session/browserSession.vibe";

interface Account {
  readonly githubId: string;
  readonly login: string;
  code: string | null;
}

interface Posted {
  readonly code: unknown;
  readonly contentType: string | null;
  readonly actor: string | null;
}

const settingsRoute: Route = { kind: "Account", projectId: "", cycleId: "", login: "", owner: "", repo: "", number: "", caseId: "" };
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;
const opened: Array<{ root: Root; runtime: PageRuntime }> = [];

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeBackend(accounts: ReadonlyArray<Account>) {
  let current = accounts[0];
  let held: Promise<void> | undefined;
  let release: () => void = () => undefined;
  const posted: Posted[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path === "/api/v1/project-session") return json(200, { session: current === undefined ? null : { githubId: current.githubId, githubLogin: current.login, admin: false } });
    if (path === "/api/v1/points/me") {
      if (current === undefined) return json(401, { error: "unauthorized", message: "Sign in with GitHub" });
      return json(200, { actor: { id: `U_${current.login}`, login: current.login }, joinedAt: "2026-10-01T00:00:00Z", public: true, welcome: 5, socialPoints: 0, referralCode: current.code });
    }
    if (path === "/api/v1/referrals/code" && request.method === "POST") {
      const owner = current;
      const body = (await request.json()) as { code: unknown };
      const actor = request.headers.get("x-slop-expected-github-id");
      posted.push({ code: body.code, contentType: request.headers.get("content-type"), actor });
      const waiting = held;
      held = undefined;
      if (waiting !== undefined) await waiting;
      if (owner === undefined || actor !== owner.githubId) return json(403, { error: "actor_changed", message: "The signed-in account changed. Reload and try again." });
      if (body.code === "taken-name") return json(409, { error: "code_taken", message: "That name is taken. Choose another." });
      owner.code = String(body.code);
      return json(200, { code: owner.code });
    }
    return json(404, { error: "not_found", message: `No fake for ${request.method} ${path}` });
  };
  return {
    fetch,
    posted,
    signInAs: (account: Account) => {
      current = account;
    },
    holdNextSave: () => {
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    releaseSave: () => release(),
  };
}

type Backend = ReturnType<typeof fakeBackend>;

async function openSettings(backend: Backend) {
  const runtime: PageRuntime = ManagedRuntime.make(Layer.provideMerge(pageServices(settingsRoute), Layer.succeed(FetchHttpClient.Fetch, backend.fetch)));
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  opened.push({ root, runtime });
  await act(() => Promise.resolve(root.render(<ReferralSection runtime={runtime} />)));
  return runtime;
}

async function closeAll() {
  for (const { root, runtime } of opened.splice(0)) {
    await act(() => Promise.resolve(root.unmount()));
    await runtime.dispose();
  }
  document.body.replaceChildren();
}

const section = () => page.getByRole("region", { name: "Referral link", exact: true });
const nameBox = () => section().getByRole("textbox", { name: "Link name", exact: true });
const saveButton = () => section().getByRole("button", { name: "Save", exact: true });
const link = () => document.querySelector<HTMLElement>('#referral [role="group"]')?.textContent ?? null;
const alertText = () => document.querySelector<HTMLElement>('#referral [role="alert"]')?.textContent ?? null;
const savedShown = () => [...document.querySelectorAll<HTMLElement>('#referral [role="status"]')].some((node) => node.textContent === "Saved.");

beforeAll(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(closeAll);
afterAll(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

describe(`Edit and save the current account's referral name (spec/frontend/referralSettings.md, "Story: Edit and save the current account's referral name"; spec/frontend/referralSettings.md, "A loaded account owns the displayed link and the editable draft"; spec/frontend/referralSettings.md, "Exactly one request can act for each active account lifetime"; spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime")`, () => {
  it("a member names their referral link, sees refusals, and reads the saved link back after a reload", async () => {
    const member: Account = { githubId: "900000098", login: "link-test", code: null };
    const backend = fakeBackend([member]);
    await openSettings(backend);

    await expect.element(nameBox()).toHaveValue("");
    await expect.element(saveButton()).toBeDisabled();
    expect(link()).toBeNull();

    await userEvent.fill(nameBox(), "ab");
    await userEvent.click(saveButton());
    await expect.poll(alertText).toBe(referralMessages.rule);
    expect(backend.posted).toEqual([]);

    await userEvent.fill(nameBox(), "taken-name");
    await userEvent.click(saveButton());
    await expect.poll(alertText).toBe("That name is taken. Choose another.");
    await expect.element(nameBox()).toHaveValue("taken-name");
    expect(link()).toBeNull();

    await userEvent.fill(nameBox(), "DrewBuilds");
    await userEvent.keyboard("{Enter}");
    await expect.poll(savedShown).toBe(true);
    expect({ alert: alertText(), link: link() }).toEqual({ alert: null, link: `${location.origin}/referral/DrewBuilds` });
    await expect.element(saveButton()).toBeDisabled();
    expect(backend.posted).toEqual([
      { code: "taken-name", contentType: "application/json", actor: member.githubId },
      { code: "DrewBuilds", contentType: "application/json", actor: member.githubId },
    ]);

    await closeAll();
    await openSettings(backend);
    await expect.element(nameBox()).toHaveValue("DrewBuilds");
    expect(link()).toBe(`${location.origin}/referral/DrewBuilds`);
  });

  it("a refused save keeps the saved link, and a reply that lands after the account changed is dropped", async () => {
    const alice: Account = { githubId: "900000098", login: "link-test", code: "DrewBuilds" };
    const bob: Account = { githubId: "900000099", login: "other-test", code: "BobLink" };
    const backend = fakeBackend([alice, bob]);
    const runtime = await openSettings(backend);
    await expect.element(nameBox()).toHaveValue("DrewBuilds");

    await userEvent.fill(nameBox(), "taken-name");
    await userEvent.click(saveButton());
    await expect.poll(alertText).toBe("That name is taken. Choose another.");
    expect(link()).toBe(`${location.origin}/referral/DrewBuilds`);

    backend.holdNextSave();
    await userEvent.fill(nameBox(), "Bravo-2");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => backend.posted.length).toBe(2);
    await expect.element(nameBox()).toBeDisabled();

    backend.signInAs(bob);
    await runtime.runPromise(Effect.gen(function* () {
      const browser = yield* BrowserSession;
      yield* browser.observe("changed");
    }));
    await expect.element(nameBox()).toHaveValue("BobLink");
    expect(link()).toBe(`${location.origin}/referral/BobLink`);

    backend.releaseSave();
    await expect.poll(() => alice.code).toBe("Bravo-2");
    await expect.element(nameBox()).toHaveValue("BobLink");
    expect({ link: link(), saved: savedShown(), alert: alertText() }).toEqual({ link: `${location.origin}/referral/BobLink`, saved: false, alert: null });

    await userEvent.fill(nameBox(), "Bob-2");
    await userEvent.keyboard("{Enter}");
    await expect.poll(savedShown).toBe(true);
    expect({ link: link(), bob: bob.code, alice: alice.code, posted: backend.posted.map((sent) => [sent.code, sent.actor]) }).toEqual({
      link: `${location.origin}/referral/Bob-2`,
      bob: "Bob-2",
      alice: "Bravo-2",
      posted: [
        ["taken-name", alice.githubId],
        ["Bravo-2", alice.githubId],
        ["Bob-2", bob.githubId],
      ],
    });
  });
});
