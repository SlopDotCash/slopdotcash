/** Runs the shipped notification Worker locally. All identities and addresses are synthetic. */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { childEnvironment } from "../scripts/child-environment.mjs";

export const E2E_EMAIL_ACCOUNTS = Object.fromEntries(
  [1440, 1024, 768, 320].map((width, index) => [
    `email${width}`,
    String(900000101 + index),
  ]),
);

export async function startNotifyWorkerFixture(root, persistTo, port) {
  const folder = mkdtempSync(join(tmpdir(), "slop-notify-e2e-"));
  const name = `slop-notify-e2e-${port}`;
  const source = readFileSync(join(root, "wrangler.toml"), "utf8");
  const databaseId = source.match(/^database_id = "([a-f0-9-]+)"$/mu)?.[1];
  if (!databaseId) throw new Error("Missing registry database id");
  const config = join(folder, "wrangler.json");
  writeFileSync(
    config,
    JSON.stringify({
      name,
      main: resolve(root, "workers/notify/index.ts"),
      compatibility_date: "2026-07-30",
      vars: {
        NOTIFY_FROM_ADDRESS: "notifications@slop.cash",
        NOTIFY_INBOX_URL: "https://staging.slop.cash/inbox",
        ACTIVITY_MAIL_PILOT: JSON.stringify({
          inboxUrl: "https://staging.slop.cash/inbox",
          recipients: Object.fromEntries(
            ["900000002", ...Object.values(E2E_EMAIL_ACCOUNTS)].map(
              (githubId) => [
                githubId,
                {
                  email: "applicant@example.com",
                  verifiedAt: "2026-01-01T00:00:00.000Z",
                  evidenceReference: "synthetic-local-pilot-verification",
                },
              ],
            ),
          ),
        }),
      },
      d1_databases: [
        {
          binding: "SLOP_DB",
          database_name: "slop-private",
          database_id: databaseId,
        },
      ],
      send_email: [
        {
          name: "ADMIN_EMAIL",
          allowed_destination_addresses: ["applicant@example.com"],
        },
      ],
      observability: { enabled: false },
    }),
  );
  return {
    name,
    close: await startLocalWorker(root, {
      config,
      port,
      label: "notify",
      extraArgs: ["--persist-to", persistTo],
      cleanup: () => rmSync(folder, { recursive: true, force: true }),
    }),
  };
}

/**
 * Starts `wrangler dev` for one local fixture Worker and waits until it
 * answers. Returns the function that stops it and runs `cleanup`.
 */
export async function startLocalWorker(
  root,
  { config, port, label, extraArgs = [], cleanup },
) {
  const worker = spawn(
    process.execPath,
    [
      join(root, "node_modules/wrangler/bin/wrangler.js"),
      "dev",
      "--config",
      config,
      "--port",
      String(port),
      "--ip",
      "127.0.0.1",
      ...extraArgs,
      "--log-level",
      "error",
      "--show-interactive-dev-session=false",
    ],
    { cwd: root, env: childEnvironment(), stdio: ["ignore", "pipe", "pipe"] },
  );
  let diagnostic = "";
  for (const stream of [worker.stdout, worker.stderr])
    stream.on("data", (chunk) => {
      diagnostic += String(chunk);
    });
  const close = () => {
    worker.kill("SIGTERM");
    cleanup();
  };
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) {
      close();
      throw new Error(`Local ${label} Worker failed: ${diagnostic}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.status === 404) return close;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  close();
  throw new Error(`Local ${label} Worker did not start: ${diagnostic}`);
}
