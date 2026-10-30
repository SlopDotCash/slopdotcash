import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { LocalCapturedEmail } from "./dev-backend-notify";

const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
function bodyOf(mime: string) {
  const body = mime
    .split(/\r?\n\r?\n/u)
    .slice(1)
    .join("\n\n")
    .replace(/=\r?\n/gu, "");
  const bytes: number[] = [];
  for (let index = 0; index < body.length; index++) {
    const hex = body.slice(index + 1, index + 3);
    if (body[index] === "=" && /^[a-f0-9]{2}$/iu.test(hex)) {
      bytes.push(Number.parseInt(hex, 16));
      index += 2;
    } else bytes.push(body.charCodeAt(index));
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

/** A private local mailbox. These files are never served by Vite. */
export function devMailCapture(directory: string, origin: string) {
  return {
    async capture(message: LocalCapturedEmail) {
      if (!/^[1-9]\d{0,19}$/u.test(message.githubId))
        throw new Error("Invalid local mail recipient");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(
        resolve(
          directory,
          `${message.githubId}-${Date.now()}-${randomUUID()}.json`,
        ),
        JSON.stringify(message),
        { mode: 0o600, flag: "wx" },
      );
    },
    async view(githubId: string) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const names = (await readdir(directory))
        .filter(
          (name) =>
            name.startsWith(`${githubId}-`) &&
            /^\d+-\d+-[a-f0-9-]+\.json$/u.test(name),
        )
        .sort()
        .reverse()
        .slice(0, 100);
      const entries: string[] = [];
      for (const name of names) {
        const message = JSON.parse(
          await readFile(resolve(directory, name), "utf8"),
        ) as LocalCapturedEmail;
        if (message.githubId !== githubId) continue;
        const body = bodyOf(message.mime);
        const links = [...body.matchAll(/https?:\/\/[^\s<>]+/gu)].flatMap(
          ([text]) => {
            try {
              const url = new URL(text);
              return url.origin === origin && url.pathname === "/inbox"
                ? [`<a href="${escapeHtml(url.href)}">Open in Slop</a>`]
                : [];
            } catch {
              return [];
            }
          },
        );
        entries.push(
          `<article><p>To: ${escapeHtml(message.to)}</p>${links.join(" ")}<pre>${escapeHtml(body)}</pre></article>`,
        );
        if (entries.length === 100) break;
      }
      return new Response(
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Local Slop mail</title><style>body{font:16px system-ui;max-width:55rem;margin:2rem auto;padding:1rem}article{border-top:1px solid #aaa;padding:1rem 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{display:inline-block;padding:.6rem}</style></head><body><h1>Local mail</h1><p>Captured for this signed-in account. No external email was sent.</p>${entries.join("") || "<p>No captured messages.</p>"}</body></html>`,
        {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "private, no-store",
            "x-robots-tag": "noindex",
            "referrer-policy": "no-referrer",
            "x-content-type-options": "nosniff",
            "content-security-policy":
              "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
          },
        },
      );
    },
  };
}
