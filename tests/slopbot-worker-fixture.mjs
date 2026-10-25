/** Runs the Slopbot repository-access route locally against the GitHub fixture. */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startLocalWorker } from "./notify-worker-fixture.mjs";

export async function startSlopbotWorkerFixture(
  root,
  githubOrigin,
  port,
  persistTo,
) {
  const folder = mkdtempSync(join(tmpdir(), "slop-slopbot-e2e-"));
  const name = `slopbot-e2e-${port}`;
  const config = join(folder, "wrangler.json");
  const databaseId = readFileSync(join(root, "wrangler.toml"), "utf8").match(
    /^database_id = "([a-f0-9-]+)"$/mu,
  )?.[1];
  if (!databaseId) throw new Error("Missing registry database id");
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
      d1_databases: [
        {
          binding: "SLOPBOT_DB",
          database_name: "slop-private",
          database_id: databaseId,
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
      label: "Slopbot",
      extraArgs: ["--persist-to", persistTo],
      cleanup: () => rmSync(folder, { recursive: true, force: true }),
    }),
  };
}
