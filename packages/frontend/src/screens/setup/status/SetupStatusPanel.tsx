// spec/frontend/presentation.md, "Setup readiness shows authority, Slopbot, security and funding separately"; spec/backend/projects.md, "The setup check activates a paused project that passes every check"; spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"
import type { SetupStatus } from "@repo/backend/client";
import { Effect } from "effect";
import { useState } from "react";
import type { PageRuntime } from "../../../app/runtime.vibe";
import { useRun } from "../proposal/run.ts";
import { followSetup, type SetupView, setupUnfinished } from "./check.vibe";
import { SetupSummary } from "./SetupSummary.tsx";

export type SetupStatusPanelProps = {
  runtime: PageRuntime;
  projectId: string;
  /** The account the checks run for; a different signed-in account clears the status. */
  actorId: string;
  /** A status the server already returned, shown without checking again. */
  initial?: SetupStatus;
  /** Hears each status shown, and null when private access is lost. */
  onSetup?: (setup: SetupStatus | null) => void;
  showProjectLink?: boolean;
};

interface Attempt {
  readonly count: number;
  readonly requestScan: boolean;
}

function ActorSetup({ runtime, projectId, actorId, initial, onSetup, showProjectLink }: SetupStatusPanelProps) {
  const [view, setView] = useState<SetupView>({ setup: initial ?? null, busy: initial === undefined, error: null });
  const [attempt, setAttempt] = useState<Attempt>({ count: 0, requestScan: false });
  const show = (next: SetupView) =>
    Effect.sync(() => {
      setView(next);
      onSetup?.(next.setup);
    });
  const run = useRun(
    runtime,
    `setup:${projectId}:${actorId}:${attempt.count}`,
    () => followSetup({ projectId, actorId, requestScan: attempt.requestScan, initial: view.setup, checkFirst: attempt.count > 0 || initial === undefined }, show),
    setupUnfinished,
  );
  const shown: SetupView = run?.status === "failed" ? { ...view, busy: false, error: run.message } : view;
  const check = (requestScan: boolean) => {
    if (!shown.busy) setAttempt(({ count }) => ({ count: count + 1, requestScan }));
  };
  return <SetupSummary projectId={projectId} view={shown} onCheck={check} showProjectLink={showProjectLink} />;
}

/** The project's setup status for one account, checked on arrival unless given, again on request, and again when the reader returns while it waits on them. */
export function SetupStatusPanel(props: SetupStatusPanelProps) {
  return <ActorSetup key={`${props.projectId}:${props.actorId}`} {...props} />;
}
