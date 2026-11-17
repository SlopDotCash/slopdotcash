// spec/security/enforcement.md, "Each repository clears on its own admission, exemption or retained clean scan"; spec/ui/status.md, "A presentation is a tone, an icon and a word"
import { Status, type StatusProps } from "@repo/ui";
import { Eye, ListChecks, type LucideIcon, ScanSearch } from "lucide-react";
import type { ClearanceBadge, ClearanceIcon, ClearanceTone, ClearanceView } from "../../../projections/clearance.ts";

type Presentation = StatusProps["presentation"];

const tones = { success: "Positive", warning: "Caution", danger: "Negative", info: "Notice", neutral: "Neutral" } as const satisfies Record<ClearanceTone, Presentation["tone"]>;

const icons = { pass: "Check", fail: "Ban", skip: "Slash", partial: "Dot", held: "Lock", note: "Dot", review: "Eye" } as const satisfies Record<ClearanceIcon, Presentation["icon"]>;

const groups = [
  ["checks", "Checks", ListChecks],
  ["coverage", "Coverage", ScanSearch],
  ["review", "Review", Eye],
] as const satisfies ReadonlyArray<readonly [keyof ClearanceView, string, LucideIcon]>;

const presentationOf = ({ tone, icon, label }: ClearanceBadge): Presentation => ({ tone: tones[tone], icon: icons[icon], label });

export type ScanClearanceProps = {
  /** Why an incomplete scan did not clear, from `scanClearanceView`; nothing is shown without it. */
  view: ClearanceView | null;
};

/** Why an incomplete scan did not clear, one row of states per group; a passed check reads as what it found, never as a passed scan. */
export function ScanClearance({ view }: ScanClearanceProps) {
  if (view === null) return null;
  return (
    <section aria-label="Why the scan did not clear">
      <dl className="flex flex-col gap-2">
        {groups.map(([key, name, Glyph]) =>
          view[key].length > 0 ? (
            <div key={key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <dt title={name}>
                <Glyph aria-hidden className="size-4 text-muted-foreground" />
                <span className="sr-only">{name}</span>
              </dt>
              {view[key].map((badge) => (
                <dd key={badge.label}>
                  <Status presentation={presentationOf(badge)} />
                </dd>
              ))}
            </div>
          ) : null,
        )}
      </dl>
    </section>
  );
}
