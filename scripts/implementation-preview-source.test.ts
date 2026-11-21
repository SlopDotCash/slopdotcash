import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
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
