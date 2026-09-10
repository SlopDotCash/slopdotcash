import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { QualityEvidence } from "../src/lib/contribution-quality";
import { closureDiscussionSignals } from "./closure-discussion-signals";

const [qualityPath, discussionPath, output] = process.argv.slice(2);
if (!output)
  throw new Error(
    "Usage: enrich-quality-discussions.ts QUALITY DISCUSSIONS OUTPUT",
  );
const evidence: QualityEvidence = JSON.parse(
  await readFile(qualityPath, "utf8"),
);
const bytes = await readFile(discussionPath);
const discussions = JSON.parse(bytes.toString());
type Discussion = {
  id: string;
  comments: {
    totalCount: number;
    pageInfo: { hasNextPage: boolean };
    nodes: { body: string }[];
  };
  reviews: {
    totalCount: number;
    pageInfo: { hasNextPage: boolean };
    nodes: { body: string }[];
  };
};
const rows: Discussion[] = discussions.observations;
if (
  !Array.isArray(rows) ||
  new Set(rows.map((row) => row.id)).size !== rows.length ||
  rows.length !== evidence.closures.length
)
  throw new Error("Discussion census does not match closure census");
const byId = new Map(rows.map((row) => [row.id, row]));
let partial = 0;
for (const closure of evidence.closures) {
  const row = byId.get(closure.id);
  if (!row) throw new Error("Missing closure discussion");
  const complete =
    !row.comments.pageInfo.hasNextPage &&
    !row.reviews.pageInfo.hasNextPage &&
    row.comments.totalCount === row.comments.nodes.length &&
    row.reviews.totalCount === row.reviews.nodes.length;
  if (!complete) partial++;
  closure.flags = closureDiscussionSignals(
    [...row.comments.nodes, ...row.reviews.nodes].map((item) => item.body),
    complete,
  );
}
evidence.closureCensus.discussionSourceSha256 = createHash("sha256")
  .update(bytes)
  .digest("hex");
await writeFile(output, `${JSON.stringify(evidence)}\n`, { flag: "wx" });
console.log(
  JSON.stringify({
    discussions: rows.length,
    incompleteDiscussions: partial,
    paymentChangesApplied: false,
  }),
);
