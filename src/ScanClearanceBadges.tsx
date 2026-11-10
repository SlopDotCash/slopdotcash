import {
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
  Eye,
  Info,
  ListChecks,
  Lock,
  ScanSearch,
  Sparkles,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  ScanClearanceIcon,
  ScanClearanceView,
} from "./lib/scan-clearance";
import { StatusBadge } from "./Presentation";

const ICONS: Record<ScanClearanceIcon, ReactNode> = {
  pass: <CircleCheck />,
  fail: <CircleX />,
  skip: <CircleSlash />,
  partial: <CircleDashed />,
  held: <Lock />,
  note: <Info />,
  review: <Sparkles />,
};

const GROUPS = [
  ["checks", "Checks", <ListChecks key="checks" />],
  ["coverage", "Coverage", <ScanSearch key="coverage" />],
  ["review", "Review", <Eye key="review" />],
] as const;

/** Why an incomplete scan did not clear, as one row of badges per group. */
export function ScanClearanceBadges({
  view,
}: {
  view: ScanClearanceView | null;
}) {
  if (!view) return null;
  return (
    <section aria-label="Why the scan did not clear">
      <dl className="scan-clearance">
        {GROUPS.map(([key, name, icon]) =>
          view[key].length ? (
            <div key={key}>
              <dt title={name}>
                <span aria-hidden="true">{icon}</span>
                <span className="visually-hidden">{name}</span>
              </dt>
              <dd>
                {view[key].map((badge) => (
                  <StatusBadge
                    key={badge.label}
                    tone={badge.tone}
                    icon={ICONS[badge.icon]}
                  >
                    {badge.label}
                  </StatusBadge>
                ))}
              </dd>
            </div>
          ) : null,
        )}
      </dl>
    </section>
  );
}
