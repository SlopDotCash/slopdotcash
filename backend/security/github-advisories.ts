/**
 * GitHub private vulnerability reporting for automatic private intake (PRD
 * section 8, SEC-07, SEC-17). The reporter's own submission uses the
 * reporter's user access token, so GitHub records the reporter as the
 * author. Slop holds no user token beyond the request. The slopdotcash App
 * (owner decision D10: App 5257625, no separate intake App) never files an
 * advisory; its installation token only reads private reports through
 * `githubAppAdvisoryToken`. Report content is sent, digested and dropped: nothing
 * here logs, and results carry only typed enum values and identifiers.
 */

import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { readBoundedJson } from "../../src/lib/browser-json";
import { canonicalJson } from "../../src/lib/canonical-json";
import { GHSA, githubAppJwt, githubHeaders, nextLink } from "../github";
import { fail } from "../http";
import type { ReportingReader } from "./reporting-readiness";

export type FailureCode =
  | "pvr-disabled"
  | "app-not-installed"
  | "forbidden"
  | "invalid"
  | "author-mismatch"
  | "not-found"
  | "grant-expired"
  | "already-recorded"
  | "not-private-report"
  | "unverifiable";

declare const reporterGrantBrand: unique symbol;
/** A user access token that `/user` proved belongs to `githubId`. */
export type ReporterGrant = {
  readonly token: string;
  readonly githubId: string;
  readonly [reporterGrantBrand]: true;
};

/** Only the grant module and tests mint a grant, after the identity check. */
export function reporterGrant(token: string, githubId: string): ReporterGrant {
  return { token, githubId } as ReporterGrant;
}

export type ReportInput = {
  readonly summary: string;
  readonly description: string;
  readonly severity?: "critical" | "high" | "medium" | "low";
  readonly cvssVectorString?: string;
  readonly cweIds?: readonly string[];
  readonly vulnerabilities?: readonly {
    readonly package: { readonly ecosystem: string; readonly name?: string };
    readonly vulnerableVersionRange?: string;
    readonly patchedVersions?: string;
  }[];
};

/** Report content held in memory for the private analyzer; never stored. */
export type AnalysisInput = {
  readonly summary: string;
  readonly description: string;
  readonly severity?: string;
  readonly cvss?: string;
  readonly cweIds?: string[];
};

export type AdvisoryFacts = {
  ghsa: string;
  repository: string;
  authorId: string | null;
  /**
   * Whether GitHub says the advisory arrived through private vulnerability
   * reporting (its `submission` object). A repository advisory a maintainer
   * drafted has none.
   */
  privateReport: boolean;
  state: string;
  createdAt: string;
  markerFound: boolean;
  evidenceDigest: string;
  /** In memory only, for the private analyzer. Never persisted or logged. */
  analysisInput: AnalysisInput;
};

export interface PrivateAdvisoryClient {
  currentUser(
    grant: ReporterGrant,
  ): Promise<{ ok: true; id: string; login: string } | { ok: false }>;
  createReport(
    grant: ReporterGrant,
    repository: string,
    report: ReportInput,
    marker: string,
  ): Promise<
    | { kind: "created"; facts: AdvisoryFacts }
    | { kind: "rejected"; code: FailureCode }
    | { kind: "rate-limited"; retryAfterSeconds: number | null }
    | { kind: "uncertain" }
  >;
  getAdvisory(
    grant: ReporterGrant,
    repository: string,
    ghsa: string,
    marker?: string,
  ): Promise<
    | { kind: "found"; facts: AdvisoryFacts }
    | { kind: "not-found" }
    | { kind: "error" }
  >;
  findByMarker(
    grant: ReporterGrant,
    repository: string,
    marker: string,
    since: string,
  ): Promise<
    { kind: "complete"; matches: AdvisoryFacts[] } | { kind: "error" }
  >;
}

export interface IntakeInstallationCheck {
  installed(repository: string): Promise<"yes" | "no" | "unknown">;
}

const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const CVSS =
  /^CVSS:(?:3\.[01]|4\.0)\/[A-Z]{1,3}:[A-Z](?:\/[A-Z]{1,3}:[A-Z])*$/u;
const CWE = /^CWE-[1-9]\d{0,4}$/u;
const ECOSYSTEMS = [
  "rubygems",
  "npm",
  "pip",
  "maven",
  "nuget",
  "composer",
  "go",
  "rust",
  "erlang",
  "actions",
  "pub",
  "other",
  "swift",
] as const;
const MAX_ADVISORY_BYTES = 1024 * 1024;
const MAX_LIST_BYTES = 8 * 1024 * 1024;
const MAX_LIST_PAGES = 10;

/**
 * The one line appended to the private GitHub description (OPEN_QUESTION 9).
 * It stays in the text if the maintainers later publish the advisory, so it
 * carries only the submission's random 128-bit marker: no Slop submission
 * ID and no Slop name.
 */
export function markerLine(marker: string): string {
  return `Report reference: ${marker}`;
}

function bounded(value: unknown, key: string, min: number, max: number) {
  if (typeof value !== "string") fail(400, "invalid_report", `Invalid ${key}`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max)
    fail(400, "invalid_report", `${key} must be ${min} to ${max} characters`);
  return trimmed;
}

/**
 * Validates report fields on the server. Error messages name the field and
 * never echo its content.
 */
export function parseReportInput(value: unknown): ReportInput {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail(400, "invalid_report", "Invalid report");
  const body = value as Record<string, unknown>;
  const allowed = new Set([
    "summary",
    "description",
    "severity",
    "cvssVectorString",
    "cweIds",
    "vulnerabilities",
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key)))
    fail(400, "invalid_report", "Report has unexpected fields");
  const summary = bounded(body.summary, "summary", 8, 1024);
  const description = bounded(body.description, "description", 20, 65_000);
  const report: {
    -readonly [K in keyof ReportInput]: ReportInput[K];
  } = { summary, description };
  if (body.severity !== undefined && body.cvssVectorString !== undefined)
    fail(400, "invalid_report", "Give a severity or a CVSS vector, not both");
  if (body.severity !== undefined) {
    if (!SEVERITIES.includes(body.severity as (typeof SEVERITIES)[number]))
      fail(400, "invalid_report", "Invalid severity");
    report.severity = body.severity as (typeof SEVERITIES)[number];
  }
  if (body.cvssVectorString !== undefined) {
    if (
      typeof body.cvssVectorString !== "string" ||
      body.cvssVectorString.length > 200 ||
      !CVSS.test(body.cvssVectorString)
    )
      fail(400, "invalid_report", "Invalid cvssVectorString");
    report.cvssVectorString = body.cvssVectorString;
  }
  if (body.cweIds !== undefined) {
    if (
      !Array.isArray(body.cweIds) ||
      body.cweIds.length > 10 ||
      body.cweIds.some((id) => typeof id !== "string" || !CWE.test(id))
    )
      fail(400, "invalid_report", "Invalid cweIds");
    report.cweIds = [...new Set(body.cweIds as string[])];
  }
  if (body.vulnerabilities !== undefined) {
    if (
      !Array.isArray(body.vulnerabilities) ||
      body.vulnerabilities.length > 20
    )
      fail(400, "invalid_report", "Invalid vulnerabilities");
    report.vulnerabilities = body.vulnerabilities.map((entry) => {
      if (typeof entry !== "object" || entry === null)
        fail(400, "invalid_report", "Invalid vulnerabilities");
      const item = entry as Record<string, unknown>;
      const pkg = item.package as Record<string, unknown> | undefined;
      if (
        typeof pkg !== "object" ||
        pkg === null ||
        !ECOSYSTEMS.includes(pkg.ecosystem as (typeof ECOSYSTEMS)[number]) ||
        (pkg.name !== undefined &&
          (typeof pkg.name !== "string" ||
            pkg.name.length < 1 ||
            pkg.name.length > 214))
      )
        fail(400, "invalid_report", "Invalid vulnerabilities");
      const optional = (key: string) => {
        if (item[key] === undefined) return undefined;
        if (typeof item[key] !== "string" || (item[key] as string).length > 256)
          fail(400, "invalid_report", "Invalid vulnerabilities");
        return item[key] as string;
      };
      return {
        package: {
          ecosystem: pkg.ecosystem as string,
          ...(pkg.name === undefined ? {} : { name: pkg.name as string }),
        },
        ...(optional("vulnerableVersionRange") === undefined
          ? {}
          : { vulnerableVersionRange: optional("vulnerableVersionRange") }),
        ...(optional("patchedVersions") === undefined
          ? {}
          : { patchedVersions: optional("patchedVersions") }),
      };
    });
  }
  return report;
}

function githubId(value: unknown): string | null {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? String(value)
    : null;
}

/**
 * Reduces a GitHub repository advisory to the facts Slop checks. The body is
 * digested, then dropped; only `analysisInput` stays in memory for the
 * private analyzer. Returns null for anything malformed.
 */
async function advisoryFacts(
  value: unknown,
  marker?: string,
): Promise<AdvisoryFacts | null> {
  if (typeof value !== "object" || value === null) return null;
  const advisory = value as Record<string, unknown>;
  const ghsa = advisory.ghsa_id;
  if (typeof ghsa !== "string" || !GHSA.test(ghsa)) return null;
  let repository: string;
  try {
    const url = new URL(String(advisory.html_url));
    const parts = url.pathname.split("/").filter(Boolean);
    if (
      url.protocol !== "https:" ||
      parts.length !== 5 ||
      parts[2] !== "security" ||
      parts[3] !== "advisories" ||
      parts[4] !== ghsa
    )
      return null;
    repository = `${parts[0]}/${parts[1]}`;
  } catch {
    return null;
  }
  const createdAt = advisory.created_at;
  if (typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt)))
    return null;
  const summary = typeof advisory.summary === "string" ? advisory.summary : "";
  const description =
    typeof advisory.description === "string" ? advisory.description : "";
  const severity =
    typeof advisory.severity === "string" ? advisory.severity : undefined;
  const cvssVector = (advisory.cvss as { vector_string?: unknown } | null)
    ?.vector_string;
  const cvss = typeof cvssVector === "string" ? cvssVector : undefined;
  const cweIds = Array.isArray(advisory.cwe_ids)
    ? advisory.cwe_ids.filter((id): id is string => typeof id === "string")
    : [];
  // Credits are editable by maintainers and collaborators, so they never
  // establish authorship (SEC-17); only `author` does.
  return {
    ghsa,
    repository,
    authorId: githubId((advisory.author as { id?: unknown } | null)?.id),
    privateReport:
      typeof advisory.submission === "object" && advisory.submission !== null,
    state: typeof advisory.state === "string" ? advisory.state : "unknown",
    createdAt: new Date(Date.parse(createdAt)).toISOString(),
    markerFound:
      marker !== undefined &&
      description.split(/\r?\n/u).some((line) => line.trim() === marker),
    evidenceDigest: await sha256Hex(
      canonicalJson({
        summary,
        description,
        severity: severity ?? null,
        cvss: cvss ?? null,
        cwe_ids: cweIds,
        vulnerabilities: advisory.vulnerabilities ?? null,
      }),
    ),
    analysisInput: { summary, description, severity, cvss, cweIds },
  };
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const USER_AGENT = "slop.cash-private-intake";

function sameRepository(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function repositoryPath(repository: string): string {
  const [owner, name] = repository.split("/");
  return `${encodeURIComponent(owner ?? "")}/${encodeURIComponent(name ?? "")}`;
}

/** The longest wait the client reports from GitHub's rate-limit headers. */
const MAX_RETRY_AFTER_SECONDS = 60 * 60;
/** The bytes read from a 403 body to find a rate-limit message. */
const MAX_REFUSAL_BYTES = 16 * 1024;

/**
 * GitHub answers a primary or secondary rate limit with 429, or with 403 and
 * `x-ratelimit-remaining: 0`, a `retry-after` header, or a message that names
 * the rate limit. Any other 403 is a refusal of the account. This reads the
 * body of a 403 only.
 */
async function rateLimited(response: Response): Promise<boolean> {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;
  if (
    response.headers.get("x-ratelimit-remaining") === "0" ||
    response.headers.get("retry-after") !== null
  )
    return true;
  try {
    const body = (await readBoundedJson(
      response,
      MAX_REFUSAL_BYTES,
      "GitHub",
    )) as { message?: unknown } | null;
    return (
      typeof body?.message === "string" && /rate limit/iu.test(body.message)
    );
  } catch {
    return false;
  }
}

/** Seconds until GitHub accepts a request again, when GitHub says so. */
function retryAfterSeconds(response: Response, now: number): number | null {
  const header = response.headers.get("retry-after");
  let seconds: number | null = null;
  if (header !== null && /^\d{1,6}$/u.test(header.trim()))
    seconds = Number(header.trim());
  else if (response.headers.get("x-ratelimit-remaining") === "0") {
    const reset = response.headers.get("x-ratelimit-reset");
    if (reset !== null && /^\d{1,12}$/u.test(reset.trim()))
      seconds = Math.max(0, Math.ceil(Number(reset.trim()) - now / 1000));
  }
  return seconds === null ? null : Math.min(seconds, MAX_RETRY_AFTER_SECONDS);
}

/**
 * The real GitHub client. Its exact response shapes are not yet qualified
 * against GitHub (OPEN_QUESTION 2), so anything outside the mapped statuses
 * is treated as uncertain and reconciled before any retry.
 */
export function githubAdvisoryClient(options: {
  fetch: Fetch;
  apiOrigin: string;
  installation: IntakeInstallationCheck;
  /** The clock for GitHub's rate-limit reset time. Tests give their own. */
  now?: () => Date;
}): PrivateAdvisoryClient {
  const now = options.now ?? (() => new Date());
  const request = (url: string, token: string, init: RequestInit = {}) =>
    options.fetch(url, {
      ...init,
      headers: {
        ...githubHeaders(token, USER_AGENT),
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
  return {
    async currentUser(grant) {
      try {
        const response = await request(
          `${options.apiOrigin}/user`,
          grant.token,
        );
        if (response.status !== 200) return { ok: false };
        const user = (await readBoundedJson(response, 64 * 1024, "GitHub")) as {
          id?: unknown;
          login?: unknown;
        };
        const id = githubId(user?.id);
        if (
          id === null ||
          typeof user.login !== "string" ||
          !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(user.login)
        )
          return { ok: false };
        return { ok: true, id, login: user.login };
      } catch {
        return { ok: false };
      }
    },
    async createReport(grant, repository, report, marker) {
      const body = {
        summary: report.summary,
        description: `${report.description}\n\n${marker}`,
        ...(report.severity ? { severity: report.severity } : {}),
        ...(report.cvssVectorString
          ? { cvss_vector_string: report.cvssVectorString }
          : {}),
        ...(report.cweIds ? { cwe_ids: report.cweIds } : {}),
        ...(report.vulnerabilities
          ? {
              vulnerabilities: report.vulnerabilities.map((entry) => ({
                package: entry.package,
                ...(entry.vulnerableVersionRange
                  ? { vulnerable_version_range: entry.vulnerableVersionRange }
                  : {}),
                ...(entry.patchedVersions
                  ? { patched_versions: entry.patchedVersions }
                  : {}),
              })),
            }
          : {}),
        start_private_fork: false,
      };
      let response: Response;
      try {
        response = await request(
          `${options.apiOrigin}/repos/${repositoryPath(repository)}/security-advisories/reports`,
          grant.token,
          { method: "POST", body: JSON.stringify(body) },
        );
      } catch {
        return { kind: "uncertain" };
      }
      if (response.status === 201) {
        try {
          const facts = await advisoryFacts(
            await readBoundedJson(response, MAX_ADVISORY_BYTES, "GitHub"),
            marker,
          );
          // A 201 counts only when it names this repository and this author.
          if (
            facts === null ||
            !sameRepository(facts.repository, repository) ||
            facts.authorId !== grant.githubId
          )
            return { kind: "uncertain" };
          return { kind: "created", facts };
        } catch {
          return { kind: "uncertain" };
        }
      }
      // GitHub refuses a throttled request before it creates anything. A
      // throttle is not a refusal of the account, so it never becomes
      // `forbidden`.
      if (await rateLimited(response))
        return {
          kind: "rate-limited",
          retryAfterSeconds: retryAfterSeconds(response, now().getTime()),
        };
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 401)
        return { kind: "rejected", code: "grant-expired" };
      if (response.status === 403)
        return { kind: "rejected", code: "forbidden" };
      if (response.status === 422) return { kind: "rejected", code: "invalid" };
      if (response.status === 404)
        return {
          kind: "rejected",
          code:
            (await options.installation.installed(repository)) === "no"
              ? "app-not-installed"
              : "pvr-disabled",
        };
      return { kind: "uncertain" };
    },
    async getAdvisory(grant, repository, ghsa, marker) {
      if (!GHSA.test(ghsa)) return { kind: "not-found" };
      try {
        const response = await request(
          `${options.apiOrigin}/repos/${repositoryPath(repository)}/security-advisories/${ghsa}`,
          grant.token,
        );
        if (response.status === 404) {
          await response.body?.cancel().catch(() => undefined);
          return { kind: "not-found" };
        }
        if (response.status !== 200) {
          await response.body?.cancel().catch(() => undefined);
          return { kind: "error" };
        }
        const facts = await advisoryFacts(
          await readBoundedJson(response, MAX_ADVISORY_BYTES, "GitHub"),
          marker,
        );
        if (facts === null || facts.ghsa !== ghsa) return { kind: "error" };
        return { kind: "found", facts };
      } catch {
        return { kind: "error" };
      }
    },
    async findByMarker(grant, repository, marker, since) {
      const sinceTime = Date.parse(since);
      const first = new URL(
        `${options.apiOrigin}/repos/${repositoryPath(repository)}/security-advisories`,
      );
      first.searchParams.set("sort", "created");
      first.searchParams.set("direction", "desc");
      first.searchParams.set("per_page", "100");
      let next: URL | null = first;
      const matches: AdvisoryFacts[] = [];
      try {
        for (let page = 0; next !== null; page += 1) {
          if (page >= MAX_LIST_PAGES) return { kind: "error" };
          const response = await request(next.href, grant.token);
          if (response.status !== 200) {
            await response.body?.cancel().catch(() => undefined);
            return { kind: "error" };
          }
          const link = response.headers.get("link");
          const items = await readBoundedJson(
            response,
            MAX_LIST_BYTES,
            "GitHub",
          );
          if (!Array.isArray(items)) return { kind: "error" };
          let reachedSince = false;
          for (const item of items) {
            const facts = await advisoryFacts(item, marker);
            if (facts === null) return { kind: "error" };
            if (Date.parse(facts.createdAt) < sinceTime) {
              reachedSince = true;
              continue;
            }
            if (
              facts.markerFound &&
              facts.authorId === grant.githubId &&
              sameRepository(facts.repository, repository)
            )
              matches.push(facts);
          }
          if (reachedSince) break;
          const continued = nextPage(link, first);
          // A next link we will not follow is not the end of the list.
          // An empty complete list lets reconcile send the report again.
          if (continued === "refused") return { kind: "error" };
          next = continued;
        }
      } catch {
        return { kind: "error" };
      }
      return { kind: "complete", matches };
    },
  };
}

/**
 * The next page of this security-advisory list.
 * `null` means the header has no `rel="next"`.
 * `"refused"` means a next link is present but is not a continuation of
 * this list. GitHub rewrites `/repos/{owner}/{repo}/security-advisories`
 * to `/repositories/{id}/security-advisories` in that header.
 */
function nextPage(link: string | null, first: URL): URL | null | "refused" {
  const target = nextLink(link);
  if (target === null) return null;
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return "refused";
  }
  if (url.origin !== first.origin) return "refused";
  if (url.pathname === first.pathname) return url;
  if (acceptableRepositoryContinuation(first, url)) return url;
  return "refused";
}

function acceptableRepositoryContinuation(first: URL, next: URL): boolean {
  return (
    first.pathname.endsWith("/security-advisories") &&
    /^\/repositories\/[1-9]\d{0,19}\/security-advisories$/u.test(next.pathname)
  );
}

/** The slopdotcash GitHub App (owner decision D10: App 5257625). */
type AppCredentials = {
  fetch: Fetch;
  apiOrigin: string;
  appId: string;
  privateKey: string;
  now: () => Date;
};

/** The App installation on a repository, with the App JWT that found it. */
async function repositoryInstallation(
  options: AppCredentials,
  repository: string,
): Promise<
  { state: "yes"; id: string; jwt: string } | { state: "no" | "unknown" }
> {
  try {
    const jwt = await githubAppJwt(
      options.appId,
      options.privateKey,
      options.now(),
    );
    const response = await options.fetch(
      `${options.apiOrigin}/repos/${repositoryPath(repository)}/installation`,
      {
        headers: githubHeaders(jwt, USER_AGENT),
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      return { state: response.status === 404 ? "no" : "unknown" };
    }
    const body = (await readBoundedJson(response, 64 * 1024, "GitHub")) as {
      id?: unknown;
    };
    const id = githubId(body?.id);
    return id === null ? { state: "unknown" } : { state: "yes", id, jwt };
  } catch {
    return { state: "unknown" };
  }
}

/**
 * Whether the slopdotcash App is installed on the program repository. Uses
 * the App JWT for repository installation metadata only.
 */
export function githubInstallationCheck(
  options: AppCredentials,
): IntakeInstallationCheck {
  return {
    async installed(repository) {
      return (await repositoryInstallation(options, repository)).state;
    },
  };
}

/**
 * A short-lived installation token of the slopdotcash App, narrowed to one
 * repository and to "Repository security advisories: read" (owner decision
 * D10). It reads private reports to verify receipt and to run the private
 * analysis; it never files, changes or publishes an advisory. Null when the
 * App is not installed or GitHub refuses: the caller treats that as
 * unavailable, never as "no report".
 */
export function githubAppAdvisoryToken(
  options: AppCredentials,
): (repository: string) => Promise<string | null> {
  return async (repository) => {
    const installation = await repositoryInstallation(options, repository);
    if (installation.state !== "yes") return null;
    try {
      const response = await options.fetch(
        `${options.apiOrigin}/app/installations/${installation.id}/access_tokens`,
        {
          method: "POST",
          headers: {
            ...githubHeaders(installation.jwt, USER_AGENT),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            repositories: [repository.split("/")[1]],
            permissions: { repository_advisories: "read" },
          }),
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (response.status !== 201) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }
      const body = (await readBoundedJson(response, 64 * 1024, "GitHub")) as {
        token?: unknown;
      };
      // Installation tokens are opaque and can exceed 255 characters. The
      // response is bounded above; exclude whitespace/control bytes from headers.
      return typeof body?.token === "string" && /^[!-~]+$/u.test(body.token)
        ? body.token
        : null;
    } catch {
      return null;
    }
  };
}

/** Safe repository facts only; no advisory body is requested by this reader. */
export function githubAppReportingReader(
  options: AppCredentials,
): ReportingReader {
  const installation = githubInstallationCheck(options);
  const tokenFor = githubAppAdvisoryToken(options);
  return async (target) => {
    try {
      const installed = await installation.installed(target.repository);
      if (installed !== "yes")
        return {
          kind: installed === "no" ? "app-not-installed" : "unavailable",
        };
      const token = await tokenFor(target.repository);
      if (token === null) return { kind: "unavailable" };
      const get = (suffix: string) =>
        options.fetch(
          `${options.apiOrigin}/repos/${repositoryPath(target.repository)}${suffix}`,
          {
            headers: githubHeaders(token, USER_AGENT),
            redirect: "manual",
            signal: AbortSignal.timeout(10_000),
          },
        );
      const repository = await get("");
      if (!repository.ok) {
        await repository.body?.cancel();
        return { kind: "unavailable" };
      }
      const facts = (await readBoundedJson(
        repository,
        64 * 1024,
        "GitHub",
      )) as {
        id?: unknown;
        node_id?: unknown;
        full_name?: unknown;
      };
      const id = githubId(facts.id);
      if (
        id === null ||
        typeof facts.node_id !== "string" ||
        !/^[A-Za-z0-9_=-]{4,256}$/u.test(facts.node_id) ||
        typeof facts.full_name !== "string" ||
        facts.full_name.toLowerCase() !== target.repository.toLowerCase() ||
        (target.repositoryId !== null && id !== target.repositoryId) ||
        (target.repositoryNodeId !== null &&
          facts.node_id !== target.repositoryNodeId)
      )
        return { kind: "identity-mismatch" };
      const response = await get("/private-vulnerability-reporting");
      if (!response.ok) {
        await response.body?.cancel();
        return { kind: "unavailable" };
      }
      const value = (await readBoundedJson(response, 64 * 1024, "GitHub")) as {
        enabled?: unknown;
      };
      if (typeof value.enabled !== "boolean") return { kind: "unavailable" };
      return {
        kind: "verified",
        enabled: value.enabled,
        repositoryId: id,
        repositoryNodeId: facts.node_id,
      };
    } catch {
      return { kind: "unavailable" };
    }
  };
}
