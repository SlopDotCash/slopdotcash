// spec/frontend/views.md, "A published maintainer share shows this month's share, and next month's while a change waits"
import { parseBaseUnits } from "@repo/settlement/kernels/amounts";
import { parsePeriod } from "@repo/settlement/kernels/calendar";
import { Result, Schema } from "effect";
import { monthShareOf } from "../../gen/backend__projects.ts";
import { type ShareShown, shareShown } from "../../gen/frontend__views.ts";
import type { RegistryProject } from "../reads/registry.vibe";

export interface MaintainerShareLines {
  readonly notice: string;
  readonly card: string;
}

const SharedPool = Schema.Struct({
  reward: Schema.Struct({
    kind: Schema.Literals(["monthly-pool"]),
    monthlyCapMinor: Schema.String,
    maintainerShare: Schema.optional(Schema.Number),
    maintainerShareHistory: Schema.optional(Schema.Array(Schema.Struct({ throughCycle: Schema.String, basisPoints: Schema.Number }))),
  }),
});

const decodePool = Schema.decodeUnknownResult(SharedPool);
const monthName = new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" });
const deciders = "split among the maintainers who merge or close outside pull requests";

/** @throws {never} */
function shareText(basisPoints: number): string {
  return basisPoints > 0 ? `${basisPoints / 100}%` : "none";
}

/** @throws {never} */
function periodName(period: number): string {
  return monthName.format(new Date(Date.UTC(Math.trunc(period / 100), (period % 100) - 1, 1)));
}

/** A registry project's maintainer share in the UTC month of `now`: the history entry that covers the month, else the setting, and the setting from the next month. @throws {RangeError} */
export function publishedShare(project: RegistryProject, now: Date): ShareShown {
  const decoded = decodePool(project);
  const period = parsePeriod(now.toISOString().slice(0, 7));
  if (period === undefined) return { tag: "NoShare" };
  const reward = Result.isSuccess(decoded) ? decoded.success.reward : undefined;
  const setting = reward?.maintainerShare ?? 0;
  const history = (reward?.maintainerShareHistory ?? []).flatMap((entry) => {
    const throughMonth = parsePeriod(entry.throughCycle);
    return throughMonth === undefined ? [] : [{ throughMonth, basisPoints: entry.basisPoints }];
  });
  const thisMonth = monthShareOf(history, setting, period);
  const amount = reward === undefined ? undefined : parseBaseUnits(reward.monthlyCapMinor);
  return shareShown(reward !== undefined, amount !== undefined && amount > 0n, thisMonth, setting, period);
}

/** The project page sentence and the card line for a project's published maintainer share in the UTC month of `now`, or null when there is none to show. @throws {RangeError} */
export function maintainerShareLines(project: RegistryProject, now: Date): MaintainerShareLines | null {
  const shown = publishedShare(project, now);
  switch (shown.tag) {
    case "NoShare":
      return null;
    case "SameShare":
      return { notice: `Maintainer share: ${shareText(shown.basisPoints)} of the monthly amount, ${deciders}.`, card: `Maintainer share ${shareText(shown.basisPoints)}` };
    case "ChangingShare": {
      const from = periodName(shown.fromPeriod);
      return {
        notice: `Maintainer share: ${shareText(shown.thisMonth)} of the monthly amount this month, ${shareText(shown.fromNext)} from ${from}, ${deciders}.`,
        card: `Maintainer share ${shareText(shown.fromNext)} from ${from}`,
      };
    }
    default: {
      const _exhaustive: never = shown;
      return _exhaustive;
    }
  }
}
