// spec/frontend/projections.md, "Monthly and lifetime standings sum the same accepted-work history"
import type { Effect } from "effect";
import type { PageRuntime } from "../../app/runtime.vibe";
import { useShownRead } from "../projects/hooks.ts";
import { useOnce } from "../security/program/hooks.ts";
import { ContributorStandings } from "./ContributorStandings.tsx";
import { useStandingHistory } from "./hooks.ts";
import { contributorReads, contributorRuntime } from "./reads.vibe";

export type ProjectStandingsProps = {
  /** The page whose services the journal is read with. */
  runtime: PageRuntime;
  /** The project whose Points are ranked. */
  projectId: string;
};

type Reads = Effect.Success<ReturnType<typeof contributorReads>>;

function Standings({ reads, projectId }: { reads: Reads; projectId: string }) {
  const journal = useShownRead(reads.journal, "all");
  const history = useStandingHistory(journal, projectId);
  return <ContributorStandings compact history={history} period="month" query="" page={1} nowMs={Date.now()} />;
}

/** The project's own contributor standings this month: ten rows, ranked by the project's Points only. */
export function ProjectStandings({ runtime, projectId }: ProjectStandingsProps) {
  const reads = useOnce(contributorRuntime(runtime), "reads", () => contributorReads());
  if (reads.status === "done") return <Standings reads={reads.value} projectId={projectId} />;
  return <ContributorStandings compact history={{ status: reads.status === "running" ? "Loading" : "Failed", value: undefined, onRetry: () => location.reload() }} period="month" query="" page={1} nowMs={Date.now()} />;
}
