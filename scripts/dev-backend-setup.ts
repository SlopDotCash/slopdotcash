/**
 * One-click GitHub App setup for the local development backend, using GitHub's
 * App manifest flow. The person clicks "Create GitHub App" on GitHub; GitHub
 * sends the browser back here with a short-lived code, which this module
 * exchanges for the App's client ID and secret. The App's private key and
 * webhook secret are discarded because sign-in does not use them.
 */
export type GithubApp = {
  clientId: string;
  clientSecret: string;
  name: string;
  htmlUrl: string;
};

/** The App GitHub is asked to create: callback to the dev origin, no webhook. */
export function appManifest(origin: string, name: string) {
  return {
    name,
    url: origin,
    redirect_url: `${origin}/__dev/setup/callback`,
    callback_urls: [`${origin}/v1/oauth/callback`],
    public: false,
    // Every App can read its own metadata; sign-in needs nothing else.
    default_permissions: { metadata: "read" },
    default_events: [],
  };
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/gu, (c) => `&#${c.charCodeAt(0)};`);

function page(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#f3efe6;background:#0f0e0c}a,button{font:inherit}button{padding:.7rem 1.1rem;border:0;border-radius:6px;background:#ff5a19;color:#0f0e0c;font-weight:700;cursor:pointer}code{background:#24211c;padding:.1rem .3rem;border-radius:4px}a{color:#ff5a19}</style><h1>${escapeHtml(title)}</h1>${body}`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/** The page with the button that sends the manifest to GitHub. */
export function setupPage(
  origin: string,
  state: string,
  name: string,
  existing: GithubApp | null,
): Response {
  const manifest = escapeHtml(JSON.stringify(appManifest(origin, name)));
  return page(
    "Create the local GitHub App",
    `${
      existing
        ? `<p>An App is already set up: <a href="${escapeHtml(existing.htmlUrl)}">${escapeHtml(existing.name)}</a>. <a href="${escapeHtml(origin)}/login">Sign in</a>. To make a new one, use the button.</p>`
        : "<p>Local sign-in needs a GitHub App that you own. GitHub shows you the App before it creates it. Check the name, then confirm.</p>"
    }<form method="post" action="https://github.com/settings/apps/new?state=${escapeHtml(state)}"><input type="hidden" name="manifest" value="${manifest}"><button type="submit">Create the GitHub App on GitHub</button></form><p>Prefer to do it by hand? Create a GitHub App with the callback <code>${escapeHtml(origin)}/v1/oauth/callback</code>, no webhook, and no permissions. Then put its client ID and secret in <code>.env</code> as <code>GITHUB_APP_CLIENT_ID</code> and <code>GITHUB_APP_CLIENT_SECRET</code>.</p>`,
  );
}

export function setupDonePage(origin: string, app: GithubApp): Response {
  return page(
    "GitHub App created",
    `<p><a href="${escapeHtml(app.htmlUrl)}">${escapeHtml(app.name)}</a> is ready. Its credentials are saved in <code>.slop-dev/github-app.json</code>, which Git ignores.</p><p><a href="${escapeHtml(origin)}/login">Sign in</a></p>`,
  );
}

export function setupFailedPage(message: string): Response {
  return page("Setup did not finish", `<p>${escapeHtml(message)}</p>`, 400);
}

/** Exchanges the manifest code for the App's client credentials. */
export async function convertManifest(
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GithubApp> {
  const response = await fetchImpl(
    `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "slop-dev-backend",
        "x-github-api-version": "2022-11-28",
      },
    },
  );
  if (!response.ok)
    throw new Error(`GitHub refused the setup code (HTTP ${response.status}).`);
  const body = (await response.json()) as Record<string, unknown>;
  const { client_id, client_secret, name, html_url } = body;
  if (
    typeof client_id !== "string" ||
    typeof client_secret !== "string" ||
    typeof name !== "string" ||
    typeof html_url !== "string" ||
    !client_id ||
    !client_secret
  )
    throw new Error("GitHub's answer did not include the App credentials.");
  return {
    clientId: client_id,
    clientSecret: client_secret,
    name,
    htmlUrl: html_url,
  };
}
