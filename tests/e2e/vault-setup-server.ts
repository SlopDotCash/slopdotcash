import { spawn } from "node:child_process";
import { expect, type Page } from "@playwright/test";

/**
 * Starts the vault-setup browser API (`scripts/vault-setup-browser-server.ts`
 * or its prebuilt bundle) and captures its stdout and stderr for the test log.
 * The caller stops `server` and attaches `output()` when the workflow ends.
 */
export function spawnVaultSetupServer(
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) {
  let output = "";
  const server = spawn("bun", args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (s) => {
    output += String(s);
  });
  server.stderr?.on("data", (s) => {
    output += String(s);
  });
  return { server, output: () => output };
}

/**
 * Waits for the started vault-setup API, reads its fixture session token and
 * returns the authenticated request headers and a POST helper that requires
 * a successful answer.
 */
export async function connectVaultSetupServer(
  page: Page,
  origin: string,
  output: () => string,
) {
  await expect
    .poll(output, { timeout: 30_000 })
    .toContain("Vault setup API ready");
  const initial = await (await page.request.get(`${origin}/__fixture`)).json();
  const headers = {
    origin,
    cookie: `__Host-slop_points=${initial.token}`,
    "content-type": "application/json",
  };
  const api = async (path: string, data: unknown) => {
    const response = await page.request.post(`${origin}/api/v1/${path}`, {
      headers,
      data,
    });
    const body = await response.json();
    expect(response.ok(), JSON.stringify(body)).toBe(true);
    return body;
  };
  return { initial, headers, api };
}
