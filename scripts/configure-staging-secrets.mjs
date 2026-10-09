/** Send the staging environment's secrets only to its own Cloudflare resources. */
import { execFileSync } from "node:child_process";

if (process.env.GITHUB_REF !== "refs/heads/development")
  throw new Error("Staging secret setup requires the development workflow");
const names = [
  "GITHUB_APP_CLIENT_ID",
  "GITHUB_APP_CLIENT_SECRET",
  "IDENTITY_STATE_KEY",
  "IDENTITY_ASSERTION_KEY",
];
const secrets = Object.fromEntries(
  names.map((name) => {
    const value = process.env[name];
    if (!value) throw new Error(`Missing staging ${name}`);
    return [name, value];
  }),
);
if (!process.env.TRACE_AUTH_SECRET)
  throw new Error("Missing staging trace key");
const run = (args, values) =>
  execFileSync("./node_modules/.bin/wrangler", args, {
    input: JSON.stringify(values),
    stdio: ["pipe", "inherit", "inherit"],
  });
run(
  ["secret", "bulk", "--config", "workers/identity/wrangler.staging.toml"],
  secrets,
);
run(["pages", "secret", "bulk", "--project-name", "slop-staging"], {
  TRACE_AUTH_SECRET: process.env.TRACE_AUTH_SECRET,
});
