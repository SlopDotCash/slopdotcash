import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Connection = {
  totalCount: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: { id: string; body: string }[];
};
export interface CapturedDiscussion {
  id: string;
  closedAt: string;
  mergedAt: null;
  headRefOid: string;
  comments: Connection;
  reviews: Connection;
}
/** Complete the uncommon large discussions; preserve every source and detect drift. */
export function completeDiscussionConnections(row: CapturedDiscussion): void {
  for (const field of ["comments", "reviews"] as const) {
    const connection = row[field];
    const ids = new Set(connection.nodes.map((node) => node.id));
    const cursors = new Set<string>();
    while (connection.pageInfo.hasNextPage) {
      const cursor = connection.pageInfo.endCursor;
      if (!cursor || cursors.has(cursor))
        throw new Error("Missing or repeated discussion cursor");
      cursors.add(cursor);
      const fields =
        field === "comments"
          ? "id url body createdAt updatedAt authorAssociation author{login}"
          : "id url body state submittedAt author{login}";
      const query = `query($id:ID!,$after:String!){node(id:$id){... on PullRequest{id closedAt mergedAt headRefOid ${field}(first:100,after:$after){totalCount pageInfo{hasNextPage endCursor} nodes{${fields}}}}}}`;
      const response = JSON.parse(
        execFileSync("gh", ["api", "graphql", "--input", "-"], {
          input: JSON.stringify({
            query,
            variables: { id: row.id, after: cursor },
          }),
          encoding: "utf8",
          timeout: 30_000,
          maxBuffer: 64 * 1024 * 1024,
        }),
      );
      const current = response.data?.node;
      if (
        response.errors?.length ||
        !current ||
        current.id !== row.id ||
        current.closedAt !== row.closedAt ||
        current.headRefOid !== row.headRefOid ||
        current.mergedAt !== null ||
        current[field]?.totalCount !== connection.totalCount
      )
        throw new Error(
          "Discussion changed during capture; refresh before assessment",
        );
      const next: Connection = current[field];
      if (!next.nodes.length)
        throw new Error("Empty intermediate discussion page");
      for (const item of next.nodes) {
        if (!item?.id || ids.has(item.id))
          throw new Error("Duplicate discussion event");
        ids.add(item.id);
        connection.nodes.push(item);
      }
      connection.pageInfo = next.pageInfo;
    }
    if (
      connection.nodes.length !== connection.totalCount ||
      ids.size !== connection.totalCount
    )
      throw new Error("Incomplete discussion connection");
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [source, output] = process.argv.slice(2);
  if (!output)
    throw new Error("Usage: complete-quality-discussions.ts CAPTURE OUTPUT");
  const value = JSON.parse(await readFile(source, "utf8"));
  for (const row of value.observations) completeDiscussionConnections(row);
  value.completedAt = new Date().toISOString();
  await writeFile(output, `${JSON.stringify(value)}\n`, { flag: "wx" });
  console.log(`Completed ${value.observations.length} closure discussions.`);
}
