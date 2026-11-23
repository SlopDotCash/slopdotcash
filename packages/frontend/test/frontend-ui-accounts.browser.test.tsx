import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loginPath } from "../src/platform/environment.ts";
import { accessible, at, named, origin, shown, signIn, signOut, site, tabTo } from "./support/ui/browser.ts";

const users = {
  ada: { id: 1001, login: "octo-ada" },
  lin: { id: 1002, login: "octo-lin" },
  mae: { id: 1003, login: "octo-mae" },
  ivy: { id: 1004, login: "octo-ivy" },
  joe: { id: 1005, login: "octo-joe" },
  kai: { id: 1006, login: "octo-kai" },
  lea: { id: 1007, login: "octo-lea" },
  root: { id: 9001, login: "octo-root" },
} as const;

const signInLink = named("link", "Sign in with GitHub");
const evmCard = named("article", "EVM wallet");
const solanaCard = named("article", "Solana wallet");
const membersOf = (githubId: number) => site.sql("SELECT actor_id, public, closed_at FROM points_members WHERE github_id = ?", String(githubId));
const sessionsOf = (actorId: unknown) => site.sql("SELECT count(*) AS sessions FROM points_sessions WHERE actor_id = ?", String(actorId));

beforeEach(async () => {
  await site.start();
  for (const user of Object.values(users)) await site.user(user.id, user.login);
});

afterEach(async () => {
  expect(await site.popups()).toBe(0);
  expect(await site.diagnostics()).toEqual({ console: [], failed: [] });
});

describe('Resume an authorized destination after signing in (spec/frontend/navigation.md, "Story: Resume an authorized destination after signing in"; spec/backend/accounts.md, "Story: Sign in with GitHub and keep one immutable account")', () => {
  it('a signed-out private destination keeps its URL, reads nothing private and returns there after GitHub sign-in (spec/frontend/navigation.md, "A signed-out private destination keeps its URL and shows sign-in in place with private reads disabled"; spec/frontend/composition.md, "Sign-in keeps only a safe same-origin return destination"; spec/backend/accounts.md, "A web sign-in consumes one web assertion and opens a public membership")', async () => {
    expect((await site.open("/earnings")).status).toBe(200);
    await shown(signInLink).toMatchObject({ visible: true, href: loginPath("/earnings") });
    await shown(named("link", "Log in")).toMatchObject({ href: loginPath("/earnings") });
    await at("/earnings");
    expect((await site.sent()).filter((sent) => sent.path.startsWith("/api/v1/payments/"))).toEqual([]);

    await site.github(users.ada.login);
    await site.click(signInLink);
    await at(loginPath("/earnings"));
    await site.click(named("button", "Continue with GitHub"));
    await at("/earnings");
    await shown(named("heading", "Payouts", { level: 1 })).toMatchObject({ visible: true });
    await shown({ text: "No awards yet" }).toMatchObject({ visible: true });
    const [member] = await membersOf(users.ada.id);
    expect(member).toMatchObject({ closed_at: null });

    await signOut(users.ada.login);
    await signIn(users.ada.login, "/account#wallets");
    expect(await membersOf(users.ada.id)).toEqual([member]);
  });

  it('a return destination off this origin is never followed (spec/frontend/composition.md, "Sign-in keeps only a safe same-origin return destination")', async () => {
    await site.github(users.ada.login);
    await site.open(`/login?next=${encodeURIComponent("https://example.org/account")}`);
    await site.click(named("button", "Continue with GitHub"));
    await expect.poll(async () => new URL(await site.where()).pathname, { timeout: 30_000 }).not.toBe("/login");
    expect(new URL(await site.where()).origin).toBe(origin);
  });
});

describe('Close and reopen an account without losing history (spec/backend/accounts.md, "Story: Close and reopen an account without losing history")', () => {
  it('a closed account signs out everywhere and only an explicit reopen signs it in again (spec/backend/accounts.md, "Confirmed closure ends every session, hides the membership, disconnects X and withdraws both email consents"; spec/backend/accounts.md, "An ordinary sign-in cannot reopen a closed account; explicit reopening can")', async () => {
    await site.allow("^console Failed to load resource: the server responded with a status of 40[19]", "^409 POST /api/v1/points/join$", "^401 GET /api/v1/payments/me$");
    await signIn(users.lin.login, "/account");
    await shown(named("form", "Close account")).toMatchObject({ count: 0 });
    const [before] = await membersOf(users.lin.id);
    expect(before).toMatchObject({ public: 1, closed_at: null });

    const closed = await site.fetch("POST", "/api/v1/points/account/close", { login: users.lin.login });
    expect(closed).toMatchObject({ status: 200, body: { closed: true } });
    expect(await membersOf(users.lin.id)).toEqual([{ actor_id: before?.actor_id, public: 0, closed_at: expect.any(String) }]);
    expect(await sessionsOf(before?.actor_id)).toEqual([{ sessions: 0 }]);
    expect(await site.fetch("GET", "/api/v1/payments/me")).toMatchObject({ status: 401 });

    await site.refocus();
    await shown(named("link", "Log in")).toMatchObject({ visible: true });
    await shown(signInLink).toMatchObject({ visible: true });

    await site.github(users.lin.login);
    await site.open(loginPath("/account"));
    await site.click(named("button", "Continue with GitHub"));
    await shown(named("button", "Reopen account")).toMatchObject({ visible: true, disabled: false });
    await shown(named("button", "Continue with GitHub")).toMatchObject({ count: 0 });
    expect(await membersOf(users.lin.id)).toEqual([{ actor_id: before?.actor_id, public: 0, closed_at: expect.any(String) }]);

    await site.click(named("button", "Reopen account"));
    await at("/account");
    await shown(named("heading", "Settings", { level: 1 })).toMatchObject({ visible: true });
    expect(await membersOf(users.lin.id)).toEqual([{ actor_id: before?.actor_id, public: 1, closed_at: null }]);
  });
});

describe('Keep mail consent tied to the signed-in account (spec/backend/accounts.md, "Story: Keep mail consent tied to the signed-in account"; spec/frontend/presentation.md, "Story: Find account controls on their existing separate pages")', () => {
  it('a same-account focus check keeps the draft editable while Verify waits, and the verify link applies the requested consent once (spec/frontend/navigation.md, "An identity refresh applies only within the navigation lifetime that requested it"; spec/backend/email.md, "Verification is account-bound, single-use, unexpired and applies the consent requested with it"; spec/frontend/emailAction.md, "An email verify or unsubscribe token survives sign-in and is applied once to the signed-in account"; spec/frontend/presentation.md, "Settings keeps wallet and email controls expanded without account navigation tabs")', async () => {
    const email = "octo-mae@example.test";
    const field = named("textbox", "Email address");
    const verify = named("button", "Verify");
    await signIn(users.mae.login, "/account#notifications");
    await shown(named("region", "Wallets")).toMatchObject({ visible: true });
    await shown(named("region", "Email preferences")).toMatchObject({ visible: true });
    await site.fill(field, email);
    await site.click(named("checkbox", "Activity"));

    await site.hold("GET", "/api/v1/project-session");
    await site.refocus();
    await shown(verify).toMatchObject({ disabled: true });
    await shown(field).toMatchObject({ disabled: false, value: email });
    await site.release("GET", "/api/v1/project-session");
    await shown(verify).toMatchObject({ disabled: false });
    await shown(field).toMatchObject({ value: email });

    await site.click(verify);
    await expect.poll(async () => (await site.verifications()).filter((sent) => sent.githubId === String(users.mae.id)).length, { timeout: 30_000 }).toBe(1);
    await shown(named("region", "Email preferences")).toMatchObject({ text: expect.stringContaining(email) });
    const [sent] = (await site.verifications()).filter((each) => each.githubId === String(users.mae.id));

    await site.open(`/account#verify-email=${sent?.token ?? ""}`);
    await shown(named("switch", "Activity")).toMatchObject({ checked: true, disabled: false });
    await expect.poll(() => site.sql("SELECT enabled FROM notification_email_preferences WHERE github_id = ?", String(users.mae.id))).toEqual([{ enabled: 1 }]);

    await site.click(named("switch", "Activity"));
    await shown(named("switch", "Activity")).toMatchObject({ checked: false });
    await expect.poll(() => site.sql("SELECT enabled FROM notification_email_preferences WHERE github_id = ?", String(users.mae.id))).toEqual([{ enabled: 0 }]);
  });
});

describe('Change accounts without disclosing the prior account\'s draft (spec/frontend/composition.md, "Story: Change accounts without disclosing the prior account\'s draft")', () => {
  it('after another account signs in elsewhere, the returning tab shows and sends nothing of the previous account (spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"; spec/backend/accounts.md, "Sign-out ends only the caller\'s session and revocation never reaches another account")', async () => {
    const draft = "octo-ivy-private@example.test";
    await site.allow("^console Failed to load resource: the server responded with a status of 40[13]", "^40[13] (GET|POST) /api/v1/");
    await signIn(users.ivy.login, "/account#notifications");
    await site.fill(named("textbox", "Email address"), draft);

    await site.open("/account", "other");
    await signOut(users.ivy.login);
    await signIn(users.joe.login, "/account", "other");

    await site.tab("main");
    const mark = (await site.sent()).length;
    await site.refocus();
    await shown(named("button", users.joe.login, { exact: false })).toMatchObject({ visible: true });
    await expect.poll(() => site.leaks(draft), { timeout: 30_000 }).toBe(false);
    expect(await site.leaks(users.ivy.login)).toBe(false);
    expect((await site.sent()).slice(mark).filter((sent) => sent.actor === String(users.ivy.id))).toEqual([]);
  });
});

describe('An identity refresh applies only within the navigation lifetime that requested it (spec/frontend/navigation.md, "An identity refresh applies only within the navigation lifetime that requested it")', () => {
  it('an admin view closes when a tab return finds no account, and a focus answer older than a sign-out cannot reopen it (spec/frontend/navigation.md, "A signed-out private destination keeps its URL and shows sign-in in place with private reads disabled")', async () => {
    await site.allow("^console Failed to load resource: the server responded with a status of 40[13]", "^40[13] (GET|POST) /api/v1/");
    const admin = named("heading", "Admin", { level: 1 });
    await signIn(users.root.login, "/admin");
    await shown(admin).toMatchObject({ visible: true });

    await site.open("/account", "other");
    await signOut(users.root.login);
    await site.tab("main");
    await site.refocus();
    await shown(signInLink).toMatchObject({ visible: true });
    await shown(admin).toMatchObject({ count: 0 });
    await at("/admin");

    await signIn(users.root.login, "/admin");
    await shown(admin).toMatchObject({ visible: true });
    await site.hold("GET", "/api/v1/project-session");
    await site.refocus();
    await signOut(users.root.login);
    await site.release("GET", "/api/v1/project-session");
    await shown(signInLink).toMatchObject({ visible: true });
    await shown(admin).toMatchObject({ count: 0 });
    await shown(named("link", "Log in")).toMatchObject({ visible: true });
  });
});

describe('Replace a payout wallet without losing the current destination (spec/backend/wallets.md, "Story: Replace a payout wallet without losing the current destination"; spec/frontend/wallets.md, "Story: Choose a wallet without a lookalike taking its place")', () => {
  it('the picker cancels without a wallet request, a rejection registers nothing, and a change is registered only on Register (spec/frontend/walletConsent.md, "Discovery offers announced and legacy providers and refuses conflicting ones"; spec/frontend/wallets.md, "A prompt uses the selected provider object and refuses after an account or chain change"; spec/backend/wallets.md, "Registration appends an immutable successor or returns the current registry row")', async () => {
    await site.wallets({ evm: { name: "Anvil Wallet" }, solana: { name: "Ed25519 Wallet" } });
    await signIn(users.kai.login, "/account#wallets");
    const connect = named("button", "Connect EVM wallet");
    const picker = named("dialog", "Connect an EVM wallet");

    await site.click(connect);
    await shown(named("button", "Connect Anvil Wallet", { within: picker })).toMatchObject({ visible: true });
    await site.press("Escape");
    await shown(picker).toMatchObject({ count: 0 });
    await expect.poll(() => site.focused()).toMatchObject({ name: "Connect EVM wallet" });
    expect(await site.walletAsked()).toEqual([]);

    await site.walletReject();
    await site.click(connect);
    await site.click(named("button", "Connect Anvil Wallet", { within: picker }));
    await shown(named("alert")).toMatchObject({ visible: true });
    await shown(named("img", "Confirmed", { within: evmCard })).toMatchObject({ count: 0 });

    await site.click(connect);
    await site.click(named("button", "Connect Anvil Wallet", { within: picker }));
    const first = (await site.walletAddresses()).evm ?? "";
    await shown(named("img", "Confirmed", { within: evmCard })).toMatchObject({ visible: true });
    await site.open("/account#wallets");
    await shown(evmCard).toMatchObject({ text: expect.stringContaining(first) });

    const change = named("button", "Change EVM wallet");
    const question = named("heading", "Change EVM address?");
    await site.walletAccount(1);
    const second = (await site.walletAddresses()).evm ?? "";
    await site.click(change);
    await site.click(named("button", "Connect Anvil Wallet", { within: named("dialog", "Connect an EVM wallet") }));
    await shown(question).toMatchObject({ focused: true });
    const signed = (await site.walletAsked()).filter((asked) => asked.method === "personal_sign").length;
    await site.click(named("button", "Keep saved"));
    await shown(question).toMatchObject({ count: 0 });
    await expect.poll(() => site.focused()).toMatchObject({ name: "Change EVM wallet" });
    expect((await site.walletAsked()).filter((asked) => asked.method === "personal_sign").length).toBe(signed);
    await site.open("/account#wallets");
    await shown(evmCard).toMatchObject({ text: expect.stringContaining(first) });

    await site.click(change);
    await site.click(named("button", "Connect Anvil Wallet", { within: named("dialog", "Connect an EVM wallet") }));
    await site.click(named("button", "Register"));
    await shown(named("img", "Confirmed", { within: evmCard })).toMatchObject({ visible: true });
    await site.open("/account#wallets");
    await shown(evmCard).toMatchObject({ text: expect.stringContaining(second) });
    expect((await site.read(evmCard)).text).not.toContain(first);

    await site.click(named("button", "Connect Solana wallet"));
    await site.click(named("button", "Connect Ed25519 Wallet", { within: named("dialog", "Connect a Solana wallet") }));
    await shown(named("img", "Confirmed", { within: solanaCard })).toMatchObject({ visible: true });
    await site.open("/account#wallets");
    await shown(solanaCard).toMatchObject({ text: expect.stringContaining((await site.walletAddresses()).solana ?? "") });

    await site.open("/earnings");
    await shown(named("heading", "Payouts", { level: 1 })).toMatchObject({ visible: true });
  });
});

describe('Start and complete a GitHub sign-in flow (spec/backend/identity.md, "Story: Start and complete a GitHub sign-in flow")', () => {
  it('a browser that keeps no sign-in cookie is told to allow cookies and start again, and no session or membership opens (spec/backend/identity.md, "A website flow belongs to the browser that started it")', async () => {
    await site.allow("^console Failed to load resource: the server responded with a status of 403", "^403 POST /v1/oauth/poll$");
    await site.github(users.kai.login);
    await site.blockCookies();
    await site.open(loginPath("/account"));
    await shown(named("heading", "Log in", { level: 1 })).toMatchObject({ visible: true });
    await site.click(named("button", "Continue with GitHub"));
    await shown({ text: "Sign-in could not be confirmed in this browser. Allow cookies for slop.cash, then start again." }).toMatchObject({ visible: true });
    await shown(named("button", users.kai.login, { exact: false })).toMatchObject({ count: 0 });
    expect(await membersOf(users.kai.id)).toEqual([]);
  });
});

describe('Interface capability requirements survive responsive and accessibility modes (spec/frontend/projections.md, "Interface capability requirements survive responsive and accessibility modes")', () => {
  it('at 320 px, with reduced motion and 200% text, every account control stays named, reachable from the keyboard and usable', async () => {
    await site.wallets({ evm: { name: "Anvil Wallet" } });
    await site.open("/account");
    await site.view(320, 640, true);
    await shown(signInLink).toMatchObject({ visible: true });
    await accessible();

    await signIn(users.lea.login, "/account");
    await shown(named("region", "Email preferences")).toMatchObject({ visible: true });
    await accessible();
    await site.enlarge(named("main"));
    await accessible();

    await tabTo("Connect EVM wallet");
    await site.press("Enter");
    await shown(named("dialog", "Connect an EVM wallet")).toMatchObject({ visible: true });
    await tabTo("Connect Anvil Wallet");
    await site.press("Enter");
    await shown(named("img", "Confirmed", { within: evmCard })).toMatchObject({ visible: true });
    await accessible();
    await site.restore();

    await site.open("/earnings");
    await shown(named("heading", "Payouts", { level: 1 })).toMatchObject({ visible: true });
    await site.enlarge(named("main"));
    await accessible();
    await site.restore();
  });
});
