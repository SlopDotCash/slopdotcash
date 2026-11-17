// spec/frontend/projections.md, "The merge line stays hidden until a repository is read, and a failed read shows its date"
import type { ReadStatus } from "../../../gen/frontend__requests.ts";
import { mergeActivityLine } from "../../projections/statistics.ts";
import type { MergeActivityIndex } from "../../reads/funding.vibe";
import type { Shown } from "../home/listing.ts";

export type MergeActivityProps = {
  /** The project whose repositories the line describes. */
  projectId: string;
  /** The stored merge activity of every project. */
  merge: Shown<MergeActivityIndex>;
  /** Now, in milliseconds, against which the line's ages are told. */
  nowMs: number;
};

const failed: ReadonlySet<ReadStatus> = new Set(["Denied", "Invalid", "Unavailable", "Failed", "Cancelled"]);

/** How promptly the project merges outside work, from the daily read; nothing while it loads or before a repository is read. */
export function MergeActivity({ projectId, merge, nowMs }: MergeActivityProps) {
  if (merge.status === "Loading" || merge.status === "Idle") return null;
  if (failed.has(merge.status)) return <p className="text-sm text-muted-foreground">Merge activity unavailable.</p>;
  const line = mergeActivityLine(merge.value?.get(projectId), nowMs);
  return line ? <p className="text-sm text-muted-foreground">{line}</p> : null;
}
