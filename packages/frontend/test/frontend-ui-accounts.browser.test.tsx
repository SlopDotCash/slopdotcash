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

let expectedPopups = 0;

beforeEach(async () => {
  expectedPopups = 0;
  await site.start();
  for (const user of Object.values(users)) await site.user(user.id, user.login);
});

afterEach(async () => {
  expect(await site.popups()).toBe(expectedPopups);
  expect(await site.diagnostics()).toEqual({ console: [], failed: [] });
});

// spec/frontend/navigation.md, "Story: Resume an authorized destination after signing in"; spec/backend/accounts.md, "Story: Sign in with GitHub and keep one immutable account"
describe("Resume an authorized destination after signing in", () => {
  // spec/frontend/navigation.md, "A signed-out private destination keeps its URL and shows sign-in in place with private reads disabled"; spec/frontend/composition.md, "Sign-in keeps only a safe same-origin return destination"; spec/backend/accounts.md, "A web sign-in consumes one web assertion and opens a public membership"
  it("a signed-out private destination keeps its URL", async () => {
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

  // spec/frontend/composition.md, "Sign-in keeps only a safe same-origin return destination"
  it("a return destination off this origin is never followed", async () => {
    await site.github(users.ada.login);
    await site.open(`/login?next=${encodeURIComponent("https://example.org/account")}`);
    await site.click(named("button", "Continue with GitHub"));
    await expect.poll(async () => new URL(await site.where()).pathname, { timeout: 30_000 }).not.toBe("/login");
    expect(new URL(await site.where()).origin).toBe(origin);

    await signOut(users.ada.login);
    await site.github(users.ada.login);
    await site.open(`/login?next=${encodeURIComponent("/login/")}`);
    await site.click(named("button", "Continue with GitHub"));
    await at("/");
  });
});

// spec/backend/accounts.md, "Story: Close and reopen an account without losing history"
describe("Close and reopen an account without losing history", () => {
  // spec/backend/accounts.md, "Confirmed closure ends every session, hides the membership, disconnects X and withdraws both email consents"; spec/backend/accounts.md, "An ordinary sign-in cannot reopen a closed account; explicit reopening can"
  it("a closed account signs out everywhere and only an", async () => {
    await site.allow("^console Failed to load resource: the server responded with a status of 40[19]", "^409 POST /api/v1/points/join$", "^401 GET /api/v1/payments/me$");
    await signIn(users.lin.login, "/account");
    await shown(named("form", "Close account")).toMatchObject({ count: 0 });
    const [before] = await membersOf(users.lin.id);
    expect(before).toMatchObject({ public: 1, closed_at: null });

    const closed = await site.fetch("POST", "/api/v1/points/account/close", { login: users.lin.login });
    expect(closed).toMatchObject({ status: 200, body: { closed: true } });
    expect(await membersOf(users.lin.id)).toEqual([{ actor_id: before?.actor_id, public: 0, closed_at: expect.any(String) as unknown }]);
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
    expect(await membersOf(users.lin.id)).toEqual([{ actor_id: before?.actor_id, public: 0, closed_at: expect.any(String) as unknown }]);

    await site.click(named("button", "Reopen account"));
    await at("/account");
    await shown(named("heading", "Settings", { level: 1 })).toMatchObject({ visible: true });
    expect(await membersOf(users.lin.id)).toEqual([{ actor_id: before?.actor_id, public: 1, closed_at: null }]);
  });
});

// spec/backend/accounts.md, "Story: Keep mail consent tied to the signed-in account"; spec/frontend/presentation.md, "Story: Find account controls on their existing separate pages"
describe("Keep mail consent tied to the signed-in account", () => {
  // spec/frontend/navigation.md, "An identity refresh applies only within the navigation lifetime that requested it"; spec/backend/email.md, "Verification is account-bound, single-use, unexpired and applies the consent requested with it"; spec/frontend/emailAction.md, "An email verify or unsubscribe token survives sign-in and is applied once to the signed-in account"; spec/frontend/presentation.md, "Settings keeps wallet and email controls expanded without account navigation tabs"
  it("a same-account focus check keeps the draft editable", async () => {
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
    await shown(named("region", "Email preferences")).toMatchObject({ text: expect.stringContaining(email) as unknown });
    const [sent] = (await site.verifications()).filter((each) => each.githubId === String(users.mae.id));

    await site.open(`/inbox#verify-email=${sent?.token ?? ""}`);
    await site.click(named("button", "Verify email"));
    await shown({ text: "Verified", exact: true }).toMatchObject({ visible: true });
    await site.open("/account#notifications");
    await shown(named("switch", "Activity")).toMatchObject({ checked: true, disabled: false });
    await expect.poll(() => site.sql("SELECT enabled FROM notification_email_preferences WHERE github_id = ?", String(users.mae.id))).toEqual([{ enabled: 1 }]);

    await site.click(named("switch", "Activity"));
    await shown(named("switch", "Activity")).toMatchObject({ checked: false });
    await expect.poll(() => site.sql("SELECT enabled FROM notification_email_preferences WHERE github_id = ?", String(users.mae.id))).toEqual([{ enabled: 0 }]);
  });
});

// spec/frontend/composition.md, "Story: Change accounts without disclosing the prior account's draft"
describe("Change accounts without disclosing the prior", () => {
  // spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"; spec/backend/accounts.md, "Sign-out ends only the caller's session and revocation never reaches another account"
  it("after another account signs in elsewhere, the", async () => {
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

// spec/frontend/navigation.md, "An identity refresh applies only within the navigation lifetime that requested it"
describe("An identity refresh applies only within the", () => {
  // spec/frontend/navigation.md, "A signed-out private destination keeps its URL and shows sign-in in place with private reads disabled"
  it("an admin view closes when a tab return finds no", async () => {
    await site.allow("^console Failed to load resource: the server responded with a status of 40[13]", "^40[13] (GET|POST) /api/v1/");
    const admin = named("navigation", "Administration");
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

// spec/backend/wallets.md, "Story: Replace a payout wallet without losing the current destination"; spec/frontend/wallets.md, "Story: Choose a wallet without a lookalike taking its place"
describe("Replace a payout wallet without losing the current", () => {
  // spec/frontend/walletConsent.md, "Discovery offers announced and legacy providers and refuses conflicting ones"; spec/frontend/wallets.md, "A prompt uses the selected provider object and refuses after an account or chain change"; spec/backend/wallets.md, "Registration appends an immutable successor or returns the current registry row"; spec/settlement/payment.md, "A destination requires the current account and wallet consent"; spec/backend/bindingConsent.md, "EVM consent names one registered deployment, the authorized claim and an expected version"
  it("the picker cancels without a wallet request, a", async () => {
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
    await shown(evmCard).toMatchObject({ text: expect.stringContaining(first) as unknown });

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
    await shown(evmCard).toMatchObject({ text: expect.stringContaining(first) as unknown });

    await site.click(change);
    await site.click(named("button", "Connect Anvil Wallet", { within: named("dialog", "Connect an EVM wallet") }));
    await site.click(named("button", "Register"));
    await shown(named("img", "Confirmed", { within: evmCard })).toMatchObject({ visible: true });
    await site.open("/account#wallets");
    await shown(evmCard).toMatchObject({ text: expect.stringContaining(second) as unknown });
    expect((await site.read(evmCard)).text).not.toContain(first);

    await site.click(named("button", "Connect Solana wallet"));
    await site.click(named("button", "Connect Ed25519 Wallet", { within: named("dialog", "Connect a Solana wallet") }));
    await shown(named("img", "Confirmed", { within: solanaCard })).toMatchObject({ visible: true });
    await site.open("/account#wallets");
    await shown(solanaCard).toMatchObject({ text: expect.stringContaining((await site.walletAddresses()).solana ?? "") as unknown });

    const vault = `0x${"2".repeat(40)}`;
    const obligation = "obligation-consent";
    await site.sql(
      "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES(?,'consent-kit',?,'base-mainnet','base',?,'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',6,'1000000','20000',?,'reserved',?)",
      obligation,
      String(users.kai.id),
      vault,
      "a".repeat(64),
      new Date().toISOString(),
    );
    const signatures = async () => (await site.walletAsked()).filter((asked) => asked.method === "personal_sign" || asked.method === "eth_signTypedData_v4").length;
    const signedBefore = await signatures();
    await site.open("/earnings");
    await shown(named("heading", "Payouts", { level: 1 })).toMatchObject({ visible: true });
    const authorize = named("button", "Authorize payout wallet");
    const review = named("dialog", "Authorize payout wallet");
    await site.click(authorize);
    await shown(named("group", "Vault", { within: review })).toMatchObject({ visible: true, text: vault });
    expect((await site.read(named("group", "Your wallet", { within: review }))).text.toLowerCase()).toBe(second.toLowerCase());
    await shown(named("img", "Base", { within: review })).toMatchObject({ visible: true });
    await shown(named("button", "Sign with Anvil Wallet", { within: review })).toMatchObject({ visible: true, disabled: false });
    await shown({ text: "Paid", exact: true }).toMatchObject({ count: 0 });
    expect(await signatures()).toBe(signedBefore);
    await site.press("Escape");
    await shown(review).toMatchObject({ count: 0 });
    await expect.poll(() => site.focused()).toMatchObject({ name: "Authorize payout wallet" });
    expect(await signatures()).toBe(signedBefore);
    expect(await site.sql("SELECT state FROM payment_obligations WHERE id = ?", obligation)).toEqual([{ state: "reserved" }]);
  });
});

// spec/backend/bindingConsent.md, "Story: Consent to bind the authorized payout wallet to a project vault"; spec/settlement/bindingAuthority.md, "Payouts reopens with the current wallet authorization or finalized binding"
describe("Payout authorization", () => {
  // spec/frontend/projections.md, "Award, funding and settlement status are independent facts"
  it("restores on reload", { timeout: 150_000 }, async () => {
    await site.allow(
      "^console Applying inline style violates the following Content Security Policy directive 'style-src 'self''",
      "^failed GET /api/v1/project-session net::ERR_ABORTED$",
      "^failed GET /contributor-allocation\\.json net::ERR_ABORTED$",
    );
    await site.wallets({ evm: { name: "Anvil Wallet" } });
    await site.backendRpc();
    await signIn(users.kai.login, "/account#wallets");
    await site.click(named("button", "Connect EVM wallet"));
    await site.click(named("button", "Connect Anvil Wallet", { within: named("dialog", "Connect an EVM wallet") }));
    await shown(named("img", "Confirmed", { within: evmCard })).toMatchObject({ visible: true });

    const project = "payout-consent";
    const actor = String(users.kai.id);
    const now = new Date().toISOString();
    const manifest = JSON.stringify({ id: project, status: "active" });
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(manifest))), (byte) => byte.toString(16).padStart(2, "0")).join("");
    await site.sql("INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,actor_github_id,actor_github_login,created_at) VALUES(?,1,?,?,?,?,?,?)", project, manifest, digest, "Register browser test project", actor, users.kai.login, now);
    await site.sql("INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)", project, manifest, digest, now, now);
    const { vault, asset } = await site.vault({ projectId: project });
    await site.finalize();
    await site.sql("INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES('payout-consent-award',?,?,'base-mainnet','base',?,?,6,'1000000','20000',?,'reserved',?)", project, actor, vault, asset, "b".repeat(64), now);

    await site.open("/earnings");
    const authorize = named("button", "Authorize payout wallet");
    const pending = { text: "Authorized · pending", exact: true };
    const finalized = { text: "Wallet bound", exact: true };
    await site.click(authorize);
    await site.allow("^console Failed to load resource: the server responded with a status of 503", "^503 GET /api/v1/payments/me$");
    await site.fail("GET", "/api/v1/payments/me", 503, { error: "payments_unavailable" });
    await site.click(named("button", "Sign with Anvil Wallet", { within: named("dialog", "Authorize payout wallet") }));
    await shown(named("button", "Retry")).toMatchObject({ visible: true });
    await shown(authorize).toMatchObject({ count: 0 });
    await site.unfail("GET", "/api/v1/payments/me");
    await site.click(named("button", "Retry"));
    await shown(pending).toMatchObject({ visible: true });
    const signs = () => site.walletAsked().then((asks) => asks.filter((ask) => ask.method === "eth_signTypedData_v4").length);
    expect(await signs()).toBe(1);

    await site.open("/earnings");
    await shown(pending).toMatchObject({ visible: true });
    await shown(authorize).toMatchObject({ count: 0 });
    expect(await signs()).toBe(1);
    expect(await site.fetch("GET", "/api/v1/payments/me")).toMatchObject({ status: 200, body: { payments: [{ bindingStatus: "pending", state: "reserved" }] } });

    await site.backendRpc(false);
    await site.open("/earnings");
    await shown({ text: "Authorization unavailable", exact: true }).toMatchObject({ visible: true });
    await shown(authorize).toMatchObject({ count: 0 });
    await site.backendRpc();
    await site.click(named("button", "Retry wallet authorization"));
    await shown(pending).toMatchObject({ visible: true });

    await site.bindPayout(actor, vault);
    await site.open("/earnings");
    await shown(pending).toMatchObject({ visible: true });
    await shown(finalized).toMatchObject({ count: 0 });
    await site.finalize();
    await site.open("/earnings");
    await shown(finalized).toMatchObject({ visible: true });
    await shown(authorize).toMatchObject({ count: 0 });
    await shown({ text: "Paid", exact: true }).toMatchObject({ count: 0 });
    expect(await signs()).toBe(1);
    expect(await site.sql("SELECT state, paid_transaction FROM payment_obligations WHERE id = 'payout-consent-award'")).toEqual([{ state: "reserved", paid_transaction: null }]);
    await accessible();

    await site.open("/account#wallets");
    await site.walletAccount(2);
    const replacement = (await site.walletAddresses()).evm ?? "";
    expect(replacement).toMatch(/^0x[0-9a-f]{40}$/iu);
    await site.click(named("button", "Change EVM wallet"));
    await site.click(named("button", "Connect Anvil Wallet", { within: named("dialog", "Connect an EVM wallet") }));
    await site.click(named("button", "Register"));
    await expect.poll(async () => (await site.read(evmCard)).text, { timeout: 30_000 }).toContain(replacement);
    await shown(named("img", "Confirmed", { within: evmCard })).toMatchObject({ visible: true });
    await site.open("/earnings");
    await shown(authorize).toMatchObject({ visible: true });
    const payments = await site.fetch("GET", "/api/v1/payments/me");
    expect(payments.status).toBe(200);
    const wallets = typeof payments.body === "object" && payments.body !== null && "wallets" in payments.body && Array.isArray(payments.body.wallets) ? payments.body.wallets : [];
    expect(wallets.some((wallet: unknown) => typeof wallet === "object" && wallet !== null && "chain" in wallet && "address" in wallet && "authorized" in wallet && wallet.chain === "base" && wallet.address === replacement.toLowerCase() && wallet.authorized === true)).toBe(true);
    await shown(finalized).toMatchObject({ count: 0 });
    expect(await signs()).toBe(1);
  });
});

// spec/backend/identity.md, "Story: Start and complete a GitHub sign-in flow"
describe("Start and complete a GitHub sign-in flow", () => {
  // spec/backend/identity.md, "A website flow belongs to the browser that started it"
  it("a browser that keeps no sign-in cookie is told to", async () => {
    expectedPopups = 1;
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

// spec/frontend/projections.md, "Interface capability requirements survive responsive and accessibility modes"
describe("Interface capability requirements survive responsive", () => {
  it("at 320 px, with reduced motion and 200% text, every", async () => {
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
