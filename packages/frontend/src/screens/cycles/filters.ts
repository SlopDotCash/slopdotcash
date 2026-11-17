// spec/frontend/views.md, "Cycle archive filters keep only selections that a published cycle supports"
import type { CycleIndexEntry } from "@repo/settlement/client";
import { type ArchiveFilter, type CycleRecord, cycleMatches, keptFilter, noMatchNotice } from "../../../gen/frontend__views.ts";

export type FilterKey = "project" | "month" | "state";

export const filterKeys: ReadonlyArray<FilterKey> = ["project", "month", "state"];

export const filterLabels: Readonly<Record<FilterKey, string>> = { project: "Project", month: "Month", state: "State" };

const patterns: Readonly<Record<FilterKey, RegExp>> = {
  project: /^[a-z0-9-]{1,48}$/u,
  month: /^\d{4}-(0[1-9]|1[0-2])$/u,
  state: /^[a-z-]{1,40}$/u,
};

export interface ArchiveView {
  readonly filter: ArchiveFilter;
  readonly changed: boolean;
  readonly cycles: ReadonlyArray<CycleIndexEntry>;
  readonly noMatch: boolean;
  readonly options: Readonly<Record<FilterKey, ReadonlyArray<string>>>;
  readonly offered: ReadonlyArray<FilterKey>;
}

/** The selections the query asks for; a value of the wrong shape is no selection. @throws {never} */
export function requestedFilter(params: URLSearchParams): ArchiveFilter {
  const read = (key: FilterKey) => {
    const value = params.get(key) ?? "";
    return patterns[key].test(value) ? value : "";
  };
  return { projectFilter: read("project"), monthFilter: read("month"), stateFilter: read("state") };
}

/** @throws {never} */
export function selected(filter: ArchiveFilter, key: FilterKey): string {
  return key === "project" ? filter.projectFilter : key === "month" ? filter.monthFilter : filter.stateFilter;
}

/** @throws {never} */
function recordOf(cycle: CycleIndexEntry): CycleRecord {
  return { project: cycle.projectId, month: cycle.cycleId, cycleState: cycle.state };
}

/** Newest month first, then by project. @throws {never} */
export function archiveOrder(cycles: ReadonlyArray<CycleIndexEntry>): ReadonlyArray<CycleIndexEntry> {
  return [...cycles].sort((left, right) => right.cycleId.localeCompare(left.cycleId) || left.projectId.localeCompare(right.projectId));
}

/** The archive as the requested filters show it once the index is loaded: kept selections, the matching cycles and the filter controls offered. @throws {never} */
export function archiveView(all: ReadonlyArray<CycleIndexEntry> | undefined, requested: ArchiveFilter): ArchiveView {
  const cycles = all ?? [];
  const records = cycles.map(recordOf);
  const filter = keptFilter(records, requested, all !== undefined);
  const distinct = (pick: (cycle: CycleIndexEntry) => string) => [...new Set(cycles.map(pick))];
  const options = { project: distinct((cycle) => cycle.projectId), month: distinct((cycle) => cycle.cycleId), state: distinct((cycle) => cycle.state) };
  return {
    filter,
    changed: filterKeys.some((key) => selected(filter, key) !== selected(requested, key)),
    cycles: cycles.filter((cycle) => cycleMatches(recordOf(cycle), filter)),
    noMatch: noMatchNotice(records, filter),
    options,
    offered: filterKeys.filter((key) => options[key].length > 1 || selected(filter, key) !== ""),
  };
}

/** The filter as query parameters, an empty selection removing its key. @throws {never} */
export function filterQuery(filter: ArchiveFilter): Readonly<Record<FilterKey, string>> {
  return { project: filter.projectFilter, month: filter.monthFilter, state: filter.stateFilter };
}
