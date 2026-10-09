import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Explicit isolated identity configuration; no API calls or credential reads.
const args = {};
const allowed = new Set([
  "public-origin",
  "database-id",
  "database-name",
  "output",
  "frontend-directory",
]);
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]?.replace(/^--/, "");
  if (
    !process.argv[i]?.startsWith("--") ||
    !allowed.has(key) ||
    args[key] ||
    !process.argv[i + 1]
  )
    throw new Error("Invalid test identity arguments");
  args[key] = process.argv[i + 1];
}
const origin = args["public-origin"];
if (
  !/^https:\/\/slop-identity-test\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.workers\.dev$/.test(
    origin ?? "",
  ) ||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    args["database-id"] ?? "",
  ) ||
  args["database-name"] !== "slop-identity-test" ||
  !args.output
)
  throw new Error(
    "Explicit slop-identity-test workers.dev origin and isolated database required",
  );
const root = dirname(fileURLToPath(import.meta.url));
const repository = resolve(root, "../..");
const output = resolve(args.output);
await mkdir(output, { recursive: true });
const config = {
  name: "slop-identity-test",
  main: resolve(root, "index.ts"),
  compatibility_date: "2026-10-06",
  triggers: { crons: ["17 * * * *"] },
  observability: { enabled: true, logs: { invocation_logs: false } },
  workers_dev: true,
  preview_urls: false,
  routes: [],
  vars: { IDENTITY_PUBLIC_ORIGIN: origin },
  d1_databases: [
    {
      binding: "IDENTITY_DB",
      database_name: args["database-name"],
      database_id: args["database-id"],
      migrations_dir: resolve(repository, "migrations"),
    },
  ],
  ratelimits: [
    {
      name: "IDENTITY_START_LIMITER",
      namespace_id: "82001",
      simple: { limit: 60, period: 60 },
    },
    {
      name: "IDENTITY_POLL_LIMITER",
      namespace_id: "82002",
      simple: { limit: 600, period: 60 },
    },
  ],
};
await writeFile(
  resolve(output, "slop-identity-test.json"),
  `${JSON.stringify(config, null, 2)}\n`,
);
await writeFile(
  resolve(output, "oauth-registration.json"),
  `${JSON.stringify({ name: "Slop isolated payment test", homepageUrl: "https://slop-staging.pages.dev", authorizationCallbackUrl: `${origin}/v1/oauth/callback`, frontendBuildVariable: { VITE_IDENTITY_PUBLIC_ORIGIN: origin }, secretBindings: ["GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "IDENTITY_STATE_KEY", "IDENTITY_ASSERTION_KEY"], pagesServiceBinding: { binding: "SLOP_IDENTITY", service: "slop-identity-test" }, note: "Dedicated test OAuth application and keys only. No production credentials. Existing staging deployment requires coordination with its owner." }, null, 2)}\n`,
);
if (args["frontend-directory"]) {
  const frontend = resolve(args["frontend-directory"]);
  if (frontend === resolve(repository, "public"))
    throw new Error(
      "Do not overwrite source headers; use isolated build output",
    );
  const headers = await readFile(
    resolve(repository, "public/_headers"),
    "utf8",
  );
  const target =
    "connect-src 'self' https://api.slop.cash https://identity.slop.cash https://api.github.com;";
  if (!headers.includes(target))
    throw new Error("CSP source changed; inspect before preparing test output");
  await writeFile(
    resolve(frontend, "_headers"),
    headers.replace(
      target,
      `connect-src 'self' https://api.slop.cash ${origin} https://api.github.com;`,
    ),
  );
}
console.log(resolve(output, "slop-identity-test.json"));
