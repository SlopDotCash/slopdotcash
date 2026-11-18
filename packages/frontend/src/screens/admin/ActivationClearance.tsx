// spec/security/enforcement.md, "Each repository clears on its own admission, exemption or retained clean scan"; spec/frontend/projections.md, "An exemption is never displayed as a passed scan"; spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"
import { Button, Spinner } from "@repo/ui";
import { CircleAlert, RotateCcw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { PageRuntime } from "../../app/runtime.vibe";
import { useRun } from "../setup/proposal/run.ts";
import { adminReadMessages, vettingRead } from "./actions.vibe";
import { Chip } from "./parts.tsx";
import { activationClearance, type Clearance, clearanceLabel, clearanceTone } from "./vetting.ts";

/** A clearance as one badge: what cleared it, or the state short of cleared. */
export function ClearanceBadge({ clearance }: { clearance: Clearance | null }) {
  return (
    <Chip tone={clearanceTone(clearance)} icon={clearance?.state === "cleared" ? <ShieldCheck aria-hidden /> : <CircleAlert aria-hidden />}>
      {clearanceLabel(clearance)}
    </Chip>
  );
}

export type ActivationClearanceProps = {
  runtime: PageRuntime;
  actorId: string;
  projectId: string;
  revision: number;
  onAccessLost: () => void;
};

/** The current revision's clearance, read again on request, so an administrator activates only what cleared. */
export function ActivationClearance({ runtime, actorId, projectId, revision, onAccessLost }: ActivationClearanceProps) {
  const [attempt, setAttempt] = useState(0);
  const read = useRun(runtime, `activation:${actorId}:${projectId}:${revision}:${attempt}`, () => vettingRead(actorId), adminReadMessages.vetting, {
    settle: (value) => {
      if (value.kind === "lost") onAccessLost();
    },
  });
  const shown = () => {
    if (read === undefined || read.status === "running") return (
        <span title="Checking clearance" className="inline-flex">
          <Spinner size="sm" role="img" label="Checking clearance" />
        </span>
      );
    if (read.status === "failed") return read.message;
    if (read.value.kind === "lost") return read.value.message;
    const current = activationClearance(read.value.overview, projectId, revision);
    return current.kind === "message" ? current.text : <ClearanceBadge clearance={current.clearance} />;
  };
  return (
    <div className="flex items-center gap-2">
      <p role="status" className="text-sm">
        {shown()}
      </p>
      <Button variant="ghost" size="icon" aria-label="Refresh clearance" title="Refresh clearance" onClick={() => setAttempt((count) => count + 1)}>
        <RotateCcw aria-hidden />
      </Button>
    </div>
  );
}
