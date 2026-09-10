import { useEffect, useState } from "react";
import { readBoundedJson } from "./lib/browser-json";
import type { CycleIndexEntry } from "./lib/cycle-index";
import {
  assertSquadsExecutionIndex,
  assertSquadsExecutionObservation,
  isSquadsBatch,
  type SquadsExecutionBinding,
  type SquadsExecutionObservation,
  squadsExecutionRootAccount,
  squadsExecutionTrackerLabel,
} from "./lib/squads-execution";

export function SquadsTracking({ cycle }: { cycle: CycleIndexEntry }) {
  const [binding, setBinding] = useState<SquadsExecutionBinding | null>(null);
  const [observation, setObservation] =
    useState<SquadsExecutionObservation | null>(null);
  const [status, setStatus] = useState("Loading reviewed vault proposal…");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 35000);
    setBinding(null);
    setObservation(null);
    setStatus("Loading reviewed vault proposal…");
    void (async () => {
      const response = await fetch(
        `/data/squads-executions.json?attempt=${retry}`,
        {
          cache: "no-store",
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error("Execution bindings are unavailable.");
      const index = assertSquadsExecutionIndex(
        await readBoundedJson(response, 2 * 1024 * 1024, "Execution index"),
      );
      const entry = index.executions.find(
        (r) => r.projectId === cycle.projectId && r.cycleId === cycle.cycleId,
      );
      if (!entry) {
        if (active)
          setStatus(
            "No reviewed Squads proposal has been linked to this cycle.",
          );
        return;
      }
      const selected = entry.binding;
      if (
        !cycle.files.executionPlan ||
        selected.planSha256 !== cycle.files.executionPlan.sha256 ||
        !cycle.files.allocation ||
        entry.allocationSha256 !== cycle.files.allocation.sha256
      )
        throw new Error(
          "Vault proposal does not match this cycle's exact execution plan.",
        );
      if (active) setBinding(selected);
      const result = await fetch(entry.observationUrl, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!result.ok)
        throw new Error(
          "Live Squads verification is unavailable; payment status remains unchanged.",
        );
      const observed = assertSquadsExecutionObservation(
        await readBoundedJson(result, 64000, "Execution observation"),
        selected,
      );
      if (active) {
        setObservation(observed);
        setStatus(squadsExecutionTrackerLabel(observed));
      }
    })()
      .catch((error: unknown) => {
        if (active)
          setStatus(
            error instanceof Error
              ? error.message
              : "Execution verification unavailable.",
          );
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [cycle, retry]);
  useEffect(() => {
    if (!observation) return;
    const update = () => setStatus(squadsExecutionTrackerLabel(observation));
    const timer = window.setInterval(update, 1000);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [observation]);
  return (
    <section aria-label="Squads proposal tracking">
      <h4>Vault proposal</h4>
      <p role="status">{status}</p>
      {binding && (
        <p>
          <a
            href={`https://explorer.solana.com/address/${binding.proposalAccount}`}
          >
            Proposal {binding.transactionIndex}
          </a>{" "}
          ·{" "}
          <a
            href={`https://explorer.solana.com/address/${squadsExecutionRootAccount(binding)}`}
          >
            {isSquadsBatch(binding)
              ? "Batch instructions"
              : "Transaction instructions"}
          </a>
        </p>
      )}
      {observation?.batchProgress && (
        <p>
          {observation.batchProgress.executedChildren} of{" "}
          {observation.batchProgress.totalChildren} batch transactions observed
          as executed. Payment totals update only after finalized settlement
          verification.
        </p>
      )}
      {observation && (
        <p>
          Observed {observation.observedAt}. {observation.reason}
        </p>
      )}
      <button type="button" onClick={() => setRetry((n) => n + 1)}>
        Refresh proposal status
      </button>
    </section>
  );
}
