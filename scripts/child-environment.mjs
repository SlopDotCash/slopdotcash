/**
 * Builds the deliberately small environment inherited by local build,
 * browser, and evidence subprocesses. In particular, repository/API tokens
 * must never leak into tools that do not need them.
 */
const INHERITED_ENVIRONMENT_NAMES = Object.freeze([
  "CI",
  "VITE_SLOP_ENVIRONMENT",
  "COLORTERM",
  "FORCE_COLOR",
  "HOME",
  "LANG",
  "LC_ALL",
  "NO_COLOR",
  "PATH",
  "PLAYWRIGHT_BROWSERS_PATH",
  "SHELL",
  "SLOP_PYTHON",
  "SLOP_E2E_PORT",
  "SLOP_E2E_CHROMIUM_EXECUTABLE_PATH",
  "SLOP_E2E_VIDEO",
  "SLOP_E2E_VAULT_ACTIONS",
  "SLOP_E2E_ANVIL_PORT",
  "SLOP_E2E_SOLANA_VAULT",
  "SLOP_E2E_SOLANA_RPC_PORT",
  "SLOP_PROFILES_INPUT",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "XDG_CACHE_HOME",
]);

export function childEnvironment(source = process.env, overrides = {}) {
  const environment = {};
  for (const name of INHERITED_ENVIRONMENT_NAMES) {
    const value = source[name];
    if (typeof value === "string") environment[name] = value;
  }
  if (environment.NO_COLOR !== undefined) {
    // Playwright sets FORCE_COLOR for its web-server child. Translate the
    // user's no-color preference so Node does not receive conflicting flags.
    delete environment.NO_COLOR;
    environment.FORCE_COLOR = "0";
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (typeof value !== "string") {
      throw new TypeError(
        `child environment override ${name} must be a string`,
      );
    }
    environment[name] = value;
  }
  // Wrangler's banner starts an npm update request that can keep a completed
  // local migration alive after its timeout. Local checks use pinned tools;
  // neither update discovery nor CLI telemetry is an input to their result.
  environment.WRANGLER_HIDE_BANNER = "true";
  environment.WRANGLER_SEND_METRICS = "false";
  return environment;
}
