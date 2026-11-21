/** Verify a current-main checkout for an independently read-only correction. */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const commit = /^[a-f0-9]{40}$/u;
const workflow = ".github/workflows/points-implementation-corrections.yml";
const entries = [
  "scripts/collect-implementation-corrections.ts",
  "scripts/prepare-implementation-corrections.ts",
  "scripts/verify-reused-implementation-preview.ts",
  "scripts/install-value-merge-git.ts",
  "scripts/sync-project-registry.mjs",
];
const runtimeFiles = [
  workflow,
  "bun.lock",
  "bunfig.toml",
  "package.json",
  ":(glob)tsconfig*.json",
  "scripts/restore-implementation-preview.py",
  "src/lib/project-revisions.generated.json",
  "workers/identity/wrangler.toml",
  "migrations/",
];

export function assertImplementationCorrectionSource({
  mode,
  applyInput,
  dispatch,
  checkout,
  current,
  preview,
}: {
  mode: string;
  applyInput: string | undefined;
  dispatch: string;
  checkout: string;
  current: string;
  preview: string;
}): void {
  if (
    !commit.test(dispatch) ||
    !commit.test(checkout) ||
    !commit.test(current) ||
    (preview &&
      (mode !== "preview" ||
        applyInput !== "false" ||
        !commit.test(preview))) ||
    checkout !== (preview || dispatch) ||
    current !== checkout
  )
    throw new Error(
      "Historical correction source is no longer the exact main head",
    );
}

async function graph(directory: string, output: string): Promise<string[]> {
  const metadata = join(output, "modules.json");
  await run(
    process.execPath,
    [
      "--no-env-file",
      "build",
      "--target=bun",
      "--packages=external",
      `--outdir=${output}`,
      `--metafile=${metadata}`,
      ...entries,
    ],
    { cwd: directory },
  );
  const { inputs } = JSON.parse(await readFile(metadata, "utf8"));
  const paths = Object.keys(inputs ?? {}).sort();
  if (
    paths.length === 0 ||
    paths.some(
      (path) =>
        !/^[A-Za-z0-9._/-]+$/u.test(path) ||
        path.startsWith("/") ||
        path.split("/").includes(".."),
    )
  )
    throw new Error("Historical correction runtime graph is invalid");
  return paths;
}

export async function verifyImplementationPreviewCompatibility(
  directory: string,
  dispatch: string,
  preview: string,
): Promise<void> {
  if (!commit.test(dispatch) || !commit.test(preview))
    throw new Error(
      "Historical correction source must use complete commit IDs",
    );
  const git = (...args: string[]) => run("git", args, { cwd: directory });
  const checkout = (await git("rev-parse", "HEAD")).stdout.trim();
  if (
    checkout !== dispatch ||
    (await git("status", "--porcelain", "-uno")).stdout
  )
    throw new Error("Historical correction dispatch checkout is not clean");
  if (preview === dispatch) return;

  await git("merge-base", "--is-ancestor", dispatch, preview);
  await git("diff", "--quiet", dispatch, preview, "--", ...runtimeFiles);
  const temporary = await mkdtemp(join(tmpdir(), "slop-preview-source-"));
  const other = join(temporary, "tree");
  let added = false;
  try {
    await git("worktree", "add", "--detach", other, preview);
    added = true;
    const [original, current] = await Promise.all([
      graph(directory, join(temporary, "dispatch")),
      graph(other, join(temporary, "preview")),
    ]);
    if (JSON.stringify(original) !== JSON.stringify(current))
      throw new Error(
        "Historical correction runtime imports differ on current main",
      );
    await git("ls-files", "--error-unmatch", "--", ...original);
    await git("diff", "--quiet", dispatch, preview, "--", ...original);
  } finally {
    if (added) await git("worktree", "remove", "--force", other);
    await rm(temporary, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const env = process.env;
  const [preview] = process.argv.slice(2);
  if (
    !preview ||
    process.argv.length !== 3 ||
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_WORKFLOW_REF !==
      `${env.GITHUB_REPOSITORY}/${workflow}@refs/heads/main` ||
    env.GITHUB_WORKFLOW_SHA !== env.GITHUB_SHA ||
    env.APPLY !== "false"
  )
    throw new Error(
      "Live-main preview binding requires the trusted preview workflow",
    );
  await verifyImplementationPreviewCompatibility(
    process.cwd(),
    env.GITHUB_SHA ?? "",
    preview,
  );
}
