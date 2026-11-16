/** Browser contract for the Settings referral link; the API suite uses real SQLite. */
import { join } from "node:path";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import {
  expect,
  expectAccessibleReflow,
  projectSuffix,
  test,
} from "./fixtures";

const { site } = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);
/** A seeded contributor session of the registry lane; not a team account. */
const MEMBER = {
  login: "e2e-reporter-a",
  token: (
    JSON.parse(process.env.SLOP_E2E_SECURITY_TOKENS ?? "{}") as Record<
      string,
      string
    >
  )["reporter-a"],
};

test("a member names their referral link, sees refusals, and copies the saved link", async ({
  page,
  diagnostics,
}, info) => {
  let code: string | null = null;
  const posted: { code: unknown; contentType: string | null }[] = [];
  await page.route(`${site}/**`, (route) =>
    ["/api/v1/payments/received"].includes(
      new URL(route.request().url()).pathname,
    )
      ? route.fallback()
      : route.fulfill({
          path: join(
            process.cwd(),
            "dist",
            route.request().resourceType() === "document"
              ? "index.html"
              : new URL(route.request().url()).pathname,
          ),
        }),
  );
  const json = (path: string, body: unknown) =>
    page.route(`${site}/api/v1/${path}`, (route) =>
      route.fulfill({ json: body }),
    );
  await json("project-session", {
    session: { githubId: "900000098", githubLogin: "link-test", admin: false },
  });
  await json("project-appeals", { appeals: [] });
  await page.route(`${site}/api/v1/points/me`, (route) =>
    route.fulfill({
      json: {
        actor: { id: "U_link_test", login: "link-test" },
        joinedAt: "2026-10-01T00:00:00Z",
        public: true,
        welcome: 5,
        referralCode: code,
      },
    }),
  );
  await json("payments/me", {
    githubUserId: "900000098",
    wallets: [],
    payments: [],
    monthlyAwards: [],
    balances: [],
    directTransfers: [],
    walletObservations: [],
  });
  await json("notifications/email", {
    enabled: false,
    securityEnabled: false,
    enrollmentAvailable: false,
    pending: null,
    availability: "unverified",
  });
  await json("notifications", {
    recipientGithubId: "900000098",
    notifications: [],
    unread: 0,
    nextCursor: null,
  });
  await json("security-cases", {
    viewer: { githubId: "900000098", githubLogin: "link-test" },
    programs: [],
    cases: [],
  });
  await json("security-submissions", {
    recipientGithubId: "900000098",
    automatic: false,
    submissions: [],
  });
  await json("referrals/me", { enabled: false });
  await page.route(`${site}/api/v1/referrals/code`, async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as { code: unknown };
    posted.push({
      code: body.code,
      contentType: await request.headerValue("content-type"),
    });
    if (body.code === "taken-name")
      return route.fulfill({
        status: 409,
        json: {
          error: "code_taken",
          message: "That name is taken. Choose another.",
        },
      });
    code = String(body.code);
    return route.fulfill({ json: { code } });
  });
  // The spec serves the build under the site origin, so the intended refusal
  // reaches the diagnostics as the browser's console report only.
  diagnostics.allow(
    /^console Failed to load resource: the server responded with a status of 409 \(.+\) at .+\/api\/v1\/referrals\/code$/u,
  );

  await page.goto(`${site}/account`, { waitUntil: "domcontentloaded" });
  const section = page.getByRole("region", {
    name: "Referral link",
    exact: true,
  });
  const name = section.getByRole("textbox", { name: "Link name", exact: true });
  const save = section.getByRole("button", { name: "Save", exact: true });
  await expect(name).toHaveValue("");
  await expect(save).toBeDisabled();
  await expect(section.locator("code")).toHaveCount(0);
  await expect(section.getByText(/stops your current link/u)).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("referral-link-empty.png"),
    fullPage: true,
  });

  // A name the rule refuses never leaves the page.
  await name.fill("ab");
  await save.click();
  await expect(section.getByRole("alert")).toHaveText(
    "Use 3 to 32 letters, digits, hyphens or underscores, starting and ending with a letter or digit.",
  );
  expect(posted).toEqual([]);

  // The server's refusal is shown and nothing is saved.
  await name.fill("taken-name");
  await save.click();
  await expect(section.getByRole("alert")).toHaveText(
    "That name is taken. Choose another.",
  );
  await expect(name).toHaveValue("taken-name");
  await expect(section.locator("code")).toHaveCount(0);

  // Keyboard only: type a name and press Enter.
  await name.fill("DrewBuilds");
  await name.press("Enter");
  await expect(section.getByText("Saved.", { exact: true })).toBeVisible();
  await expect(section.getByRole("alert")).toHaveCount(0);
  await expect(section.locator("code")).toHaveText(
    `${site}/referral/DrewBuilds`,
  );
  await expect(
    section.getByText("Saving a new name stops your current link.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(save).toBeDisabled();
  expect(posted).toEqual([
    { code: "taken-name", contentType: "application/json" },
    { code: "DrewBuilds", contentType: "application/json" },
  ]);
  await page
    .context()
    .grantPermissions(["clipboard-read", "clipboard-write"], { origin: site });
  await section.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(section.getByText("Copied.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `${site}/referral/DrewBuilds`,
  );
  await page.screenshot({
    path: info.outputPath("referral-link-saved.png"),
    fullPage: true,
  });

  // A reload reads the saved name back from the member record.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(name).toHaveValue("DrewBuilds");
  await expect(section.locator("code")).toHaveText(
    `${site}/referral/DrewBuilds`,
  );
  await section.scrollIntoViewIfNeeded();
  await expectAccessibleReflow(page, "referral-link");
});

// The local origin never reads the member record into the page (the points
// session is a product-origin read), so this lane drives the same requests
// the Settings section sends, against Pages Functions and a real local D1.
test("a saved name forwards through Pages Functions and D1 to the project form with the member as referrer @registry", async ({
  page,
}) => {
  if (!MEMBER.token) throw new Error("Missing E2E session");
  // An underscore cannot be a GitHub login, so the name needs no GitHub read.
  const chosen = `E2E_Link_${projectSuffix()}`;
  await page.goto("/how-it-works", { waitUntil: "domcontentloaded" });
  const origin = new URL(page.url()).origin;
  // The request client does not send a Secure cookie to the local http
  // origin, so the session travels as an explicit header.
  const cookie = `__Host-slop_points=${MEMBER.token}`;
  const choose = (code: string) =>
    page.request.post("/api/v1/referrals/code", {
      headers: { origin, cookie },
      data: { code },
    });
  const reserved = await choose("slop_cash");
  expect(reserved.status()).toBe(422);
  expect(await reserved.json()).toMatchObject({ error: "reserved_code" });
  const saved = await choose(chosen);
  expect(saved.status()).toBe(200);
  expect(await saved.json()).toEqual({ code: chosen });
  // The member record the Settings page loads carries the name.
  const me = await page.request.get("/api/v1/points/me", {
    headers: { cookie },
  });
  expect(await me.json()).toMatchObject({
    actor: { login: MEMBER.login },
    referralCode: chosen,
  });
  // The link ignores case and answers one redirect to the form.
  const followed = await page.request.get(`/referral/${chosen.toLowerCase()}`, {
    maxRedirects: 0,
  });
  expect(followed.status()).toBe(302);
  expect(followed.headers().location).toBe(
    `${origin}/projects/new?ref=${MEMBER.login}`,
  );
  const unknown = await page.request.get("/referral/nobody_has_this", {
    maxRedirects: 0,
  });
  expect(unknown.status()).toBe(302);
  expect(unknown.headers().location).toBe(`${origin}/projects/new`);
  await page.goto(`/referral/${chosen}`, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(`${origin}/projects/new?ref=${MEMBER.login}`);
});
