import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Read-only remote admission before any mutation. One name is also supported for diagnostics.
const names = process.argv.slice(2);
if (
  ![1, 3].includes(names.length) ||
  new Set(names).size !== names.length ||
  names.some(
    (name) =>
      name.length > 63 ||
      !/^slop-payments-(base-sepolia|solana-devnet|solana-testnet)(-[a-z0-9]+)*-(attester|relayer|dispatcher)$/.test(
        name,
      ),
  )
)
  throw new Error("Explicit isolated test worker names required");
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!/^[a-f0-9]{32}$/.test(account ?? ""))
  throw new Error("Explicit test Cloudflare account ID required");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const executable = resolve(root, "node_modules/.bin/wrangler");
const directory = await mkdtemp(join(tmpdir(), "slop-fresh-stack-"));
try {
  for (const name of names) {
    // No source config inheritance or local .env files. Authentication remains Wrangler-owned.
    const config = join(directory, "wrangler.json");
    await writeFile(
      config,
      JSON.stringify({
        name,
        account_id: account,
        compatibility_date: "2026-10-06",
        workers_dev: false,
        preview_urls: false,
        routes: [],
      }),
    );
    const result = spawnSync(
      executable,
      ["deployments", "list", "--name", name, "--json", "--config", config],
      {
        cwd: directory,
        encoding: "utf8",
        timeout: 45000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          CI: "true",
          NO_COLOR: "1",
          WRANGLER_SEND_METRICS: "false",
          WRANGLER_LOG: "error",
          WRANGLER_LOG_SANITIZE: "true",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (result.status === 0)
      throw new Error(
        `Test Worker ${name} already exists. Refusing reapply: reconcile journals and use a reviewed update procedure or a new isolated stack.`,
      );
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const resource = `/accounts/${account}/workers/scripts/${name}/deployments`;
    if (
      result.error ||
      result.signal ||
      !output.includes(
        `A request to the Cloudflare API (${resource}) failed.`,
      ) ||
      !/\[code: 10007\]/.test(output)
    ) {
      // Never print raw subprocess output: credentials, paths, or provider diagnostics may be sensitive.
      throw new Error(
        `Cannot prove ${name} absent. Wrangler authentication, account access, network, or API response needs review; no changes permitted.`,
      );
    }
  }
  console.log(
    `Confirmed ${names.length} isolated test Worker name(s) absent; no existing stack will be updated.`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
