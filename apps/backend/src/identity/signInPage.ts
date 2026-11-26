// spec/backend/identity.md, "The callback claims a pending flow once and clears its verifier before contacting GitHub"
import tokens from "@repo/design-system/tokens.json" with { type: "json" };

export interface PageCopy {
  readonly title: string;
  readonly message: string;
}

const color = tokens.color.dark;

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

/** @throws {never} */
export function contentSecurityPolicy(nonce: string): string {
  return `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
}

/** @throws {never} */
export function signedInPage(site: string, nonce: string): string {
  const resume = site.startsWith("http:") ? `queueMicrotask(() => window.location.replace(${JSON.stringify(site)}));` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title></title></head><body><script nonce="${escapeHtml(nonce)}">window.close();${resume}</script></body></html>`;
}

/** @throws {never} */
export function failurePage(copy: PageCopy, site: string): string {
  const title = escapeHtml(copy.title);
  const message = escapeHtml(copy.message);
  const href = escapeHtml(site);
  const style = `*{box-sizing:border-box}body{margin:0;min-height:100svh;background:${color.background};color:${color.foreground};font:16px/1.5 ${tokens.font.sans};display:grid;grid-template-rows:auto 1fr}header{padding:24px 32px;border-bottom:1px solid ${color.border};font-weight:800;letter-spacing:-.04em;font-size:24px}header span{color:${color.primary}}main{width:min(100%,480px);margin:auto;padding:48px 28px;text-align:center}h1{font-size:clamp(28px,6vw,36px);line-height:1.15;letter-spacing:-.035em;margin:0 0 16px}p{margin:0 0 28px;color:${color["muted-foreground"]};text-wrap:pretty}a{font:inherit;display:flex;align-items:center;justify-content:center;min-height:48px;padding:12px 20px;border-radius:${tokens.radius};background:${color.primary};color:${color["primary-foreground"]};font-weight:700;text-decoration:none;border:0;width:100%}a:hover{background:${color.ring}}a:focus-visible{outline:3px solid ${color.foreground};outline-offset:4px}.status{width:52px;height:52px;display:grid;place-items:center;border:1px solid ${color.input};border-radius:50%;margin:0 auto 24px;color:${color.primary};font-size:28px}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>${title} · slop.cash</title><style>${style}</style></head><body><header>slop<span>.</span>cash</header><main><div class="status" aria-hidden="true">!</div><h1>${title}</h1><p>${message}</p><a href="${href}">Return to Slop</a></main></body></html>`;
}
