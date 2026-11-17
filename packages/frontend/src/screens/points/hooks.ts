// spec/frontend/requests.md, "Only the current request may publish its validated result"; spec/frontend/projections.md, "Monthly and lifetime standings sum the same accepted-work history"
import { useMemo } from "react";
import type { Shown } from "../home/listing.ts";
import { type JournalRows, type StandingHistory, standingHistory } from "./standings.ts";

/** @throws {never} */
function historyOf(journal: JournalRows | undefined, projectId: string | undefined): StandingHistory | undefined {
  if (journal === undefined) return undefined;
  try {
    return standingHistory(journal, projectId);
  } catch {
    return undefined;
  }
}

/** The journal read as standings of every project or of one; a journal whose months cannot be read is invalid, never an empty board. */
export function useStandingHistory(journal: Shown<JournalRows>, projectId?: string): Shown<StandingHistory> {
  const value = useMemo(() => historyOf(journal.value, projectId), [journal.value, projectId]);
  const status = journal.value !== undefined && value === undefined ? "Invalid" : journal.status;
  return { status, value, onRetry: journal.onRetry };
}
