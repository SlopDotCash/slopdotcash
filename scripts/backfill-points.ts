/** Complete repository connection census. Never uses GitHub's capped search. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { readBoundedJson } from "../src/lib/browser-json";
import {
  appendPointAwards,
  emptyPointsJournal,
  type PointAward,
  pointKey,
  pointMembers,
} from "../src/lib/points";
import { TARGET_REPOSITORIES } from "../src/lib/repositories.mjs";

const query = `query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){id createdAt pullRequests(first:100,after:$after,states:MERGED,orderBy:{field:CREATED_AT,direction:ASC}){totalCount pageInfo{hasNextPage endCursor} nodes{id number url mergedAt author{__typename login ... on User{id}} reviews(first:100){totalCount pageInfo{hasNextPage endCursor} nodes{id url state submittedAt body author{__typename login ... on User{id}} comments{totalCount}}}}}} rateLimit{remaining resetAt}}`;
const reviewQuery = `query($id:ID!,$after:String){node(id:$id){... on PullRequest{reviews(first:100,after:$after){totalCount pageInfo{hasNextPage endCursor} nodes{id url state submittedAt body author{__typename login ... on User{id}} comments{totalCount}}}}} rateLimit{remaining resetAt}}`;
type Actor = { __typename: string; id?: string; login: string };
type Review = {
  id: string;
  url: string;
  state: string;
  submittedAt: string;
  body: string;
  author: Actor | null;
  comments: { totalCount: number };
};
type Page<T> = {
  totalCount: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: T[];
};
type PR = {
  id: string;
  url: string;
  number: number;
  mergedAt: string;
  author: Actor | null;
  reviews: Page<Review>;
};
async function github(queryText: string, variables: object) {
  const token = execFileSync("gh", ["auth", "token"], {
    encoding: "utf8",
  }).trim();
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: queryText, variables }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok)
    throw new Error(`GitHub history returned ${response.status}`);
  const result = (await readBoundedJson(
    response,
    64 * 1024 * 1024,
    "GitHub history",
  )) as { errors?: unknown; data?: any };
  if (result.errors || !result.data)
    throw new Error(
      `Incomplete GitHub history: ${JSON.stringify(result.errors)}`,
    );
  if (result.data.rateLimit.remaining < 150)
    throw new Error(
      `GitHub history budget low; reset ${result.data.rateLimit.resetAt}. No partial backfill published.`,
    );
  return result.data;
}
function user(actor: Actor | null): actor is Actor & { id: string } {
  return (
    actor?.__typename === "User" &&
    typeof actor.id === "string" &&
    !/\[bot\]$/.test(actor.login)
  );
}
if (import.meta.main) {
  const now = new Date().toISOString();
  let journal = emptyPointsJournal(now);
  const report: object[] = [];
  for (const repo of TARGET_REPOSITORIES) {
    let cursor: string | null = null;
    let count = 0;
    let expected: number | undefined;
    let createdAt = "";
    let repositoryNode = "";
    const ids = new Set<string>();
    const awards: PointAward[] = [];
    const sourceHash = createHash("sha256");
    do {
      const data = await github(query, {
        owner: repo.owner,
        name: repo.name,
        after: cursor,
      });
      if (!data.repository) throw new Error(`Missing repository ${repo.id}`);
      repositoryNode = data.repository.id;
      if (repo.expectedNodeId && repo.expectedNodeId !== repositoryNode)
        throw new Error("Repository identity changed");
      createdAt = data.repository.createdAt;
      const page: Page<PR> = data.repository.pullRequests;
      expected ??= page.totalCount;
      expected = page.totalCount;
      for (const pr of page.nodes) {
        if (ids.has(pr.id) || !pr.mergedAt)
          throw new Error("Duplicate or unmerged history source");
        count++;
        if (pr.mergedAt > now) continue;
        ids.add(pr.id);
        let reviews = [...pr.reviews.nodes];
        let reviewCursor = pr.reviews.pageInfo.endCursor;
        let more = pr.reviews.pageInfo.hasNextPage;
        while (more) {
          const result = await github(reviewQuery, {
            id: pr.id,
            after: reviewCursor,
          });
          const next: Page<Review> = result.node?.reviews;
          if (!next || next.totalCount !== pr.reviews.totalCount)
            throw new Error("Incomplete review history");
          reviews = reviews.concat(next.nodes);
          reviewCursor = next.pageInfo.endCursor;
          more = next.pageInfo.hasNextPage;
        }
        if (
          reviews.length !== pr.reviews.totalCount ||
          new Set(reviews.map((r) => r.id)).size !== reviews.length
        )
          throw new Error("Review count mismatch");
        const safe = {
          id: pr.id,
          mergedAt: pr.mergedAt,
          author: pr.author,
          reviews: reviews.map((r) => ({
            id: r.id,
            state: r.state,
            submittedAt: r.submittedAt,
            author: r.author,
            bodyDigest: createHash("sha256").update(r.body).digest("hex"),
            comments: r.comments.totalCount,
          })),
        };
        sourceHash.update(JSON.stringify(safe));
        if (user(pr.author))
          awards.push({
            key: pointKey(
              repo.projectId,
              pr.author.id,
              "merged-pull-request",
              pr.id,
            ),
            actor: { id: pr.author.id, login: pr.author.login },
            projectId: repo.projectId,
            category: "merged-pull-request",
            amount: 10,
            occurredAt: new Date(pr.mergedAt).toISOString(),
            sourceId: pr.id,
            sourceUrl: pr.url,
            workUnitId: `history_${pr.id}`,
            provisional: true,
          });
        // Historical reviews are preserved for reviewed scoring backfill rather than
        // inferred from text length. Only accepted ledger/evaluation evidence awards them.
      }
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
      if (page.pageInfo.hasNextPage && !cursor)
        throw new Error("Missing history cursor");
      process.stderr.write(
        `[points] ${repo.id}: ${count}/${expected} merged outcomes\n`,
      );
    } while (cursor);
    // A second scalar pass verifies the exact pre-cutoff set despite concurrent merges.
    const verified = new Set<string>();
    let verifyCursor: string | null = null;
    do {
      const result = await github(
        `query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){pullRequests(first:100,after:$after,states:MERGED,orderBy:{field:CREATED_AT,direction:ASC}){pageInfo{hasNextPage endCursor} nodes{id mergedAt}}}rateLimit{remaining resetAt}}`,
        { owner: repo.owner, name: repo.name, after: verifyCursor },
      );
      const page = result.repository.pullRequests;
      for (const pr of page.nodes)
        if (pr.mergedAt <= now) {
          if (verified.has(pr.id))
            throw new Error("Duplicate verification source");
          verified.add(pr.id);
        }
      verifyCursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (verifyCursor);
    if (verified.size !== ids.size || [...verified].some((id) => !ids.has(id)))
      throw new Error(`Historical source census changed: ${repo.id}`);
    const digest = sourceHash.digest("hex");
    journal = appendPointAwards(
      journal,
      awards,
      digest,
      "github-merged-history-v1",
      now,
    );
    journal.coverage.push({
      repository: repo.id,
      from: new Date(createdAt).toISOString(),
      to: now,
      digest,
    });
    report.push({
      repository: repo.id,
      repositoryNode,
      from: createdAt,
      to: now,
      scannedMergedCount: count,
      verifiedMergedCount: ids.size,
      awarded: awards.length,
      digest,
      reviewCoverage:
        "Accepted ledger/evaluation sources only; historical unratified reviews are not inferred.",
    });
  }
  await mkdir("data/points", { recursive: true });
  await writeFile(
    "data/points/history.json.tmp",
    JSON.stringify(journal) + "\n",
  );
  await rename("data/points/history.json.tmp", "data/points/history.json");
  await writeFile(
    "data/points/backfill-report.json",
    JSON.stringify(
      {
        observedAt: now,
        contributors: pointMembers(journal).length,
        repositories: report,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `[points] Backfilled ${journal.revisions.length} accepted merges for ${pointMembers(journal).length} contributors`,
  );
}
