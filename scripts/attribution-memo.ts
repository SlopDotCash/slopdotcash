/**
 * Records what one commit-attribution computation read, and revalidates those
 * reads in batches on a later run (PRD section 9, operator decision,
 * 19 November 2026).
 *
 * A reused answer is correct only if every input it was derived from is
 * unchanged. The recorder therefore accepts a computation as reusable only
 * when every read falls in a class it can fence:
 *
 * - a pull request object: fenced by node id, updatedAt, state and URL;
 * - that pull request's reviews, comments, files and commits: GitHub moves the
 *   pull request's updatedAt when any of them change;
 * - commit, comparison and git-object reads by SHA, and files at a SHA:
 *   immutable;
 * - a text reference lookup: repeated exactly on revalidation;
 * - incoming cross-references: the complete source list is read again.
 *
 * Any other read, any error, a private or missing reference, or a hold makes
 * the computation non-reusable; it is then simply computed live next time.
 */

import {
  type RelatedPullRequestTimelineNode,
  valueReferenceTimelineRequest,
} from "../workers/slopbot/value-evidence";
import { VALUE_REFERENCE_QUERY } from "../workers/slopbot/value-reference-query";
import type {
  AttributionMemoEntry,
  AttributionMemoFence,
  AttributionMemoResult,
  AttributionPullDependency,
  AttributionReferenceDependency,
} from "./collection-memo";

const TIMELINE_QUERY = valueReferenceTimelineRequest("o/r", 1, null).query;
const sha = "[a-f0-9]{40}";
const immutablePath = new RegExp(
  `^(?:commits/${sha}|compare/${sha}\\.\\.\\.${sha}|git/(?:commits|trees|blobs)/${sha})(?:\\?.*)?$`,
  "u",
);

/** Stable JSON with sorted object keys, for exact comparison. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** The incoming source exactly as relatedPullRequests consumes it. */
export function normalizeIncoming(
  node: RelatedPullRequestTimelineNode,
): string {
  const source = node?.source;
  if (source?.__typename !== "PullRequest")
    return canonicalJson({ t: source?.__typename ?? null });
  return canonicalJson({
    t: "PullRequest",
    id: source.id ?? null,
    number: source.number ?? null,
    url: source.url ?? null,
    repository: source.repository
      ? {
          nameWithOwner: source.repository.nameWithOwner,
          isPrivate: source.repository.isPrivate,
        }
      : null,
  });
}

function pullState(pull: {
  state?: unknown;
  merged_at?: unknown;
}): AttributionPullDependency["state"] | null {
  if (pull.state === "open") return pull.merged_at ? null : "OPEN";
  if (pull.state === "closed") return pull.merged_at ? "MERGED" : "CLOSED";
  return null;
}

export class AttributionRecorder {
  private readonly pulls = new Map<string, AttributionPullDependency>();
  private readonly pullNumbers = new Set<number>();
  private readonly subresources = new Set<number>();
  private readonly references = new Map<
    string,
    AttributionReferenceDependency
  >();
  private incoming: string[] | null = null;
  private readonly names: Set<string>;
  reasons: string[] = [];

  /** `names` are every spelling of the one registered repository. */
  constructor(names: readonly string[]) {
    this.names = new Set(names.map((name) => name.toLowerCase()));
  }

  private named(value: string) {
    return this.names.has(value.toLowerCase());
  }

  private refuse(reason: string) {
    if (this.reasons.length < 8) this.reasons.push(reason);
  }

  /** A pull request object read through REST, or reused from the run cache. */
  observePull(value: unknown) {
    const pull = value as {
      node_id?: unknown;
      number?: unknown;
      updated_at?: unknown;
      html_url?: unknown;
      state?: unknown;
      merged_at?: unknown;
    } | null;
    const state = pull && pullState(pull);
    if (
      !pull ||
      !state ||
      typeof pull.node_id !== "string" ||
      typeof pull.updated_at !== "string" ||
      !Number.isFinite(Date.parse(pull.updated_at)) ||
      typeof pull.html_url !== "string" ||
      typeof pull.number !== "number" ||
      !this.named(
        /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/[1-9]\d*$/u.exec(
          pull.html_url,
        )?.[1] ?? "",
      )
    ) {
      this.refuse("unrecognized pull request read");
      return;
    }
    const dependency: AttributionPullDependency = {
      id: pull.node_id,
      updatedAt: new Date(pull.updated_at).toISOString(),
      state,
      url: pull.html_url,
    };
    const prior = this.pulls.get(dependency.id);
    if (prior && canonicalJson(prior) !== canonicalJson(dependency))
      this.refuse("pull request changed during the computation");
    this.pulls.set(dependency.id, dependency);
    this.pullNumbers.add(pull.number);
  }

  observeGet(path: string, value: unknown) {
    const match = /^\/repos\/([^/]+)\/([^/?]+)(?:\/(.*))?$/u.exec(path);
    if (!match || !this.named(`${match[1]}/${match[2]}`)) {
      this.refuse(`read outside the repository: ${path.slice(0, 80)}`);
      return;
    }
    const rest = match[3];
    if (rest === undefined) return; // repository identity, fenced by node id
    const pull = /^pulls\/([1-9]\d*)$/u.exec(rest);
    if (pull) {
      this.observePull(value);
      return;
    }
    const sub =
      /^(?:pulls\/([1-9]\d*)\/(?:reviews|comments|files|commits)|issues\/([1-9]\d*)\/comments)(?:\?.*)?$/u.exec(
        rest,
      );
    if (sub) {
      this.subresources.add(Number(sub[1] ?? sub[2]));
      return;
    }
    if (immutablePath.test(rest)) return;
    this.refuse(`unfenced read: ${rest.slice(0, 80)}`);
  }

  observeFile(owner: string, repo: string, ref: string) {
    if (!this.named(`${owner}/${repo}`) || !/^[a-f0-9]{40}$/u.test(ref))
      this.refuse("file read outside an exact commit");
  }

  observeGraphql(
    query: string,
    variables: Record<string, unknown>,
    data: unknown,
  ) {
    if (query === VALUE_REFERENCE_QUERY) {
      const repository = (data as { repository?: unknown } | null)
        ?.repository as
        | {
            isPrivate?: unknown;
            issueOrPullRequest?: unknown;
          }
        | null
        | undefined;
      if (repository?.isPrivate !== false || !repository.issueOrPullRequest) {
        this.refuse("reference is private, renamed or unavailable");
        return;
      }
      const dependency = {
        owner: String(variables.owner),
        name: String(variables.name),
        number: Number(variables.number),
        repository,
      };
      this.references.set(
        canonicalJson([dependency.owner, dependency.name, dependency.number]),
        dependency,
      );
      return;
    }
    if (query === TIMELINE_QUERY) {
      const pull = (
        data as {
          repository?: {
            pullRequest?: {
              timelineItems?: {
                nodes?: RelatedPullRequestTimelineNode[];
                pageInfo?: { hasNextPage?: boolean };
              };
            } | null;
          } | null;
        } | null
      )?.repository?.pullRequest;
      const items = pull?.timelineItems;
      if (
        !items ||
        !Array.isArray(items.nodes) ||
        items.pageInfo?.hasNextPage
      ) {
        this.refuse("incoming references span several pages");
        return;
      }
      this.observeIncoming(items.nodes);
      return;
    }
    this.refuse("unfenced GraphQL read");
  }

  observeIncoming(nodes: readonly RelatedPullRequestTimelineNode[]) {
    if (this.incoming !== null) {
      this.refuse("incoming references read twice");
      return;
    }
    this.incoming = nodes.map(normalizeIncoming).sort();
  }

  observeError() {
    this.refuse("a read failed");
  }

  /** The reusable record, or null with `reasons` explaining why not. */
  entry(
    outcomeId: string,
    fence: AttributionMemoFence,
    result: AttributionMemoResult | null,
  ): AttributionMemoEntry | null {
    if (!result) this.refuse("the result is a hold");
    if (this.incoming === null)
      this.refuse("incoming references were not read");
    for (const number of this.subresources)
      if (!this.pullNumbers.has(number))
        this.refuse("a pull request's discussion was read without its version");
    if (this.reasons.length || !result || this.incoming === null) return null;
    return {
      outcomeId,
      fence,
      pulls: [...this.pulls.values()].sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      ),
      references: [...this.references.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, dependency]) => dependency),
      incoming: this.incoming,
      result,
    };
  }
}

type Graphql = <T>(
  query: string,
  variables: Record<string, unknown>,
) => Promise<T>;

const PULL_FENCE_QUERY =
  "query SlopAttributionPullFences($ids:[ID!]!){nodes(ids:$ids){__typename ... on PullRequest{id updatedAt url state}} rateLimit{cost limit remaining resetAt}}";
const INCOMING_FENCE_QUERY =
  "query SlopAttributionIncomingFences($ids:[ID!]!){nodes(ids:$ids){__typename ... on PullRequest{id timelineItems(first:100,itemTypes:[CROSS_REFERENCED_EVENT]){pageInfo{hasNextPage} nodes{... on CrossReferencedEvent{source{__typename ... on PullRequest{id number url repository{nameWithOwner isPrivate}}}}}}}} rateLimit{cost limit remaining resetAt}}";
// The exact selection of VALUE_REFERENCE_QUERY, repeated under aliases.
const REFERENCE_SELECTION =
  "id isPrivate nameWithOwner issueOrPullRequest(number:$x__){__typename ... on PullRequest{id number url}}";
const PULL_BATCH = 100;
const INCOMING_BATCH = 20;
const REFERENCE_BATCH = 25;

function batches<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    out.push(values.slice(index, index + size));
  return out;
}

/**
 * Re-read every fenced input of the candidate entries in batches and return
 * the outcome IDs whose every input is unchanged. A failed batch simply makes
 * its entries non-reusable; it never fails the collection.
 */
export async function revalidateAttributionEntries(
  graphql: Graphql,
  entries: readonly AttributionMemoEntry[],
): Promise<Set<string>> {
  const pullIds = [
    ...new Set(entries.flatMap((entry) => entry.pulls.map((pull) => pull.id))),
  ];
  const livePulls = new Map<string, string>();
  for (const ids of batches(pullIds, PULL_BATCH)) {
    try {
      const data = await graphql<{ nodes?: unknown[] }>(PULL_FENCE_QUERY, {
        ids,
      });
      if (!Array.isArray(data?.nodes) || data.nodes.length !== ids.length)
        continue;
      data.nodes.forEach((node, index) => {
        const pull = node as {
          __typename?: string;
          id?: string;
          updatedAt?: string;
          url?: string;
          state?: string;
        } | null;
        if (
          pull?.__typename === "PullRequest" &&
          pull.id === ids[index] &&
          typeof pull.updatedAt === "string"
        )
          livePulls.set(
            pull.id,
            canonicalJson({
              id: pull.id,
              updatedAt: new Date(pull.updatedAt).toISOString(),
              state: pull.state,
              url: pull.url,
            }),
          );
      });
    } catch {
      // error-policy:J2 an unconfirmed fence is a cache miss; the live
      // computation reads GitHub again and fails closed on its own.
    }
  }

  const incomingIds = [...new Set(entries.map((entry) => entry.outcomeId))];
  const liveIncoming = new Map<string, string>();
  for (const ids of batches(incomingIds, INCOMING_BATCH)) {
    try {
      const data = await graphql<{ nodes?: unknown[] }>(INCOMING_FENCE_QUERY, {
        ids,
      });
      if (!Array.isArray(data?.nodes) || data.nodes.length !== ids.length)
        continue;
      data.nodes.forEach((node, index) => {
        const pull = node as {
          __typename?: string;
          id?: string;
          timelineItems?: {
            pageInfo?: { hasNextPage?: boolean };
            nodes?: RelatedPullRequestTimelineNode[];
          };
        } | null;
        const items = pull?.timelineItems;
        if (
          pull?.__typename === "PullRequest" &&
          pull.id === ids[index] &&
          Array.isArray(items?.nodes) &&
          // totalCount ignores itemTypes, so completeness is the page flag.
          items.pageInfo?.hasNextPage === false
        )
          liveIncoming.set(
            pull.id,
            canonicalJson(items.nodes.map(normalizeIncoming).sort()),
          );
      });
    } catch {
      // error-policy:J2 see above.
    }
  }

  const referenceKeys = new Map<string, AttributionReferenceDependency>();
  for (const entry of entries)
    for (const reference of entry.references)
      referenceKeys.set(
        canonicalJson([reference.owner, reference.name, reference.number]),
        reference,
      );
  const liveReferences = new Map<string, string>();
  for (const group of batches([...referenceKeys], REFERENCE_BATCH)) {
    const variables: Record<string, unknown> = {};
    const declarations: string[] = [];
    const fields: string[] = [];
    group.forEach(([, reference], index) => {
      variables[`o${index}`] = reference.owner;
      variables[`n${index}`] = reference.name;
      variables[`x${index}`] = reference.number;
      declarations.push(
        `$o${index}:String!,$n${index}:String!,$x${index}:Int!`,
      );
      fields.push(
        `r${index}:repository(owner:$o${index},name:$n${index}){${REFERENCE_SELECTION.replace("$x__", `$x${index}`)}}`,
      );
    });
    try {
      const data = await graphql<Record<string, unknown>>(
        `query SlopAttributionReferenceFences(${declarations.join(",")}){${fields.join(" ")} rateLimit{cost limit remaining resetAt}}`,
        variables,
      );
      group.forEach(([key], index) => {
        const repository = data?.[`r${index}`];
        if (repository) liveReferences.set(key, canonicalJson(repository));
      });
    } catch {
      // error-policy:J2 see above.
    }
  }

  const valid = new Set<string>();
  for (const entry of entries) {
    const pullsMatch = entry.pulls.every(
      (pull) => livePulls.get(pull.id) === canonicalJson(pull),
    );
    const incomingMatch =
      liveIncoming.get(entry.outcomeId) === canonicalJson(entry.incoming);
    const referencesMatch = entry.references.every(
      (reference) =>
        liveReferences.get(
          canonicalJson([reference.owner, reference.name, reference.number]),
        ) === canonicalJson(reference.repository),
    );
    if (pullsMatch && incomingMatch && referencesMatch)
      valid.add(entry.outcomeId);
  }
  return valid;
}
