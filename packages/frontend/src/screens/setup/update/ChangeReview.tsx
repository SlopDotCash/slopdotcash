// spec/backend/projects.md, "Owner revisions publish at once against the expected revision"; spec/backend/projects.md, "Appending a repository pauses the project and its work counts from next month"; spec/security/enforcement.md, "Each repository clears on its own admission, exemption or retained clean scan"
import type { RevisionChanges } from "@repo/backend/owner/classify";
import { CompareChange } from "@repo/ui";
import type { ChangeRow } from "./revision.ts";

export type ChangeReviewProps = {
  changes: RevisionChanges;
  rows: ReadonlyArray<ChangeRow>;
  /** Repositories this edit adds: each needs its own scan, cleared project or not. */
  addedRepositories: number;
  /** The project's admission is cleared, so routine contribution edits need no new scan. */
  scanCleared: boolean;
  active: boolean;
  /** The UTC month financial changes start, as YYYY-MM. */
  nextCycle: string;
};

/** What publishing does, by kind of change, and each value now beside the value proposed. */
export function ChangeReview({ changes, rows, addedRepositories, scanCleared, active, nextCycle }: ChangeReviewProps) {
  const executableCleared = scanCleared && addedRepositories === 0;
  const executable = changes.executable.length > 0;
  return (
    <section aria-labelledby="update-changes" className="flex flex-col gap-4">
      <h2 id="update-changes" className="text-lg font-semibold text-foreground">
        Changes
      </h2>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-foreground">
        {changes.presentation.length > 0 || (executableCleared && executable) ? <li>Presentation and cleared contribution changes publish now.</li> : null}
        {!executableCleared && executable ? <li>Contribution changes need a new security scan. {active ? "The project pauses and goes live again when the scan passes." : "The project goes live when the scan passes."}</li> : null}
        {changes.financial.length > 0 ? <li>Financial changes apply from {nextCycle} (UTC). Funded awards keep their terms.</li> : null}
      </ul>
      {rows.length > 0 ? <CompareChange changes={rows.map((row) => ({ label: row.label, current: row.current, proposed: row.proposed }))} /> : null}
    </section>
  );
}
