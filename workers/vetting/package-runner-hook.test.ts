import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

const enc = (text: string) => new TextEncoder().encode(text);

function categories(path: string, text: string): string[] {
  return inspectRepository({
    files: [{ path, bytes: enc(text) }],
  }).findings.map((finding) => finding.category);
}

/**
 * A package runner installs and runs a package the project never declares, at
 * install time. `curl | sh` is flagged; `npx -y pkg` in a `prepare` hook is
 * the same act through a registry and was clean.
 */
test("a runner that installs and runs a package in an install hook fires", () => {
  for (const [path, text] of [
    ["package.json", '{"scripts":{"prepare":"npx -y some-cli"}}\n'],
    [
      "package.json",
      '{"scripts":{"postinstall":"npx --yes some-cli --init"}}\n',
    ],
    ["package.json", '{"scripts":{"prepare":"pnpm dlx some-cli"}}\n'],
    ["package.json", '{"scripts":{"prepare":"yarn dlx some-cli"}}\n'],
    ["setup.sh", "#!/bin/sh\nnpx -y some-cli\n"],
  ] as const)
    expect({ path, text, categories: categories(path, text) }).toEqual({
      path,
      text,
      categories: expect.arrayContaining(["unsafe-execution"]),
    });
});

test("a runner over a declared package and an install-free run stay clean", () => {
  for (const [path, text] of [
    ["package.json", '{"scripts":{"prepare":"npx tsc -p ."}}\n'],
    ["package.json", '{"scripts":{"prepare":"npx --no-install eslint ."}}\n'],
    ["package.json", '{"scripts":{"build":"vite build"}}\n'],
    ["setup.sh", "#!/bin/sh\npnpm install --frozen-lockfile\n"],
  ] as const)
    expect({ path, text, categories: categories(path, text) }).toEqual({
      path,
      text,
      categories: [],
    });
});
