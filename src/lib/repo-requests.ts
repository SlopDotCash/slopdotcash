/**
 * Requested repos (PRD section 11, "Referral program"): the names, rules and
 * API answers shared by the `/requested` page and
 * `backend/referrals/repo-requests.ts`. A member with merged work on Slop
 * flags a public GitHub repository not yet on Slop as one they would work on.
 * The board shows the count per repository, never who flagged it.
 */

import { referralLink } from "./referral-code";

export const REPO_REQUESTS_API = "/api/v1/repo-requests";
export const REQUESTED_PAGE = "/requested";

/** Active flags one account may hold at a time. */
export const REPO_REQUEST_LIMIT = 10;
/** A flag counts for this many days after it was made or renewed. */
export const REPO_REQUEST_DAYS = 90;
/** Rows the public board returns. */
export const REPO_REQUEST_BOARD_LIMIT = 200;

/**
 * A GitHub path `owner/name`: a valid GitHub login, then a repository name
 * that is not `.` or `..`.
 */
const REPO_PATH =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/(?!\.\.?$)[A-Za-z0-9_.-]{1,100}$/u;

export const REPO_PATH_RULE = "Enter the repository as owner/name.";

export function validRepoPath(value: unknown): value is string {
  return typeof value === "string" && REPO_PATH.test(value);
}

export function repoUrl(repo: string): string {
  return `https://github.com/${repo}`;
}

export type RepoRequestAction = "flag" | "withdraw";

export type RequestedRepo = { repo: string; count: number; newestAt: string };
export type MyRepoRequest = {
  repo: string;
  expiresAt: string;
  /** The project id when the repository is now listed on Slop. */
  listedAs: string | null;
};
export type RepoRequestBoard = {
  repos: RequestedRepo[];
  /** Null when the viewer is signed out. */
  mine: MyRepoRequest[] | null;
};
export type RepoRequestAnswer = {
  repo: string;
  count: number;
  flagged: boolean;
  expiresAt: string | null;
};

const PROJECT_ID = /^[a-z0-9](?:[a-z0-9-]{0,41}[a-z0-9])?$/u;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Requested repos could not be read. Retry.");
  return value as Record<string, unknown>;
}

function instant(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new Error("Requested repos could not be read. Retry.");
  return value;
}

function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new Error("Requested repos could not be read. Retry.");
  return Number(value);
}

function repo(value: unknown): string {
  if (!validRepoPath(value))
    throw new Error("Requested repos could not be read. Retry.");
  return value;
}

export function repoRequestBoard(value: unknown): RepoRequestBoard {
  const body = record(value);
  if (
    !Array.isArray(body.repos) ||
    body.repos.length > REPO_REQUEST_BOARD_LIMIT
  )
    throw new Error("Requested repos could not be read. Retry.");
  const repos = body.repos.map((entry) => {
    const row = record(entry);
    return {
      repo: repo(row.repo),
      count: count(row.count),
      newestAt: instant(row.newestAt),
    };
  });
  let mine: MyRepoRequest[] | null = null;
  if (body.mine !== null) {
    if (!Array.isArray(body.mine))
      throw new Error("Requested repos could not be read. Retry.");
    mine = body.mine.map((entry) => {
      const row = record(entry);
      if (
        row.listedAs !== null &&
        !(typeof row.listedAs === "string" && PROJECT_ID.test(row.listedAs))
      )
        throw new Error("Requested repos could not be read. Retry.");
      return {
        repo: repo(row.repo),
        expiresAt: instant(row.expiresAt),
        listedAs: row.listedAs as string | null,
      };
    });
  }
  return { repos, mine };
}

export function repoRequestAnswer(value: unknown): RepoRequestAnswer {
  const body = record(value);
  if (typeof body.flagged !== "boolean")
    throw new Error("Your flag could not be read. Reload the page.");
  return {
    repo: repo(body.repo),
    count: count(body.count),
    flagged: body.flagged,
    expiresAt: body.expiresAt === null ? null : instant(body.expiresAt),
  };
}

/**
 * The link a pitch carries: the viewer's named referral link, else their
 * login link, else the project form for a signed-out viewer.
 */
export function pitchLink(
  origin: string,
  viewer: { login: string; referralCode: string | null } | null,
): string {
  if (viewer === null) return `${origin}/projects/new`;
  if (viewer.referralCode !== null)
    return referralLink(origin, viewer.referralCode);
  return `${origin}/r/${viewer.login}`;
}

export function pitchText(count: number, repo: string, link: string): string {
  const who =
    count === 1
      ? "1 Slop contributor with merged work wants"
      : `${count} Slop contributors with merged work want`;
  return `${who} to work on ${repo}. List it free at ${link}`;
}
