// Our side of the one-click GitHub App setup. GitHub itself is faked.
import { expect, test } from "bun:test";
import { appManifest, convertManifest, setupPage } from "./dev-backend-setup";

const ORIGIN = "http://localhost:4467";

test("the manifest asks for a private App with a local callback and no webhook", () => {
  const manifest = appManifest(ORIGIN, "Slop local dev ab12");
  expect(manifest.callback_urls).toEqual([`${ORIGIN}/v1/oauth/callback`]);
  expect(manifest.redirect_url).toBe(`${ORIGIN}/__dev/setup/callback`);
  expect(manifest.public).toBe(false);
  expect(manifest.default_permissions).toEqual({ metadata: "read" });
  expect(manifest.default_events).toEqual([]);
  expect("hook_attributes" in manifest).toBe(false);
});

test("the setup page posts the escaped manifest to GitHub and runs no script", async () => {
  const html = await setupPage(ORIGIN, "state123", 'Name "x" <b>', null).text();
  expect(html).toContain(
    'action="https://github.com/settings/apps/new?state=state123"',
  );
  expect(html).toContain("Name \\&#34;x\\&#34; &#60;b&#62;");
  expect(html).not.toContain("<b>");
  expect(html).not.toContain("<script");
});

const conversion = (body: unknown, status = 201) =>
  (async () => Response.json(body, { status })) as unknown as typeof fetch;

test("the code is exchanged for the client credentials only", async () => {
  const calls: { url: string; method?: string }[] = [];
  const app = await convertManifest("abc123", (async (
    url: string,
    init?: RequestInit,
  ) => {
    calls.push({ url, method: init?.method });
    return Response.json({
      client_id: "Iv1.id",
      client_secret: "secret",
      name: "Slop local dev ab12",
      html_url: "https://github.com/settings/apps/slop-local-dev-ab12",
      pem: "-----BEGIN RSA PRIVATE KEY-----",
      webhook_secret: "hook",
    });
  }) as unknown as typeof fetch);
  expect(calls).toEqual([
    {
      url: "https://api.github.com/app-manifests/abc123/conversions",
      method: "POST",
    },
  ]);
  expect(app).toEqual({
    clientId: "Iv1.id",
    clientSecret: "secret",
    name: "Slop local dev ab12",
    htmlUrl: "https://github.com/settings/apps/slop-local-dev-ab12",
  });
});

test("a refused code or an answer without credentials fails closed", async () => {
  await expect(
    convertManifest("abc123", conversion({ message: "Not Found" }, 404)),
  ).rejects.toThrow("HTTP 404");
  await expect(
    convertManifest(
      "abc123",
      conversion({ client_id: "Iv1.id", name: "x", html_url: "y" }),
    ),
  ).rejects.toThrow("did not include");
});
