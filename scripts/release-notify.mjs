/** Protected-release notification profile. Preparation never changes remote state. */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const [mode, target, output] = process.argv.slice(2);
if (
  !["prepare", "deploy"].includes(mode) ||
  !["production", "staging"].includes(target) ||
  !output
)
  throw new TypeError(
    "Use: bun scripts/release-notify.mjs prepare|deploy production|staging OUTPUT_DIRECTORY",
  );
const selected = process.env.SLOP_NOTIFY_MAIL_PILOTS ?? "";
if (!["", "security", "activity", "security,activity"].includes(selected))
  throw new TypeError(
    "SLOP_NOTIFY_MAIL_PILOTS must be empty, security, activity, or security,activity",
  );
const pilots = selected ? selected.split(",") : [];
const generalSelection = process.env.SLOP_NOTIFY_GENERAL_EMAIL ?? "";
if (!["", "enabled", "paused"].includes(generalSelection))
  throw new TypeError(
    "SLOP_NOTIFY_GENERAL_EMAIL must be empty, enabled, or paused",
  );
const generalEmail = generalSelection === "enabled";
const generalPaused = generalSelection === "paused";
if (generalEmail && process.env.SLOP_NOTIFY_EMAIL_SENDING_READY !== "verified")
  throw new TypeError(
    "General email requires operator-verified Cloudflare Email Sending onboarding",
  );
const sendsSecurity = generalEmail || pilots.includes("security");
const hasOutbox = generalEmail || pilots.length > 0;
const hasDatabase = hasOutbox || generalPaused;
const pages = Bun.TOML.parse(
  readFileSync(
    resolve(
      root,
      target === "production" ? "wrangler.toml" : "wrangler.staging.toml",
    ),
    "utf8",
  ),
);
const base = Bun.TOML.parse(
  readFileSync(resolve(root, "workers/notify/wrangler.toml"), "utf8"),
);
const database = pages.d1_databases?.filter(
  (item) => item.binding === "SLOP_DB",
);
if (
  database?.length !== 1 ||
  !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(
    database[0].database_id,
  )
)
  throw new TypeError(
    "Selected Pages profile must bind exactly one reviewed private D1 database",
  );
const expectedOrigin =
  target === "production" ? "https://slop.cash" : "https://staging.slop.cash";
if (
  pages.vars?.PUBLIC_SITE_URL !== expectedOrigin ||
  base.name !== "slop-notify" ||
  base.workers_dev !== false ||
  base.preview_urls !== false ||
  base.routes?.length
)
  throw new TypeError("Unexpected notification or Pages release boundary");
const slopbot =
  pages.services?.filter((item) => item.binding === "SLOPBOT") ?? [];
if (
  sendsSecurity &&
  (slopbot.length !== 1 ||
    slopbot[0].service !==
      (target === "production"
        ? "slop-slopbot"
        : "slop-repository-access-staging"))
)
  throw new TypeError(
    "Security mail needs the selected environment Slopbot binding",
  );
const name = target === "production" ? base.name : `${base.name}-staging`;
const directory = resolve(output);
mkdirSync(directory, { recursive: true });
const config = {
  ...base,
  name,
  main: resolve(root, "workers/notify/index.ts"),
  vars: {
    ...base.vars,
    SLOP_ENVIRONMENT: target,
    NOTIFY_INBOX_URL: `${expectedOrigin}/inbox`,
    NOTIFY_GENERAL_EMAIL_ENABLED: String(generalEmail),
    ADMIN_GITHUB_IDS: pages.vars?.ADMIN_GITHUB_IDS ?? "",
    PROJECT_MODERATOR_GITHUB_IDS:
      pages.vars?.PROJECT_MODERATOR_GITHUB_IDS ?? "",
  },
  d1_databases: hasDatabase
    ? [{ ...database[0], migrations_dir: resolve(root, "migrations") }]
    : [],
  services: sendsSecurity ? slopbot : [],
  triggers: { crons: hasOutbox ? ["*/5 * * * *"] : [] },
};
if (target === "staging") {
  const source = readFileSync(resolve(root, "wrangler.staging.toml"), "utf8");
  if (
    (source.match(/^\[env\.preview\]$/gmu) ?? []).length !== 1 ||
    pages.services?.some((item) => item.binding === "SLOP_NOTIFY")
  )
    throw new TypeError(
      "Staging service insertion requires one preview boundary and no existing notify binding",
    );
  const published = source.replace(
    "[env.preview]",
    `[[services]]\nbinding = "SLOP_NOTIFY"\nservice = "${name}"\n\n[env.preview]`,
  );
  const checked = Bun.TOML.parse(published);
  const service = checked.services?.filter(
    (item) => item.binding === "SLOP_NOTIFY",
  );
  if (
    service?.length !== 1 ||
    service[0].service !== name ||
    checked.env?.preview?.services?.length !== 0
  )
    throw new TypeError(
      "Staging notification binding or preview isolation is invalid",
    );
  writeFileSync(resolve(directory, "pages.toml"), published);
}
const configPath = resolve(directory, "wrangler.json");
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
const expectedSecrets = [
  "ADMIN_EMAILS",
  ...pilots.map((pilot) => `${pilot.toUpperCase()}_MAIL_PILOT`),
  ...(generalEmail ? ["NOTIFY_UNSUBSCRIBE_KEY"] : []),
].sort();
writeFileSync(
  resolve(directory, "profile.json"),
  `${JSON.stringify({ target, name, pilots, generalEmail, emailSendingReadiness: generalEmail ? "operator-verified" : generalPaused ? "paused" : "not-enabled", expectedSecrets, databaseId: hasDatabase ? database[0].database_id : null, inboxUrl: `${expectedOrigin}/inbox` }, null, 2)}\n`,
);
if (mode === "prepare") process.exit(0);
if (process.env.SLOP_NOTIFY_RELEASE !== "enabled")
  throw new TypeError("Notification release is not enabled");
const sha = process.env.GITHUB_SHA;
const ref =
  target === "production" ? "refs/heads/main" : "refs/heads/development";
if (
  !/^[0-9a-f]{40}$/u.test(sha ?? "") ||
  process.env.GITHUB_REF !== ref ||
  process.env.GITHUB_EVENT_NAME === "pull_request"
)
  throw new TypeError(
    "Notification deployment requires the selected protected branch",
  );
function command(binary, args) {
  const result = spawnSync(binary, args, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    writeFileSync(
      resolve(directory, "command-failure.log"),
      result.stderr ?? String(result.error),
    );
    throw new Error(
      `Release command failed: ${binary} ${args[0]} (details retained by the protected runner)`,
    );
  }
  return result.stdout;
}
if (command("git", ["rev-parse", "HEAD"]).trim() !== sha)
  throw new TypeError("Release checkout does not match GITHUB_SHA");
const wrangler = resolve(root, "node_modules/.bin/wrangler");
function cli(args) {
  return command(wrangler, [...args, "--config", configPath]);
}
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!/^[0-9a-f]{32}$/u.test(account ?? "") || !token)
  throw new TypeError("Protected Cloudflare credentials are missing");
// Version upload can expose preview URLs before triggers are applied. The private
// service must already have no public ingress; this release never creates it.
async function cloudflareRead(path) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}${path}`,
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Notification boundary verification failed (${response.status})`,
    );
  const data = await response.json();
  if (data.success !== true)
    throw new TypeError("Notification boundary could not be verified");
  return data.result;
}
const service = await cloudflareRead(`/workers/services/${name}`);
const environment = service?.default_environment?.environment;
if (typeof environment !== "string" || !/^[a-zA-Z0-9_-]+$/u.test(environment))
  throw new TypeError("Notification service environment could not be verified");
const boundary = `/workers/services/${name}/environments/${environment}`;
const [subdomain, routes, domains] = await Promise.all([
  cloudflareRead(`${boundary}/subdomain`),
  cloudflareRead(`${boundary}/routes?show_zonename=true`),
  cloudflareRead(
    `/workers/domains/records?page=0&per_page=5&service=${name}&environment=${environment}`,
  ),
]);
if (
  subdomain?.enabled !== false ||
  subdomain?.previews_enabled !== false ||
  !Array.isArray(routes) ||
  routes.length !== 0 ||
  !Array.isArray(domains) ||
  domains.length !== 0
)
  throw new TypeError(
    "Notification Worker must already have no public routes, domains, workers.dev or preview URLs",
  );
const inventory = JSON.parse(cli(["secret", "list"]));
const names = Array.isArray(inventory)
  ? inventory.map((entry) => entry.name).sort()
  : null;
if (JSON.stringify(names) !== JSON.stringify(expectedSecrets))
  throw new TypeError(
    "Notification secret inventory does not match the selected reviewed profile",
  );
const upload = cli([
  "versions",
  "upload",
  `--tag=${sha}`,
  `--message=slop.cash release ${sha}`,
]);
const matches = [
  ...upload.matchAll(/^Worker Version ID:\s*([0-9a-f-]+)\s*$/gmu),
];
if (
  matches.length !== 1 ||
  !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(matches[0][1])
)
  throw new TypeError("Upload did not return exactly one Worker version");
const versionId = matches[0][1];
const version = JSON.parse(cli(["versions", "view", versionId, "--json"]));
const bindings = version.resources?.bindings;
if (version.annotations?.["workers/tag"] !== sha || !Array.isArray(bindings))
  throw new TypeError("Uploaded version does not match the release SHA");
const inboxBinding = bindings.filter(
  (entry) => entry.name === "NOTIFY_INBOX_URL",
);
const tierBinding = bindings.filter(
  (entry) => entry.name === "SLOP_ENVIRONMENT",
);
const emailBinding = bindings.filter((entry) => entry.type === "send_email");
const generalBinding = bindings.filter(
  (entry) => entry.name === "NOTIFY_GENERAL_EMAIL_ENABLED",
);
if (
  generalBinding.length !== 1 ||
  generalBinding[0].type !== "plain_text" ||
  generalBinding[0].text !== String(generalEmail) ||
  tierBinding.length !== 1 ||
  tierBinding[0].type !== "plain_text" ||
  tierBinding[0].text !== target ||
  inboxBinding.length !== 1 ||
  inboxBinding[0].type !== "plain_text" ||
  inboxBinding[0].text !== config.vars.NOTIFY_INBOX_URL ||
  emailBinding.length !== 1 ||
  emailBinding[0].name !== "ADMIN_EMAIL" ||
  emailBinding[0].destination_address ||
  emailBinding[0].allowed_destination_addresses?.length
)
  throw new TypeError(
    "Uploaded environment, inbox URL or email binding does not match the selected profile",
  );
const deployedSecrets = bindings
  .filter((entry) => entry.type === "secret_text")
  .map((entry) => entry.name)
  .sort();
const deployedSlopbot = bindings.filter((entry) => entry.type === "service");
if (
  sendsSecurity
    ? deployedSlopbot.length !== 1 ||
      deployedSlopbot[0].name !== "SLOPBOT" ||
      deployedSlopbot[0].service !== slopbot[0].service
    : deployedSlopbot.length !== 0
)
  throw new TypeError(
    "Uploaded Slopbot binding does not match the selected profile",
  );
const deployedDatabase = bindings.filter((entry) => entry.type === "d1");
if (
  JSON.stringify(deployedSecrets) !== JSON.stringify(expectedSecrets) ||
  (hasDatabase
    ? deployedDatabase.length !== 1 ||
      deployedDatabase[0].name !== "SLOP_DB" ||
      deployedDatabase[0].id !== database[0].database_id
    : deployedDatabase.length !== 0)
)
  throw new TypeError(
    "Uploaded notification bindings do not match the selected profile",
  );
cli([
  "versions",
  "deploy",
  `--version-id=${versionId}`,
  "--percentage=100",
  `--message=slop.cash release ${sha}`,
  "--yes",
]);
const deployment = JSON.parse(cli(["deployments", "status", "--json"]));
if (
  deployment.versions?.length !== 1 ||
  deployment.versions[0].version_id !== versionId ||
  deployment.versions[0].percentage !== 100
)
  throw new TypeError(
    "Notification deployment is not pinned to the verified version",
  );
// Versions do not apply triggers. Only apply them after the exact version is active.
cli(["triggers", "deploy"]);
const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${name}/schedules`,
  {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  },
);
if (!response.ok)
  throw new Error(
    `Notification schedule verification failed (${response.status})`,
  );
const schedules = await response.json();
const actual = schedules.result?.schedules?.map((item) => item.cron).sort();
if (
  schedules.success !== true ||
  JSON.stringify(actual) !== JSON.stringify(config.triggers.crons)
)
  throw new TypeError(
    "Notification schedules do not match the selected profile",
  );
writeFileSync(
  resolve(directory, "release.json"),
  `${JSON.stringify({ target, name, sha, versionId, pilots, schedules: actual }, null, 2)}\n`,
);
console.log(
  `Verified ${name} version ${versionId} at ${sha}; scheduled delivery acceptance remains separate.`,
);
