/**
 * A paid provider qualification runs only from the protected main release
 * with its provider key, or as an explicit `--dry-run` that spends nothing.
 */
export function protectedMainRelease(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): { dryRun: boolean; authorized: boolean } {
  const dryRun = argv.slice(2).join() === "--dry-run";
  const authorized =
    argv.length === 2 &&
    env.GITHUB_ACTIONS === "true" &&
    env.GITHUB_REF === "refs/heads/main" &&
    ["push", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME ?? "") &&
    !!env.SURPLUS_API_KEY;
  return { dryRun, authorized };
}
