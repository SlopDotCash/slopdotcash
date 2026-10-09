/** Verify a new preview deployment and its custom domain without production access. */

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { selectSuccessfulProductionDeployment } from "./select-pages-deployment.mjs";

const [commitHash, boundary] = process.argv.slice(2);
const notBefore = Number(boundary);
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token) throw new Error("Staging credentials are required");
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/slop-staging`;
const request = async (path) => {
  const response = await fetch(`${endpoint}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Cache-Control": "no-cache" },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error(`Cloudflare staging lookup: ${response.status}`);
  return response.json();
};
const project = await request("");
if (
  project.success !== true ||
  project.result?.production_branch !== "development"
)
  throw new Error("Staging requires the reviewed development branch");
let deployment;
for (let attempt = 0; attempt < 36; attempt++) {
  deployment = selectSuccessfulProductionDeployment(
    await request("/deployments?env=production&per_page=25"),
    {
      commitHash,
      notBefore,
      branch: "development",
      environment: "production",
      project: "slop-staging",
    },
  );
  if (deployment) break;
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
if (!deployment)
  throw new Error("No new successful exact-head staging deployment");
const domain = await request("/domains/staging.slop.cash");
if (domain.success !== true || domain.result?.status !== "active")
  throw new Error("Staging custom domain is not active");
for (const origin of [
  new URL(deployment.url).origin,
  "https://staging.slop.cash",
]) {
  execFileSync(
    "node",
    ["scripts/dist-manifest.mjs", "verify", "dist", origin, commitHash],
    {
      stdio: "inherit",
    },
  );
  const response = await fetch(origin, {
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error("Staging root is unavailable");
  for (const header of [
    "content-security-policy",
    "strict-transport-security",
    "x-content-type-options",
  ])
    if (!response.headers.has(header))
      throw new Error(`Staging omitted ${header}`);
}
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `Staging commit: ${commitHash}\n\nDeployment: ${deployment.url}\n\nVerified domain: https://staging.slop.cash\n`,
  );
