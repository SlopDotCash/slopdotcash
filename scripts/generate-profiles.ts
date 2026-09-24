import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { readBoundedJson } from "../src/lib/browser-json";
import {
  assertProfiles,
  type ProfileIndex,
  type ProfileRecord,
} from "../src/lib/profiles";
import { TARGET_REPOSITORIES } from "../src/lib/repositories.mjs";

const output = "public/data/profiles.json";
const seed = "data/profiles/seed.json";
const query = `query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){id pullRequests(first:100,after:$after,orderBy:{field:CREATED_AT,direction:ASC}){totalCount pageInfo{hasNextPage endCursor} nodes{id state author{__typename login avatarUrl ... on User{id}}}}}rateLimit{remaining resetAt}}`;
async function publish(path: string, value: ProfileIndex) {
  await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await writeFile(`${path}.tmp`, `${JSON.stringify(value)}\n`);
  await rename(`${path}.tmp`, path);
}
if (process.argv.includes("--live")) {
  const token =
    process.env.GITHUB_TOKEN ??
    process.env.GH_TOKEN ??
    execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  const result: ProfileIndex = {
    schemaVersion: "1",
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
      const response = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query,
          variables: { owner: repo.owner, name: repo.name, after: cursor },
        }),
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) throw Error(`Profile census GitHub ${response.status}`);
      const value = (await readBoundedJson(
        response,
        4 * 1024 * 1024,
        "profile census",
      )) as {
        errors?: unknown;
        data?: {
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
          };
          rateLimit: { remaining: number };
        };
      };
      if (
        value.errors ||
        !value.data?.repository ||
        value.data.rateLimit.remaining < 100
      )
        throw Error("Incomplete profile census or insufficient GitHub budget");
      if (
        repo.expectedNodeId &&
        repo.expectedNodeId !== value.data.repository.id
      )
        throw Error("Profile repository identity changed");
      const page = value.data.repository.pullRequests;
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
        const person = people.get(actor.id) ?? {
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
  result.people = [...people.values()].sort((a, b) => a.id.localeCompare(b.id));
  result.generatedAt = new Date().toISOString();
  assertProfiles(result);
  if (process.argv.includes("--seed")) await publish(seed, result);
  await publish(output, result);
  console.log(`Published ${result.people.length} profiles`);
} else {
  const value = JSON.parse(
    await readFile(
      await readFile(output).then(
        () => output,
        () => seed,
      ),
      "utf8",
    ),
  );
  assertProfiles(value);
  await publish(output, value);
}
