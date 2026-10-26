import { readBoundedJson } from "../../src/lib/browser-json";

/**
 * Reads a program repository's GitHub private vulnerability reports (PRD
 * section 8, MVP-13). This is how Slop verifies receipt without a person:
 * GitHub states who submitted each report and when it received it.
 *
 * GitHub's REST API serves unpublished repository advisories only to a token
 * with the "Repository security advisories" read permission on that
 * repository (a GitHub App installation or user access token, or a classic
 * token with `repo`/`repository_advisories:read`). The reader never writes,
 * never submits on anyone's behalf, and never returns report text to a
 * caller other than the private analysis.
 */

export type GithubPrivateReport = {
  ghsa: string;
  /** GitHub's own creation time of the report: the receipt time. */
  createdAt: string;
  state: string;
  author: { githubId: string; githubLogin: string };
  summary: string;
  description: string;
  severity: string | null;
  cweIds: string[];
  packages: string[];
};

export type PrivateReportList =
  | { state: "ok"; reports: GithubPrivateReport[] }
  | { state: "unavailable" };

export type PrivateReportLookup =
  | { state: "found"; report: GithubPrivateReport }
  | { state: "unavailable" };

export type AdvisoryReader = {
  /** Every private vulnerability report in the repository, oldest first. */
  privateReports(repository: string): Promise<PrivateReportList>;
  privateReport(repository: string, ghsa: string): Promise<PrivateReportLookup>;
};

const GHSA =
  /^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/u;
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
const REPOSITORY = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/u;
/** A transport bound, not a policy: GitHub pages hold at most 100 rows. */
const MAX_PAGES = 20;
const PAGE_SIZE = 100;
/** Bounds what one report can contribute to the private analysis input. */
const MAX_DESCRIPTION = 60_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * Parses one advisory. Only a private vulnerability report with a known
 * human author counts: a maintainer-created draft has no `submission`, and a
 * deleted ("ghost") or non-user author cannot be bound to a Slop account.
 */
export function parsePrivateReport(value: unknown): GithubPrivateReport | null {
  const advisory = record(value);
  if (advisory === null || record(advisory.submission) === null) return null;
  const author = record(advisory.author);
  const ghsa = advisory.ghsa_id;
  const created =
    typeof advisory.created_at === "string"
      ? Date.parse(advisory.created_at)
      : Number.NaN;
  if (
    typeof ghsa !== "string" ||
    !GHSA.test(ghsa) ||
    !Number.isFinite(created) ||
    author === null ||
    author.type !== "User" ||
    !Number.isSafeInteger(author.id) ||
    Number(author.id) <= 0 ||
    typeof author.login !== "string" ||
    !GITHUB_LOGIN.test(author.login)
  )
    return null;
  const vulnerabilities = Array.isArray(advisory.vulnerabilities)
    ? advisory.vulnerabilities
    : [];
  return {
    ghsa,
    createdAt: new Date(created).toISOString(),
    state: text(advisory.state, 20),
    author: { githubId: String(author.id), githubLogin: author.login },
    summary: text(advisory.summary, 1024),
    description: text(advisory.description, MAX_DESCRIPTION),
    severity: typeof advisory.severity === "string" ? advisory.severity : null,
    cweIds: Array.isArray(advisory.cwe_ids)
      ? advisory.cwe_ids
          .filter((id): id is string => typeof id === "string")
          .slice(0, 20)
      : [],
    packages: vulnerabilities
      .map((entry) => record(record(entry)?.package))
      .map((pkg) =>
        pkg ? `${text(pkg.ecosystem, 40)}:${text(pkg.name, 200)}` : "",
      )
      .filter((name) => name.length > 1)
      .slice(0, 20),
  };
}

function nextPage(link: string | null): string | null {
  if (link === null) return null;
  for (const part of link.split(",")) {
    const match = /^\s*<([^>]+)>\s*;\s*rel="next"\s*$/u.exec(part);
    if (match) return match[1];
  }
  return null;
}

/**
 * A reader that authenticates with a read-only advisory token for each
 * repository: the slopdotcash App installation token (owner decision D10).
 * Any failure, including a missing installation or permission, is
 * `unavailable`: the caller must never treat it as "no report".
 */
export function githubAdvisoryReader(options: {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  apiOrigin: string;
  token: (repository: string) => Promise<string | null>;
}): AdvisoryReader {
  const get = (url: string, token: string) =>
    options.fetch(url, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "slop.cash-security-intake",
        "x-github-api-version": "2022-11-28",
      },
      // Workers support only "follow" and "manual"; a redirect is not ok.
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
  return {
    async privateReports(repository) {
      if (!REPOSITORY.test(repository)) return { state: "unavailable" };
      const origin = new URL(options.apiOrigin).origin;
      let url: string | null =
        `${origin}/repos/${repository}/security-advisories?per_page=${PAGE_SIZE}&sort=created&direction=asc`;
      const reports: GithubPrivateReport[] = [];
      try {
        const token = await options.token(repository);
        if (token === null) return { state: "unavailable" };
        for (let page = 0; url !== null; page += 1) {
          // A partial list could hide a report, so it is not an answer.
          if (page === MAX_PAGES) return { state: "unavailable" };
          const response = await get(url, token);
          if (!response.ok) return { state: "unavailable" };
          const body = await readBoundedJson(
            response,
            MAX_RESPONSE_BYTES,
            "GitHub advisory",
          );
          if (!Array.isArray(body)) return { state: "unavailable" };
          for (const entry of body) {
            const report = parsePrivateReport(entry);
            if (report) reports.push(report);
          }
          const next = nextPage(response.headers.get("link"));
          // Follow only GitHub's own pagination on the same API origin.
          url = next !== null && new URL(next).origin === origin ? next : null;
          if (next !== null && url === null) return { state: "unavailable" };
        }
      } catch {
        return { state: "unavailable" };
      }
      reports.sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) ||
          a.ghsa.localeCompare(b.ghsa),
      );
      return { state: "ok", reports };
    },
    async privateReport(repository, ghsa) {
      if (!REPOSITORY.test(repository) || !GHSA.test(ghsa))
        return { state: "unavailable" };
      try {
        const token = await options.token(repository);
        if (token === null) return { state: "unavailable" };
        const response = await get(
          `${new URL(options.apiOrigin).origin}/repos/${repository}/security-advisories/${ghsa}`,
          token,
        );
        if (!response.ok) return { state: "unavailable" };
        const report = parsePrivateReport(
          await readBoundedJson(
            response,
            MAX_RESPONSE_BYTES,
            "GitHub advisory",
          ),
        );
        return report ? { state: "found", report } : { state: "unavailable" };
      } catch {
        return { state: "unavailable" };
      }
    },
  };
}
