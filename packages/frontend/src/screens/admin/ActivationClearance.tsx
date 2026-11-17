// spec/security/enforcement.md, "Each repository clears on its own admission, exemption or retained clean scan"; spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"
import { Button } from "@repo/ui";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import type { PageRuntime } from "../../app/runtime.vibe";
import { useRun } from "../setup/proposal/run.ts";
import { adminReadMessages, vettingRead } from "./actions.vibe";
import { activationClearanceText } from "./vetting.ts";

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
  const text = read === undefined || read.status === "running" ? "Checking security clearance…" : read.status === "failed" ? read.message : read.value.kind === "lost" ? read.value.message : activationClearanceText(read.value.overview, projectId, revision);
  return (
    <div className="flex items-center gap-2">
      <p role="status" className="text-sm">
        {text}
      </p>
      <Button variant="ghost" size="icon" aria-label="Refresh clearance" title="Refresh clearance" onClick={() => setAttempt((count) => count + 1)}>
        <RotateCcw aria-hidden />
      </Button>
    </div>
  );
}
