// spec/frontend/projections.md, "The merge line stays hidden until a repository is read, and a failed read shows its date"; spec/backend/intakeCap.md, "The lists leave a paused project out, its page says why, and a failed read lists it as before"; spec/backend/backlogRule.md, "The lists leave an out-of-rotation project out and its page says why"
import { pausedNotice } from "../../../gen/backend__intakeCap.ts";
import type { ReadStatus } from "../../../gen/frontend__requests.ts";
import { mergeActivityLine } from "../../projections/statistics.ts";
import type { Shown } from "../home/listing.ts";
import type { ShownProject } from "./project.schema.ts";
import { type MergeIndex, projectBacklogNotice, projectHeld } from "./summary.ts";

export type MergeActivityProps = {
  /** The project whose repositories the line describes; its intake cap decides the paused notice, and the backlog rule decides the out-of-rotation notice. */
  project: Pick<ShownProject, "id" | "status" | "record" | "reward">;
  /** The stored merge activity of every project. */
  merge: Shown<MergeIndex>;
  /** Now, in milliseconds, against which the line's ages and the stored counts are told. */
  nowMs: number;
};

const failed: ReadonlySet<ReadStatus> = new Set(["Denied", "Invalid", "Unavailable", "Failed", "Cancelled"]);

/** How promptly the project merges outside work, from the daily read, after the paused or out-of-rotation notice while it holds new contributors; nothing while it loads or before a repository is read. */
export function MergeActivity({ project, merge, nowMs }: MergeActivityProps) {
  if (merge.status === "Loading" || merge.status === "Idle") return null;
  if (failed.has(merge.status)) return <p className="text-sm text-muted-foreground">Merge activity unavailable.</p>;
  const line = mergeActivityLine(merge.value?.get(project.id), nowMs);
  const backlogNotice = projectBacklogNotice(project, merge, nowMs);
  return (
    <>
      {backlogNotice ? <p className="text-lg font-medium text-foreground">{backlogNotice}</p> : projectHeld(project, merge, nowMs) ? <p className="text-lg font-medium text-foreground">{pausedNotice}</p> :null}
      {line ? <p className="text-sm text-muted-foreground">{line}</p> : null}
    </>
  );
}
