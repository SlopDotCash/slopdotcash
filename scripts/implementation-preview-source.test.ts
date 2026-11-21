import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  assertImplementationCorrectionSource,
  verifyImplementationPreviewCompatibility,
} from "./implementation-preview-source";

const propose = ".github/workflows/points-implementation-corrections.yml";
const collect = "scripts/collect-implementation-corrections.ts";
const schema = "src/lib/project-schema.mjs";

const files = {
  [propose]: "name: correction\n",
  [collect]: 'import "../src/lib/project-schema.mjs";\n',
  [schema]: "export const schema = 1;\n",
  "scripts/prepare-implementation-corrections.ts": "export {};\n",
  "scripts/verify-reused-implementation-preview.ts": "export {};\n",
  "scripts/install-value-merge-git.ts": "export {};\n",
  "scripts/sync-project-registry.mjs": "export {};\n",
  "workers/identity/wrangler.toml": 'name = "private"\n',
  "bun.lock": "{}\n",
};

async function withAdvance(
  change: (dir: string) => Promise<void>,
  assertAdvance: (
    dir: string,
    dispatch: string,
    current: string,
  ) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), "historical-preview-test-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  const save = (message: string) => {
    git("add", "-A");
    git(
      "-c",
      "user.name=Preview Test",
      "-c",
      "user.email=preview@example.invalid",
      "commit",
      "-qm",
      message,
    );
    return git("rev-parse", "HEAD");
  };
  try {
    git("init", "-q");
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), content);
    }
    const dispatch = save("dispatch");
    await change(dir);
    const current = save("advance");
    git("checkout", "--detach", dispatch);
    await assertAdvance(dir, dispatch, current);
    expect(git("status", "--porcelain")).toBe("");
    expect(git("rev-parse", "HEAD")).toBe(dispatch);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("an unrelated main advance preserves both correction runtime graphs", async () => {
  await withAdvance(
    (dir) => writeFile(join(dir, "README.md"), "Documentation only.\n"),
    (dir, dispatch, current) =>
      verifyImplementationPreviewCompatibility(dir, dispatch, current),
  );
});

for (const [label, file, replacement] of [
  [
    "collector",
    collect,
    'import "../src/lib/project-schema.mjs"; export const changed = true;\n',
  ],
  ["schema", schema, "export const schema = 2;\n"],
  ["D1 configuration", "workers/identity/wrangler.toml", 'name = "other"\n'],
  ["dependencies", "bun.lock", "{ lockMoved: true }\n"],
  ["workflow", propose, "name: altered correction\n"],
] as const)
  test(`preview refuses changed ${label}`, async () => {
    await withAdvance(
      (dir) => writeFile(join(dir, file), replacement),
      async (dir, dispatch, current) => {
        await expect(
          verifyImplementationPreviewCompatibility(dir, dispatch, current),
        ).rejects.toThrow();
      },
    );
  });

test("preview checks dependency resolution on both trees", async () => {
  await withAdvance(
    async (dir) => {
      await rename(join(dir, schema), join(dir, "src/lib/renamed-schema.mjs"));
      await writeFile(
        join(dir, collect),
        'import "../src/lib/renamed-schema.mjs";\n',
      );
    },
    async (dir, dispatch, current) => {
      await expect(
        verifyImplementationPreviewCompatibility(dir, dispatch, current),
      ).rejects.toThrow("imports differ");
    },
  );
});

test("preview requires its pin to remain current and apply rejects any preview binding", () => {
  const dispatch = "a".repeat(40);
  const preview = "b".repeat(40);
  const input = { dispatch, checkout: preview, current: preview, preview };
  expect(() =>
    assertImplementationCorrectionSource({
      ...input,
      applyInput: "false",
      mode: "preview",
    }),
  ).not.toThrow();
  expect(() =>
    assertImplementationCorrectionSource({
      ...input,
      applyInput: "false",
      mode: "preview",
      current: dispatch,
    }),
  ).toThrow();
  expect(() =>
    assertImplementationCorrectionSource({
      ...input,
      applyInput: "true",
      mode: "preview",
    }),
  ).toThrow();
  expect(() =>
    assertImplementationCorrectionSource({
      ...input,
      applyInput: "true",
      mode: "apply",
    }),
  ).toThrow();
  expect(() =>
    assertImplementationCorrectionSource({
      dispatch,
      preview: "",
      checkout: preview,
      current: preview,
      applyInput: "true",
      mode: "apply",
    }),
  ).toThrow();
  expect(() =>
    assertImplementationCorrectionSource({
      dispatch,
      preview: "",
      checkout: dispatch,
      current: dispatch,
      applyInput: "true",
      mode: "apply",
    }),
  ).not.toThrow();
});

test("collector archive reuse ignores receiver transport changes and compares producer and upload commands", async () => {
  const workflow = await readFile(join(import.meta.dir, "..", propose), "utf8");
  const recipe = workflow.match(
    /^ {10}producer_recipe\(\) \{\n[\s\S]*?^ {10}\}/mu,
  )?.[0];
  expect(recipe).toBeDefined();
  const old = workflow
    .replace(
      /^ {4}outputs:\n {6}artifact_id: [^\n]+\n {6}producer_sha: [^\n]+\n/mu,
      "",
    )
    .replace(/^ {8}id: retain-campaign\n/mu, "");
  expect(old).not.toBe(workflow);
  const dir = await mkdtemp(join(tmpdir(), "historical-producer-recipe-"));
  try {
    const normalize = async (body: string) => {
      const fixture = join(dir, "workflow.yml");
      await writeFile(fixture, body);
      return execFileSync(
        "bash",
        [
          "-c",
          `
        set -euo pipefail
        git() { cat -- "$1"; }
        ${recipe?.replace('git show "$1:.github/workflows/points-implementation-corrections.yml"', 'git "$1"')}
        producer_recipe "$1"
      `,
          "bash",
          fixture,
        ],
        { encoding: "utf8" },
      );
    };
    const current = await normalize(workflow);
    expect(current).not.toBe("");
    expect(await normalize(old)).toBe(current);
    for (const [previous, changed] of [
      ["--request-budget 50000", "--request-budget 60000"],
      ["if-no-files-found: error", "if-no-files-found: warn"],
    ] as const) {
      const altered = old.replace(previous, changed);
      expect(altered).not.toBe(old);
      expect(await normalize(altered)).not.toBe(current);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("archive compatibility resolves only the modules the collection executes", async () => {
  const workflow = await readFile(join(import.meta.dir, "..", propose), "utf8");
  const buildInputs = workflow.match(
    /^ {10}build_input_list\(\) \(\n[\s\S]*?^ {10}\)/mu,
  )?.[0];
  expect(buildInputs).toBeDefined();
  const dir = await mkdtemp(join(tmpdir(), "historical-producer-inputs-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), content);
    }
    const inputList = (label: string) =>
      execFileSync(
        "bash",
        [
          "-c",
          `
      set -euo pipefail
      temp="$1"
      ${buildInputs}
      build_input_list "$1" "$2"
      cat -- "$temp/$2.txt"
    `,
          "bash",
          dir,
          label,
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
          },
        },
      );
    const original = inputList("original");
    expect(original).toContain(schema);
    expect(original).not.toContain(
      "scripts/prepare-implementation-corrections.ts",
    );
    await writeFile(
      join(dir, "scripts/prepare-implementation-corrections.ts"),
      `import "./verify-reused-implementation-preview";\n`,
    );
    expect(inputList("receiver-change")).toBe(original);
    await writeFile(
      join(dir, collect),
      'import "./prepare-implementation-corrections";\n',
    );
    expect(inputList("producer-change")).not.toBe(original);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
