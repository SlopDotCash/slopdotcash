// spec/frontend/projections.md, "Monthly and lifetime standings sum the same accepted-work history"
import type { Effect } from "effect";
import { retryOnce, useNow, useOnce } from "../../app/hooks.ts";
import type { PageRuntime } from "../../app/runtime.vibe";
import { useShownRead } from "../projects/hooks.ts";
import { ContributorStandings } from "./ContributorStandings.tsx";
import { useStandingHistory } from "./hooks.ts";
import { contributorReads, contributorRuntime } from "./reads.vibe";

export type ProjectStandingsProps = {
  runtime: PageRuntime;
  projectId: string;
};

type Reads = Effect.Success<ReturnType<typeof contributorReads>>;

function Standings({ reads, projectId, nowMs }: { reads: Reads; projectId: string; nowMs: number }) {
  const journal = useShownRead(reads.journal, "all");
  const history = useStandingHistory(journal, projectId);
  return <ContributorStandings compact history={history} period="month" query="" page={1} nowMs={nowMs} />;
}

export function ProjectStandings({ runtime, projectId }: ProjectStandingsProps) {
  const section = contributorRuntime(runtime);
  const nowMs = useNow();
  const reads = useOnce(section, "reads", () => contributorReads());
  if (reads.status === "done") return <Standings reads={reads.value} projectId={projectId} nowMs={nowMs} />;
  return (
    <ContributorStandings
      compact
      history={{ status: reads.status === "running" ? "Loading" : "Failed", value: undefined, onRetry: () => retryOnce(section, "reads") }}
      period="month"
      query=""
      page={1}
      nowMs={nowMs}
    />
  );
}
