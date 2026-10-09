import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  assertProfiles,
  type ProfileIndex,
  type ProfileRecord,
} from "../src/lib/profiles";
import { TARGET_REPOSITORIES } from "../src/lib/repositories.mjs";
import { GitHubGraphqlClient } from "./generate-leaderboard";
import {
  type CensusRequest,
  collectProfileIssues,
} from "./profile-issue-census";

type PullRequestPage = {
  repository: {
    id: string;
    pullRequests: {
      totalCount: number;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: {
        id: string;
        state: string;
        author: {
          __typename: string;
          id?: string;
          login: string;
          avatarUrl: string;
        } | null;
      }[];
    };
  } | null;
};

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    live: { type: "boolean" },
    seed: { type: "boolean" },
    input: { type: "string" },
    previous: { type: "string" },
  },
});
if (values.live && values.input)
  throw new Error("Choose live collection or a profile input file.");
const output = "public/data/profiles.json";
const seed = "data/profiles/seed.json";
const query = `query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){id pullRequests(first:100,after:$after,orderBy:{field:CREATED_AT,direction:ASC}){totalCount pageInfo{hasNextPage endCursor} nodes{id state author{__typename login avatarUrl ... on User{id}}}}}rateLimit{cost limit remaining resetAt}}`;
async function publish(path: string, value: ProfileIndex) {
  await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await writeFile(`${path}.tmp`, `${JSON.stringify(value)}\n`);
  await rename(`${path}.tmp`, path);
}
if (values.live) {
  const token =
    process.env.GITHUB_TOKEN ??
    process.env.GH_TOKEN ??
    execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  if (!values.previous)
    throw Error(
      "Live profile collection requires --previous with the last published census (or the reviewed seed for the first publication)",
    );
  const previous = JSON.parse(await readFile(values.previous, "utf8"));
  assertProfiles(previous);
  const client = new GitHubGraphqlClient(token);
  const request: CensusRequest = async <T>(
    query: string,
    variables: Record<string, string | null>,
  ): Promise<T> => (await client.execute(query, variables)) as T;
  const result: ProfileIndex = {
    schemaVersion: "2",
    startedAt: new Date().toISOString(),
    generatedAt: "",
    repositories: [],
    people: [],
  };
  const people = new Map<string, ProfileRecord>();
  for (const repo of TARGET_REPOSITORIES) {
    let cursor: string | null = null,
      // Pages are ordered by creation time, so a PR opened during the crawl
      // lands after the cursor and is still fetched. The count may grow; it
      // may never shrink, and the final page must reconcile exactly.
      reported: number | undefined,
      excluded = 0;
    const ids = new Set<string>();
    do {
      const data: PullRequestPage = await request<PullRequestPage>(query, {
        owner: repo.owner,
        name: repo.name,
        after: cursor,
      });
      if (!data.repository) throw Error("Profile repository is unavailable");
      if (repo.expectedNodeId && repo.expectedNodeId !== data.repository.id)
        throw Error("Profile repository identity changed");
      const page = data.repository.pullRequests;
      if (reported !== undefined && page.totalCount < reported)
        throw Error(
          "PR inventory shrank during census; retry without publishing partial counts",
        );
      reported = page.totalCount;
      for (const pr of page.nodes) {
        if (
          !pr.id ||
          ids.has(pr.id) ||
          !["OPEN", "CLOSED", "MERGED"].includes(pr.state)
        )
          throw Error("Invalid or duplicate PR in census");
        ids.add(pr.id);
        const actor = pr.author;
        if (actor?.__typename !== "User" || !actor.id) {
          excluded++;
          continue;
        }
        const person: ProfileRecord = people.get(actor.id) ?? {
          id: actor.id,
          login: actor.login,
          avatarUrl: actor.avatarUrl,
          repositories: [],
        };
        person.login = actor.login;
        person.avatarUrl = actor.avatarUrl;
        let row = person.repositories.find((r) => r.repository === repo.id);
        if (!row) {
          row = { repository: repo.id, merged: 0, open: 0, closed: 0 };
          person.repositories.push(row);
        }
        if (pr.state === "MERGED") row.merged++;
        else if (pr.state === "OPEN") row.open++;
        else row.closed++;
        people.set(actor.id, person);
      }
      if (
        page.pageInfo.hasNextPage &&
        (!page.pageInfo.endCursor || page.pageInfo.endCursor === cursor)
      )
        throw Error("Incomplete PR pagination");
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (cursor);
    if (ids.size !== reported)
      throw Error(
        `PR count reconciliation failed: crawled ${ids.size}, repository reports ${reported}`,
      );
    result.repositories.push({
      repository: repo.id,
      count: ids.size,
      excluded,
    });
    console.log(`${repo.id}: ${ids.size} PRs reconciled`);
  }
  result.issues = await collectProfileIssues(
    request,
    people,
    previous,
    result.startedAt,
  );
  result.people = [...people.values()].sort((a, b) => a.id.localeCompare(b.id));
  result.generatedAt = new Date().toISOString();
  assertProfiles(result);
  if (values.seed) await publish(seed, result);
  await publish(output, result);
  console.log(`Published ${result.people.length} profiles`);
} else {
  const value = JSON.parse(await readFile(values.input ?? seed, "utf8"));
  assertProfiles(value);
  await publish(output, value);
}
