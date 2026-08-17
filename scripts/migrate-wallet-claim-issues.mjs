/**
 * Imports historical open GitHub wallet-claim issues into the authenticated,
 * append-only D1 registry. Planning is read-only. --execute performs the D1
 * import after operator OAuth; --close closes only claims whose public D1
 * receipt was fetched and byte-checked after creation.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { PROJECTS } from "../src/lib/projects.mjs";
import { parsePublishedWallet } from "../src/lib/wallets.ts";

const REPOSITORY = "elizaOS/slopdotcash";
const API_ORIGIN = "https://api.slop.cash";
const TITLE = "Slop wallet claim";
const MAX_CLAIMS = 100;

function argumentsFor(values) {
  const unknown = values.filter(
    (value) => !["--execute", "--close"].includes(value),
  );
  if (unknown.length > 0)
    throw new TypeError(`Unknown argument: ${unknown[0]}`);
  const execute = values.includes("--execute");
  const close = values.includes("--close");
  if (close && !execute) throw new TypeError("--close requires --execute");
  return { close, execute };
}

function githubJson(path, fields = []) {
  const source = execFileSync("gh", ["api", "-X", "GET", path, ...fields], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  return JSON.parse(source);
}

function claimFromIssue(issue) {
  const published = parsePublishedWallet(issue.body);
  if (
    issue.state !== "open" ||
    issue.title !== TITLE ||
    "pull_request" in issue ||
    !published ||
    !Number.isSafeInteger(issue.number) ||
    issue.number < 1 ||
    !Number.isSafeInteger(issue.user?.id) ||
    issue.user.id < 1 ||
    typeof issue.user.login !== "string" ||
    typeof issue.updated_at !== "string" ||
    !Number.isFinite(Date.parse(issue.updated_at)) ||
    issue.html_url !== `https://github.com/${REPOSITORY}/issues/${issue.number}`
  ) {
    throw new TypeError(
      `Wallet issue #${issue.number ?? "unknown"} is invalid`,
    );
  }
  return {
    address: published.address,
    githubActorId: String(issue.user.id),
    githubLogin: issue.user.login,
    issueNumber: issue.number,
    observedAt: issue.updated_at,
    sourceBodySha256: createHash("sha256").update(issue.body).digest("hex"),
    sourceUrl: issue.html_url,
  };
}

function claimsFromGithub() {
  const response = githubJson(`/repos/${REPOSITORY}/issues`, [
    "-f",
    "state=open",
    "-f",
    "per_page=100",
  ]);
  if (!Array.isArray(response) || response.length >= MAX_CLAIMS) {
    throw new RangeError("Wallet migration reached its bounded issue limit");
  }
  return response
    .filter((issue) => issue.title === TITLE && !("pull_request" in issue))
    .map(claimFromIssue);
}

function currentClaimFromGithub(issueNumber) {
  return claimFromIssue(
    githubJson(`/repos/${REPOSITORY}/issues/${issueNumber}`),
  );
}

function sameClaimSource(left, right) {
  return (
    left.address === right.address &&
    left.githubActorId === right.githubActorId &&
    left.githubLogin.toLowerCase() === right.githubLogin.toLowerCase() &&
    left.issueNumber === right.issueNumber &&
    left.observedAt === right.observedAt &&
    left.sourceBodySha256 === right.sourceBodySha256 &&
    left.sourceUrl === right.sourceUrl
  );
}

async function responseJson(response, field) {
  const maximumBytes = 64 * 1024;
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!/^\d+$/u.test(declaredLength) || !Number.isSafeInteger(parsedLength)) {
      throw new Error(`${field} response declared an invalid length`);
    }
    if (parsedLength > maximumBytes) {
      throw new Error(`${field} response exceeded its bound`);
    }
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`${field} response omitted its body`);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteLength = 0;
  let source = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel(`${field} response exceeded its bound`);
        throw new Error(`${field} response exceeded its bound`);
      }
      source += decoder.decode(chunk.value, { stream: true });
    }
    source += decoder.decode();
    return JSON.parse(source);
  } catch (error) {
    if (error instanceof Error && /exceeded its bound/u.test(error.message)) {
      throw error;
    }
    throw new Error(`${field} response was not JSON`);
  } finally {
    reader.releaseLock();
  }
}

async function operatorToken(fetchImpl) {
  const rootPublishedProjects = PROJECTS.filter(
    (project) => project.skill.publishAtRoot,
  );
  if (rootPublishedProjects.length !== 1) {
    throw new TypeError(
      "Wallet migration requires exactly one root-published project skill",
    );
  }
  const identityClient = await import(
    `../${rootPublishedProjects[0].skill.sourcePath}/scripts/run-receipt.mjs`
  );
  if (typeof identityClient.slopIdentityAssertion !== "function") {
    throw new TypeError(
      "Root-published project skill omitted the Slop identity client",
    );
  }
  let assertion = await identityClient.slopIdentityAssertion(fetchImpl);
  const response = await fetchImpl(`${API_ORIGIN}/api/v1/auth/session`, {
    method: "POST",
    headers: { "X-Slop-Identity-Assertion": assertion },
    signal: AbortSignal.timeout(30_000),
  });
  assertion = "";
  if (!response.ok)
    throw new Error(`Operator authentication returned HTTP ${response.status}`);
  const body = await responseJson(response, "Operator authentication");
  if (
    body.tokenType !== "Bearer" ||
    typeof body.token !== "string" ||
    body.token.length < 20 ||
    body.token.length > 4096
  ) {
    throw new Error("Operator authentication returned invalid credentials");
  }
  return body.token;
}

function validateReceipt(value, source) {
  if (
    typeof value !== "object" ||
    value === null ||
    value.schemaVersion !== 1 ||
    value.githubActorId !== source.githubActorId ||
    typeof value.githubLogin !== "string" ||
    value.githubLogin.toLowerCase() !== source.githubLogin.toLowerCase() ||
    value.address !== source.address ||
    value.source !== "github_issue" ||
    value.issueRepository !== REPOSITORY ||
    value.issueNumber !== source.issueNumber ||
    value.sourceBodySha256 !== source.sourceBodySha256 ||
    value.observedAt !== source.observedAt ||
    typeof value.claimId !== "string" ||
    !/^[A-Za-z0-9_-]+$/u.test(value.claimId) ||
    typeof value.recordDigest !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.recordDigest)
  ) {
    throw new Error(
      `D1 receipt for issue #${source.issueNumber} did not match`,
    );
  }
  return value;
}

async function migrate(source, token, fetchImpl) {
  const response = await fetchImpl(
    `${API_ORIGIN}/api/v1/operator/wallet-claims`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        address: source.address,
        githubActorId: source.githubActorId,
        githubLogin: source.githubLogin,
        issueNumber: source.issueNumber,
        issueRepository: REPOSITORY,
        observedAt: source.observedAt,
        source: "github_issue",
        sourceBodySha256: source.sourceBodySha256,
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `D1 import for issue #${source.issueNumber} returned HTTP ${response.status}`,
    );
  }
  const created = validateReceipt(
    await responseJson(response, `D1 import #${source.issueNumber}`),
    source,
  );
  const receipt = await fetchImpl(
    `${API_ORIGIN}/api/v1/wallet-claims/${created.claimId}`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (!receipt.ok) {
    throw new Error(
      `Public receipt for issue #${source.issueNumber} returned HTTP ${receipt.status}`,
    );
  }
  return validateReceipt(
    await responseJson(receipt, `Public receipt #${source.issueNumber}`),
    source,
  );
}

export async function main(values = process.argv.slice(2), options = {}) {
  const parsed = argumentsFor(values);
  const sources = (options.claims ?? claimsFromGithub()).sort(
    (left, right) => left.issueNumber - right.issueNumber,
  );
  if (!parsed.execute) {
    process.stdout.write(
      `${JSON.stringify({ execute: false, claims: sources }, null, 2)}\n`,
    );
    return;
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  let token = await (options.tokenProvider ?? operatorToken)(fetchImpl);
  const migrated = [];
  for (const source of sources) {
    const receipt = await migrate(source, token, fetchImpl);
    migrated.push({
      address: receipt.address,
      claimId: receipt.claimId,
      issueNumber: source.issueNumber,
      recordDigest: receipt.recordDigest,
    });
    if (parsed.close && options.closeIssue !== false) {
      const refreshed = await (options.refreshClaim ?? currentClaimFromGithub)(
        source.issueNumber,
      );
      if (!sameClaimSource(source, refreshed)) {
        throw new Error(
          `Wallet issue #${source.issueNumber} changed after migration; refusing closure`,
        );
      }
      execFileSync(
        "gh",
        [
          "issue",
          "close",
          String(source.issueNumber),
          "--repo",
          REPOSITORY,
          "--reason",
          "completed",
          "--comment",
          `Migrated to Slop's authenticated append-only wallet registry.\n\n- Claim: ${API_ORIGIN}/api/v1/wallet-claims/${receipt.claimId}\n- Record digest: \`${receipt.recordDigest}\`\n\nThis issue is no longer a live payout authority. Future address changes append a superseding D1 record after one-time GitHub OAuth.`,
        ],
        { stdio: "inherit" },
      );
    }
  }
  token = "";
  process.stdout.write(
    `${JSON.stringify({ execute: true, migrated }, null, 2)}\n`,
  );
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `[Slop] wallet issue migration refused: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  }
}
