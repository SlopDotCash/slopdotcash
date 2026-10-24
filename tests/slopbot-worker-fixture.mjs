/** Runs the Slopbot repository-access route locally against the GitHub fixture. */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startLocalWorker } from "./notify-worker-fixture.mjs";

export async function startSlopbotWorkerFixture(root, githubOrigin, port) {
  const folder = mkdtempSync(join(tmpdir(), "slop-slopbot-e2e-"));
  const name = `slopbot-e2e-${port}`;
  const config = join(folder, "wrangler.json");
  writeFileSync(
    config,
    JSON.stringify({
      name,
      main: resolve(root, "tests/slopbot-access-worker.mjs"),
      compatibility_date: "2026-07-30",
      vars: {
        GITHUB_FIXTURE_ORIGIN: githubOrigin,
        SLOPBOT_APP_ID: "1",
        SLOPBOT_APP_PRIVATE_KEY: generateKeyPairSync("rsa", {
          modulusLength: 2048,
        }).privateKey.export({ format: "pem", type: "pkcs8" }),
      },
      observability: { enabled: false },
    }),
  );
  return {
    name,
    close: await startLocalWorker(root, {
      config,
      port,
      label: "Slopbot",
      cleanup: () => rmSync(folder, { recursive: true, force: true }),
    }),
  };
}
