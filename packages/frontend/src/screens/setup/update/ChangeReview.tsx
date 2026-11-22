// spec/backend/projects.md, "Owner revisions publish at once against the expected revision"; spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"; spec/backend/projects.md, "Appending a repository pauses the project and its work counts from next month"; spec/security/enforcement.md, "Each repository clears on its own admission, exemption or retained clean scan"
import type { RevisionChanges } from "@repo/backend/owner/classify";
import { CompareChange } from "@repo/ui";
import { Calendar, Check, Minus, ShieldAlert } from "lucide-react";
import { Chip } from "../../admin/parts.tsx";
import { type ChangeEffect, type ChangeField, type ChangeRow, changeEffect } from "./revision.ts";

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

function EffectChip({ effect, active, nextCycle }: { effect: ChangeEffect; active: boolean; nextCycle: string }) {
  if (effect === "live") return <Chip tone="Positive">Live now</Chip>;
  if (effect === "rescan")
    return (
      <Chip tone="Caution" icon={<ShieldAlert aria-hidden />}>
        {active ? "Rescan · pauses" : "Rescan"}
      </Chip>
    );
  return <Chip icon={<Calendar aria-hidden />}>From {nextCycle}</Chip>;
}

function ChangeValue({ field, value }: { field: ChangeField; value: string }) {
  if (field === "slopbot" || field === "honorSystem") {
    const on = value === "Allowed" || value === "On";
    return (
      <Chip tone={on ? "Positive" : "Neutral"} icon={on ? <Check aria-hidden /> : <Minus aria-hidden />}>
        {on ? "On" : "Off"}
      </Chip>
    );
  }
  if (field === "image") return value ? <img src={value} alt="Custom avatar" width={32} height={32} /> : "GitHub avatar";
  return value;
}

/** What publishing does: each value now beside the value proposed with its effect, and the effects of changes that have no row of their own. */
export function ChangeReview({ changes, rows, addedRepositories, scanCleared, active, nextCycle }: ChangeReviewProps) {
  const executableCleared = scanCleared && addedRepositories === 0;
  const executable = changes.executable.length > 0;
  const rowEffects = new Set(rows.map((row) => changeEffect(row.field, executableCleared)));
  const unlisted = ([changes.presentation.length > 0 || (executableCleared && executable) ? "live" : null, !executableCleared && executable ? "rescan" : null, changes.financial.length > 0 ? "next-month" : null] as const).filter((effect): effect is ChangeEffect => effect !== null && !rowEffects.has(effect));
  return (
    <section aria-labelledby="update-changes" className="flex flex-col gap-4">
      <h2 id="update-changes" className="text-lg font-semibold text-foreground">
        Changes
      </h2>
      {unlisted.length > 0 ? (
        <p className="flex flex-wrap gap-2">
          {unlisted.map((effect) => (
            <EffectChip key={effect} effect={effect} active={active} nextCycle={nextCycle} />
          ))}
        </p>
      ) : null}
      {rows.length > 0 ? (
        <CompareChange
          changes={rows.map((row) => ({
            label: row.label,
            current: <ChangeValue field={row.field} value={row.current} />,
            proposed: (
              <span className="inline-flex flex-wrap items-center gap-2">
                <ChangeValue field={row.field} value={row.proposed} />
                <EffectChip effect={changeEffect(row.field, executableCleared)} active={active} nextCycle={nextCycle} />
              </span>
            ),
          }))}
        />
      ) : null}
    </section>
  );
}
