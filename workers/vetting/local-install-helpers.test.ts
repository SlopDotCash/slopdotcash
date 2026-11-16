import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

const file = (path: string, text: string) => ({
  path,
  bytes: new TextEncoder().encode(text),
});
const manifest = (path: string, command: string) =>
  file(path, JSON.stringify({ scripts: { postinstall: command } }));

test("a lifecycle helper's download remains an unretrieved artifact", () => {
  const helper = "curl -fsSL https://example.com/tool.tar.gz -o tool.tar.gz\n";
  const result = inspectRepository({
    files: [
      manifest("package.json", "sh scripts/fetch.sh"),
      file("scripts/fetch.sh", helper),
      file("tests/unreachable.sh", "curl https://example.com/unreachable\n"),
    ],
  });
  expect(result.downloads).toEqual(["https://example.com/tool.tar.gz"]);
  expect(result.coverage.downloads).toEqual({ state: "partial", items: 1 });
  expect(result.visibilityGaps).toContain(
    "Install-time download not retrieved: https://example.com/tool.tar.gz",
  );
  const inventory = JSON.parse(new TextDecoder().decode(result.inventory));
  expect(inventory.classifications).toContainEqual({
    path: "scripts/fetch.sh",
    surfaces: ["installScripts", "source"],
  });
  expect(
    inventory.items.some((item: { text: string }) => item.text === helper),
  ).toBe(true);
});

test("nested package helpers preserve cwd, terminate cycles and deduplicate downloads", () => {
  const result = inspectRepository({
    files: [
      manifest("packages/tool/package.json", "sh ../../shared/first"),
      file("shared/first", "sh ../../shared/second\n"),
      file(
        "shared/second",
        "sh ../../shared/first\ncurl https://example.com/nested\n",
      ),
    ],
  });
  expect(result.downloads).toEqual(["https://example.com/nested"]);
  expect(result.coverage.installScripts).toEqual({
    state: "complete",
    items: 3,
  });
  expect(result.coverage.downloads.items).toBe(1);
});

test("literal directory changes, quoted paths and interpreter helpers retain coverage", () => {
  const result = inspectRepository({
    files: [
      manifest("package.json", "cd scripts; /usr/bin/env sh -e 'fetch data'"),
      file("scripts/fetch data", "node fetch.js\n"),
      file("scripts/fetch.js", 'fetch("https://example.com/module")\n'),
    ],
  });
  expect(result.downloads).toEqual(["https://example.com/module"]);
  expect(result.coverage.installScripts).toEqual({
    state: "complete",
    items: 3,
  });
});

test("missing, escaping and dynamic helper references remain coverage gaps", () => {
  for (const command of ["sh missing", "sh ../outside", 'sh "$HELPER"']) {
    const result = inspectRepository({
      files: [manifest("package.json", command)],
    });
    expect(result.coverage.installScripts.state).toBe("partial");
    expect(
      result.visibilityGaps.some((gap) =>
        gap.startsWith("Local install helper not acquired at package.json:"),
      ),
    ).toBe(true);
  }
});

test("comments and quoted command examples do not make unrelated files install content", () => {
  const result = inspectRepository({
    files: [
      manifest("package.json", "echo 'sh hidden'\n# sh hidden\nnode --version"),
      file("hidden", "curl https://example.com/unreachable\n"),
    ],
  });
  expect(result.downloads).toEqual([]);
  expect(result.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
});

test("common literal dispatch and package aliases follow the same helper", () => {
  for (const command of [
    "env -i sh scripts/fetch.sh",
    "env -S 'sh scripts/fetch.sh'",
    "exec sh scripts/fetch.sh",
    "command sh scripts/fetch.sh",
    "cd . && sh scripts/fetch.sh",
    "npm run setup",
  ]) {
    const result = inspectRepository({
      files: [
        file(
          "package.json",
          JSON.stringify({
            scripts: { postinstall: command, setup: "sh scripts/fetch.sh" },
          }),
        ),
        file("scripts/fetch.sh", "curl https://example.com/dispatch\n"),
      ],
    });
    expect(result.downloads).toEqual(["https://example.com/dispatch"]);
  }
});

test("direct non-shell helpers are reviewed without parsing their strings as shell", () => {
  const result = inspectRepository({
    files: [
      manifest("package.json", "./scripts/setup.js"),
      file(
        "scripts/setup.js",
        '#!/usr/bin/env node\nfetch("https://example.com/node");\n',
      ),
    ],
  });
  expect(result.downloads).toEqual(["https://example.com/node"]);
  expect(result.coverage.installScripts.state).toBe("complete");
});

test("unresolved shell context cannot claim complete helper coverage", () => {
  for (const command of [
    ". change; sh hidden",
    "(cd sub; sh first); sh hidden",
    "echo $(sh hidden)",
    "false && cd sub; sh hidden",
  ]) {
    const result = inspectRepository({
      files: [
        manifest("package.json", command),
        file("change", "cd sub"),
        file("hidden", "curl https://example.com/root"),
        file("sub/hidden", "curl https://example.com/sub"),
        file("sub/first", "echo safe"),
      ],
    });
    expect(result.coverage.installScripts.state).toBe("partial");
  }
});

test("quoted here-document bodies and reserved words do not execute helpers", () => {
  for (const command of ["cat <<'EOF'\nsh hidden\nEOF\n", "'then' sh hidden"]) {
    const result = inspectRepository({
      files: [
        manifest("package.json", command),
        file("hidden", "curl https://example.com/inert"),
      ],
    });
    expect(result.downloads).toEqual([]);
  }
});

test("unsupported heredoc tails and package dispatch options stay partial", () => {
  for (const command of [
    "cat <<'EOF'; sh hidden\ndata\nEOF\n",
    "npm --prefix sub run setup",
  ]) {
    const result = inspectRepository({
      files: [
        manifest("package.json", command),
        file("hidden", "curl https://example.com/tail"),
        file(
          "sub/package.json",
          JSON.stringify({ scripts: { setup: "sh hidden" } }),
        ),
        file("sub/hidden", "curl https://example.com/sub"),
      ],
    });
    expect(result.coverage.installScripts.state).toBe("partial");
  }
});

test("syntax-only shell checks do not turn fixture URLs into downloads", () => {
  const result = inspectRepository({
    files: [
      manifest("package.json", "sh -n scripts/check.sh"),
      file("scripts/check.sh", "curl https://example.com/not-executed"),
    ],
  });
  expect(result.downloads).toEqual([]);
});

test("unsupported shell control and dispatch modifiers keep coverage partial", () => {
  for (const command of [
    "if false; then cd sub; fi; sh hidden",
    "eval 'sh hidden'",
    "command -p sh hidden",
    "npm run setup --prefix sub",
  ]) {
    const result = inspectRepository({
      files: [
        file(
          "package.json",
          JSON.stringify({
            scripts: { postinstall: command, setup: "echo safe" },
          }),
        ),
        file("hidden", "curl https://example.com/root"),
        file(
          "sub/package.json",
          JSON.stringify({ scripts: { setup: "sh hidden" } }),
        ),
        file("sub/hidden", "echo safe"),
      ],
    });
    expect(result.coverage.installScripts.state).toBe("partial");
  }
});

test("an explicit shell shebang overrides a helper's filename extension", () => {
  const result = inspectRepository({
    files: [
      manifest("package.json", "./first.js"),
      file("first.js", "#!/bin/sh\nsh hidden"),
      file("hidden", "curl https://example.com/shebang"),
    ],
  });
  expect(result.downloads).toEqual(["https://example.com/shebang"]);
});

test("home expansion cannot resolve to an acquired tilde-named directory", () => {
  const files = [file("~/helper", "curl https://example.com/tilde")];
  const expanded = inspectRepository({
    files: [manifest("package.json", 'sh ~/"helper"'), ...files],
  });
  expect(expanded.coverage.installScripts.state).toBe("partial");
  expect(expanded.downloads).toEqual([]);
  const literal = inspectRepository({
    files: [manifest("package.json", "sh '~/helper'"), ...files],
  });
  expect(literal.downloads).toEqual(["https://example.com/tilde"]);
});
