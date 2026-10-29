/**
 * Read-only production watch (PRD sections 6 and 9). It checks that the public
 * site, identity, the registry API and the Slopbot Worker answer, and that every vault
 * registered in the D1 project registry has a cached finalized snapshot no
 * older than the staleAfterMs its own public response publishes. It uses no
 * credentials, never reads a chain RPC, and does not retry: one failed or slow
 * answer fails the run so the scheduled workflow reports it.
 */
import { appendFileSync } from "node:fs";
import { IDENTITY_PUBLIC_ORIGIN } from "../workers/identity/contracts";
import { mainnetExecutionEnabled } from "../workers/payment-executor/mainnet-execution.mjs";

export const SITE_ORIGIN = "https://slop.cash";
export const SLOPBOT_HEALTH_URL = "https://slopbot.slop.cash/health";
export const IDENTITY_PROBE_URL = `${IDENTITY_PUBLIC_ORIGIN}/v1/oauth/authorize`;
export const REQUEST_TIMEOUT_MS = 20_000;

export type RegisteredVault = {
  projectId: string;
  network: string;
  vault: string;
};
export type CheckResult = { ok: boolean; check: string; detail: string };
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** Every registered vault, read from the public registry body. */
export function registeredVaults(registry: unknown): RegisteredVault[] {
  const body = registry as {
    schemaVersion?: unknown;
    projects?: unknown;
  } | null;
  if (
    body?.schemaVersion !== "1" ||
    !Array.isArray(body.projects) ||
    body.projects.length === 0
  )
    throw new TypeError("Registry response has no projects");
  const vaults: RegisteredVault[] = [];
  for (const project of body.projects as {
    id?: unknown;
    escrow?: { deployments?: unknown };
  }[]) {
    if (typeof project?.id !== "string" || !project.id)
      throw new TypeError("Registry project has no id");
    const deployments = project.escrow?.deployments ?? [];
    if (!Array.isArray(deployments))
      throw new TypeError(
        `Registry project ${project.id} has invalid deployments`,
      );
    for (const deployment of deployments as {
      network?: unknown;
      vault?: unknown;
    }[]) {
      // The registry schema requires both on every deployment, so a deployment
      // without them is a malformed registry, never a vault to skip.
      if (
        typeof deployment?.vault !== "string" ||
        !deployment.vault ||
        typeof deployment.network !== "string" ||
        !deployment.network
      )
        throw new TypeError(
          `Registry project ${project.id} has a deployment without a vault or network`,
        );
      vaults.push({
        projectId: project.id,
        network: deployment.network,
        vault: deployment.vault,
      });
    }
  }
  return vaults;
}

function vaultLabel(expected: RegisteredVault) {
  return `vault ${expected.projectId} ${expected.network} ${expected.vault}`;
}

function minutes(ms: number) {
  return `${Math.round(ms / 60_000)} min`;
}

/**
 * Judge one registered vault against its project's public vault response.
 * A missing snapshot or observation time is a failure, never fresh or zero.
 * Only a network whose payout execution is activated has a refresher, so
 * only its snapshot must be younger than staleAfterMs; an inactive network
 * keeps its last finalized read, which the site labels outdated.
 */
export function evaluateVault(
  expected: RegisteredVault,
  response: unknown,
  now: Date,
): CheckResult {
  const check = vaultLabel(expected);
  const fail = (detail: string) => ({ ok: false, check, detail });
  const body = response as {
    projectId?: unknown;
    snapshots?: unknown;
    staleAfterMs?: unknown;
  } | null;
  const staleAfterMs = body?.staleAfterMs;
  if (
    typeof staleAfterMs !== "number" ||
    !Number.isSafeInteger(staleAfterMs) ||
    staleAfterMs <= 0
  )
    return fail("response publishes no staleAfterMs");
  if (body?.projectId !== expected.projectId || !Array.isArray(body.snapshots))
    return fail("response does not describe this project");
  const snapshot = (
    body.snapshots as {
      network?: unknown;
      vault?: unknown;
      observedAt?: unknown;
    }[]
  ).find(
    (item) =>
      item?.network === expected.network &&
      typeof item.vault === "string" &&
      // Case does not change an EVM hex address, so a checksummed spelling
      // still matches. Base58 vaults (Solana) are case-sensitive: a vault
      // that differs only by case is a different account, so it must not
      // stand in for the registered vault.
      (item.vault === expected.vault ||
        (expected.vault.startsWith("0x") &&
          item.vault.toLowerCase() === expected.vault.toLowerCase())),
  );
  if (!snapshot) return fail("no cached snapshot for this vault");
  const observedAt = snapshot.observedAt;
  const observed =
    typeof observedAt === "string" ? Date.parse(observedAt) : Number.NaN;
  if (!Number.isFinite(observed))
    return fail("snapshot has no observation time");
  const age = now.getTime() - observed;
  if (!mainnetExecutionEnabled(expected.network))
    return {
      ok: true,
      check,
      detail: `network not activated, no refresh expected; last observed ${observedAt}`,
    };
  const detail = `observed ${observedAt}, age ${minutes(age)} (limit ${minutes(staleAfterMs)})`;
  return age > staleAfterMs
    ? fail(`stale: ${detail}`)
    : { ok: true, check, detail };
}

type Answer =
  | { ok: false; detail: string }
  | { ok: true; detail: string; response: Response };

async function request(
  fetcher: Fetcher,
  url: string,
  timeoutMs: number,
  expectedStatus?: number,
): Promise<Answer> {
  const started = Date.now();
  let response: Response;
  try {
    response = await fetcher(url, {
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return {
      ok: false,
      detail:
        error instanceof Error && error.name === "TimeoutError"
          ? `timed out after ${timeoutMs} ms`
          : "request failed",
    };
  }
  const detail = `HTTP ${response.status} (${Date.now() - started} ms)`;
  const ok =
    expectedStatus === undefined
      ? response.ok
      : response.status === expectedStatus;
  return ok ? { ok: true, detail, response } : { ok: false, detail };
}

async function requestJson(
  fetcher: Fetcher,
  url: string,
  timeoutMs: number,
  expectedStatus?: number,
) {
  const answer = await request(fetcher, url, timeoutMs, expectedStatus);
  if (!answer.ok) return answer;
  try {
    return {
      ok: true as const,
      detail: answer.detail,
      body: (await answer.response.json()) as unknown,
    };
  } catch {
    return { ok: false as const, detail: `${answer.detail}, invalid JSON` };
  }
}

/** Run every check once, without retries, and return the per-check results. */
export async function runProductionWatch({
  fetcher = fetch,
  now = () => new Date(),
  origin = SITE_ORIGIN,
  slopbotHealthUrl = SLOPBOT_HEALTH_URL,
  identityProbeUrl = IDENTITY_PROBE_URL,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: {
  fetcher?: Fetcher;
  now?: () => Date;
  origin?: string;
  slopbotHealthUrl?: string;
  identityProbeUrl?: string;
  timeoutMs?: number;
} = {}): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const home = await request(fetcher, `${origin}/`, timeoutMs);
  results.push({ ok: home.ok, check: "site home", detail: home.detail });

  // With no flow or state, the existing OAuth route refuses before reading or
  // creating identity state. This probes the public Worker, not OAuth completion.
  const identity = await requestJson(fetcher, identityProbeUrl, timeoutMs, 400);
  results.push(
    identity.ok &&
      (identity.body as { error?: unknown } | null)?.error !== "invalid_request"
      ? {
          ok: false,
          check: "identity sign-in",
          detail: "identity did not return its invalid-link refusal",
        }
      : { ok: identity.ok, check: "identity sign-in", detail: identity.detail },
  );

  const slopbot = await requestJson(fetcher, slopbotHealthUrl, timeoutMs);
  results.push(
    slopbot.ok && (slopbot.body as { ok?: unknown } | null)?.ok !== true
      ? { ok: false, check: "slopbot health", detail: "health body is not ok" }
      : { ok: slopbot.ok, check: "slopbot health", detail: slopbot.detail },
  );

  const registry = await requestJson(
    fetcher,
    `${origin}/api/v1/projects`,
    timeoutMs,
  );
  if (!registry.ok) {
    results.push({ ok: false, check: "registry api", detail: registry.detail });
    return results;
  }
  let vaults: RegisteredVault[];
  try {
    vaults = registeredVaults(registry.body);
  } catch (error) {
    results.push({
      ok: false,
      check: "registry api",
      detail: error instanceof Error ? error.message : "invalid registry",
    });
    return results;
  }
  results.push({
    ok: true,
    check: "registry api",
    detail: `${registry.detail}, ${vaults.length} registered vaults`,
  });

  const responses = new Map<string, Awaited<ReturnType<typeof requestJson>>>();
  for (const expected of vaults) {
    let answer = responses.get(expected.projectId);
    if (!answer) {
      answer = await requestJson(
        fetcher,
        `${origin}/api/v1/payments/projects/${encodeURIComponent(expected.projectId)}/vault`,
        timeoutMs,
      );
      responses.set(expected.projectId, answer);
    }
    results.push(
      answer.ok
        ? evaluateVault(expected, answer.body, now())
        : { ok: false, check: vaultLabel(expected), detail: answer.detail },
    );
  }
  return results;
}

if (import.meta.main) {
  const results = await runProductionWatch();
  const actions = process.env.GITHUB_ACTIONS === "true";
  const lines = results.map(
    ({ ok, check, detail }) =>
      `${ok ? "ok" : actions ? "::error::FAIL" : "FAIL"} ${check}: ${detail}`,
  );
  const failed = results.filter((result) => !result.ok).length;
  lines.push(
    failed
      ? `${failed} of ${results.length} production checks failed`
      : `All ${results.length} production checks passed`,
  );
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `Production watch\n\n${lines.map((line) => `- ${line.replace("::error::", "")}`).join("\n")}\n`,
    );
  if (failed) process.exitCode = 1;
}
