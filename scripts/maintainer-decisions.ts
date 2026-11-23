/**
 * Reads, for one project month, who decided each outside pull request
 * (operator decision, 18 November 2026; PRD section 6). The monthly proposal
 * calls this only for a project whose revision sets a maintainer share.
 *
 * A decision is a pull request of a counted repository that
 *
 * - was merged or closed inside the UTC month,
 * - was opened by an outside author: not an owner, member or collaborator of
 *   the repository, and not a bot,
 * - was merged, or last closed, by a GitHub user other than its author.
 *
 * GitHub lets only an account with maintainer rights merge another person's
 * pull request. A close is different: deleting the head branch or the fork
 * closes the pull request, and GitHub records the deleting account as the
 * closer. So a close does not count when the closer owns the fork the pull
 * request came from, when that fork no longer exists, or when the closer
 * deleted the head branch within a minute of the close. A close by the author,
 * by a bot (Slopbot included) or by an actor GitHub no longer names is not a
 * decision either. A pull request reopened and closed again counts once, for
 * its last close.
 *
 * Everything read is public GitHub data. Any failed or incomplete read
 * throws: a month's split is never computed from a partial record.
 */

import {
  assertMaintainerDecisionRecord,
  type MaintainerDecision,
  type MaintainerDecisionRecord,
} from "../src/lib/payments/maintainer-share";
import { periodBounds } from "../src/lib/payments/monthly-allocation";
import {
  repositoriesCountedFor,
  repositoryIdentity,
} from "../src/lib/project-repositories.mjs";
import type { ProjectDefinition } from "../src/lib/projects.mjs";

export type GraphqlRequest = (
  query: string,
  variables: Record<string, unknown>,
) => Promise<unknown>;

const PAGE = 50;
/** A repository is refused past this many pages, far above any real month. */
const MAX_PAGES = 400;
const MAINTAINER = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export const DECISIONS_QUERY = `query($owner: String!, $name: String!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    id
    pullRequests(states: [CLOSED, MERGED], first: $first, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        updatedAt
        closedAt
        mergedAt
        authorAssociation
        author { __typename login }
        mergedBy { __typename login ... on User { id databaseId } }
        isCrossRepository
        headRepository { id }
        headRepositoryOwner { login }
        timelineItems(last: 1, itemTypes: [CLOSED_EVENT]) {
          nodes { ... on ClosedEvent { createdAt actor { __typename login ... on User { id databaseId } } } }
        }
        refDeletions: timelineItems(last: 10, itemTypes: [HEAD_REF_DELETED_EVENT]) {
          nodes { ... on HeadRefDeletedEvent { createdAt actor { login } } }
        }
      }
    }
  }
}`;

type Actor = {
  __typename?: unknown;
  login?: unknown;
  id?: unknown;
  databaseId?: unknown;
} | null;

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError(`GitHub returned no ${field}`);
  return value as Record<string, unknown>;
}

function instant(value: unknown, field: string): number {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed))
    throw new TypeError(`GitHub returned an invalid ${field}`);
  return parsed;
}

/** How close in time a branch deletion by the closer ties it to the close. */
const DELETION_WINDOW_MS = 60_000;

/**
 * Whether a close came from deleting the pull request's head branch or fork
 * rather than from a maintainer.
 */
function closedByHeadDeletion(
  node: Record<string, unknown>,
  closer: string,
  closedAt: number,
): boolean {
  if (typeof node.isCrossRepository !== "boolean")
    throw new TypeError("GitHub returned no head repository state");
  if (node.isCrossRepository) {
    if (node.headRepository === null || node.headRepository === undefined)
      return true;
    const owner = (node.headRepositoryOwner ?? null) as {
      login?: unknown;
    } | null;
    if (
      typeof owner?.login !== "string" ||
      owner.login.toLowerCase() === closer.toLowerCase()
    )
      return true;
  }
  const deletions = object(node.refDeletions, "branch deletions").nodes;
  if (!Array.isArray(deletions))
    throw new TypeError("GitHub returned no branch deletions");
  return deletions.some((entry) => {
    const event = (entry ?? {}) as {
      createdAt?: unknown;
      actor?: { login?: unknown } | null;
    };
    const login = event.actor?.login;
    return (
      typeof login === "string" &&
      login.toLowerCase() === closer.toLowerCase() &&
      Math.abs(instant(event.createdAt, "branch deletion time") - closedAt) <=
        DELETION_WINDOW_MS
    );
  });
}

/** The deciding user of one closed pull request node, or null. */
function decider(
  node: Record<string, unknown>,
  merged: boolean,
): { githubUserId: string; nodeId: string; login: string } | null {
  let actor: Actor;
  let closedAt = 0;
  if (merged) actor = (node.mergedBy ?? null) as Actor;
  else {
    const events = object(node.timelineItems, "close events").nodes;
    if (!Array.isArray(events))
      throw new TypeError("GitHub returned no close events");
    const close = events.at(-1) as
      | { actor?: Actor; createdAt?: unknown }
      | undefined;
    actor = (close?.actor ?? null) as Actor;
    if (actor !== null) closedAt = instant(close?.createdAt, "close time");
  }
  if (actor === null || actor.__typename !== "User") return null;
  if (
    !merged &&
    typeof actor.login === "string" &&
    closedByHeadDeletion(node, actor.login, closedAt)
  )
    return null;
  if (
    typeof actor.login !== "string" ||
    typeof actor.id !== "string" ||
    !Number.isSafeInteger(actor.databaseId) ||
    (actor.databaseId as number) <= 0
  )
    throw new TypeError("GitHub returned an incomplete deciding account");
  return {
    githubUserId: String(actor.databaseId),
    nodeId: actor.id,
    login: actor.login,
  };
}

async function repositoryDecisions(
  project: ProjectDefinition,
  repositoryId: string,
  from: number,
  to: number,
  graphql: GraphqlRequest,
): Promise<MaintainerDecision[]> {
  const [owner, name, ...rest] = repositoryId.split("/");
  if (!owner || !name || rest.length > 0)
    throw new TypeError(`Repository ${repositoryId} is not owner/name`);
  const identity = repositoryIdentity(project, repositoryId);
  const decisions: MaintainerDecision[] = [];
  // A pull request updated during the read can appear on two pages.
  const seen = new Set<number>();
  let after: string | null = null;
  for (let page = 0; ; page += 1) {
    if (page >= MAX_PAGES)
      throw new RangeError(
        `Repository ${repositoryId} has more closed pull requests than one read covers`,
      );
    const data = object(
      await graphql(DECISIONS_QUERY, { owner, name, first: PAGE, after }),
      "data",
    );
    const repository = object(data.repository, `repository ${repositoryId}`);
    // A renamed repository still resolves; another repository under the old
    // name must not.
    if (identity !== null && repository.id !== identity.nodeId)
      throw new TypeError(
        `Repository ${repositoryId} is not the registered repository`,
      );
    const connection = object(repository.pullRequests, "pull requests");
    const pageInfo = object(connection.pageInfo, "page state");
    if (!Array.isArray(connection.nodes))
      throw new TypeError("GitHub returned no pull request list");
    let older = false;
    for (const entry of connection.nodes) {
      const node = object(entry, "pull request");
      // A pull request closed in the month was updated in or after it, so
      // the first one last updated before the month ends the read.
      if (instant(node.updatedAt, "update time") < from) {
        older = true;
        break;
      }
      const merged = node.mergedAt !== null && node.mergedAt !== undefined;
      const decidedAt = instant(
        merged ? node.mergedAt : node.closedAt,
        "decision time",
      );
      if (decidedAt < from || decidedAt >= to) continue;
      const author = (node.author ?? null) as Actor;
      if (
        author?.__typename === "Bot" ||
        MAINTAINER.has(String(node.authorAssociation ?? ""))
      )
        continue;
      const by = decider(node, merged);
      const authorLogin =
        typeof author?.login === "string" ? author.login : "ghost";
      if (by === null || by.login.toLowerCase() === authorLogin.toLowerCase())
        continue;
      if (!Number.isSafeInteger(node.number))
        throw new TypeError("GitHub returned an invalid pull request number");
      if (seen.has(node.number as number)) continue;
      seen.add(node.number as number);
      decisions.push({
        repository: repositoryId,
        number: node.number as number,
        outcome: merged ? "merged" : "closed",
        decidedAt: new Date(decidedAt).toISOString(),
        author: authorLogin,
        ...by,
      });
    }
    if (older || pageInfo.hasNextPage !== true) break;
    if (typeof pageInfo.endCursor !== "string")
      throw new TypeError("GitHub returned no next page");
    after = pageInfo.endCursor;
  }
  return decisions;
}

/** The complete decision record of one project month. */
export async function collectMaintainerDecisions(
  project: ProjectDefinition,
  period: string,
  graphql: GraphqlRequest,
): Promise<MaintainerDecisionRecord> {
  const { from, to } = periodBounds(period);
  const repositories = repositoriesCountedFor(project, from)
    .map((repository) => repository.id)
    .sort();
  const decisions: MaintainerDecision[] = [];
  for (const repositoryId of repositories)
    decisions.push(
      ...(await repositoryDecisions(project, repositoryId, from, to, graphql)),
    );
  decisions.sort(
    (left, right) =>
      left.repository.localeCompare(right.repository) ||
      left.number - right.number,
  );
  const record = {
    schemaVersion: "1" as const,
    projectId: project.id,
    period,
    repositories,
    decisions,
  };
  assertMaintainerDecisionRecord(record, project.id, period);
  return record;
}

/** The exact stored bytes of a record. */
export function maintainerDecisionBytes(
  record: MaintainerDecisionRecord,
): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(record));
}

/**
 * A GitHub GraphQL request with the workflow token. A network failure, a
 * server error or a rate-limit answer is retried a few times; any GraphQL
 * error ends the read.
 */
export function githubGraphql(
  token: string,
  options: {
    fetch?: typeof fetch;
    attempts?: number;
    wait?: (milliseconds: number) => Promise<void>;
  } = {},
): GraphqlRequest {
  const request = options.fetch ?? fetch;
  const attempts = options.attempts ?? 4;
  const wait =
    options.wait ??
    ((milliseconds: number) =>
      new Promise<void>((done) => setTimeout(done, milliseconds)));
  if (!token) throw new TypeError("A GitHub token is required");
  return async (query, variables) => {
    let failure = "no attempt";
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (attempt > 1) await wait(2000 * 2 ** (attempt - 2));
      let response: Response;
      try {
        response = await request("https://api.github.com/graphql", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "user-agent": "slop-monthly-rewards",
          },
          body: JSON.stringify({ query, variables }),
        });
      } catch {
        failure = "network failure";
        continue;
      }
      if (
        response.status >= 500 ||
        response.status === 403 ||
        response.status === 429
      ) {
        failure = `HTTP ${response.status}`;
        continue;
      }
      if (!response.ok)
        throw new Error(`GitHub answered HTTP ${response.status}`);
      let body: { data?: unknown; errors?: unknown };
      try {
        body = (await response.json()) as typeof body;
      } catch {
        failure = "unreadable answer";
        continue;
      }
      if (body.errors !== undefined || body.data === undefined)
        throw new Error("GitHub refused the maintainer decision read");
      return body.data;
    }
    throw new Error(`GitHub maintainer decision read failed: ${failure}`);
  };
}
