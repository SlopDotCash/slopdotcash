// spec/frontend/presentation.md, "Settings keeps wallet and email controls expanded without account navigation tabs"
import { Alert, Button, EmptyState, Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@repo/ui";
import { useState } from "react";
import { retryOnce, useAction, useOnce } from "../../app/hooks.ts";
import type { PageRuntime } from "../../app/runtime.vibe";
import { loadTraceListing, setTraceLicensing, type TraceListing, updateTraceLicences } from "../../flows/account/traceLicensing.vibe";
import { formatDate } from "../projects/summary.ts";

export function TraceLicensing({ runtime, githubId }: { runtime: PageRuntime; githubId: string }) {
  const key = `trace-licensing:${githubId}`;
  const loaded = useOnce(runtime, key, () => loadTraceListing(githubId));
  const [override, setOverride] = useState<TraceListing | null>(null);
  const { busy, error, notice, setNotice, act } = useAction(runtime);

  if (loaded.status === "running") return <Spinner label="Loading trace licensing" />;
  if (loaded.status === "failed") {
    return (
      <Alert variant="destructive" action={<Button variant="outline" size="sm" onClick={() => retryOnce(runtime, key)}>Retry</Button>}>
        {loaded.message}
      </Alert>
    );
  }

  const listing = override ?? loaded.value;
  const { setting, totals, traces } = listing;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">
        Control whether your finalized private agent traces (v2/v3) may be licensed. Turning this on applies to future traces; you can also opt in eligible earlier traces or withdraw licensed ones at any time.
      </p>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {notice ? <p role="status" className="text-sm text-foreground">{notice}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <p className="font-medium text-foreground">
            {setting.enabled ? "Trace licensing is on" : "Trace licensing is off"}
          </p>
          <p className="text-xs text-muted-foreground">
            {setting.enabled && setting.since ? `Enabled since ${formatDate(setting.since)}` : "No future traces are licensed while off."}
            {setting.confirmedTermsVersion ? ` · Terms ${setting.confirmedTermsVersion}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={setting.enabled ? "outline" : "primary"}
            size="sm"
            loading={busy}
            onClick={() =>
              void act(setTraceLicensing(githubId, !setting.enabled), (next) => {
                setOverride(next);
                setNotice(next.setting.enabled ? "Trace licensing enabled." : "Trace licensing turned off.");
              })
            }
          >
            {setting.enabled ? "Turn off licensing" : "Enable trace licensing (v3)"}
          </Button>
          {totals.eligible > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
              onClick={() =>
                void act(updateTraceLicences(githubId, "opt-in"), (next) => {
                  setOverride(next);
                  setNotice("Eligible earlier traces opted in.");
                })
              }
            >
              Opt in {totals.eligible} eligible {totals.eligible === 1 ? "trace" : "traces"}
            </Button>
          ) : null}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {totals.traces} finalized {totals.traces === 1 ? "trace" : "traces"} · {totals.licensed} licensed · {totals.eligible} eligible
      </p>
      {traces.length === 0 ? (
        <EmptyState title="No finalized traces yet" />
      ) : (
        <div className="overflow-x-auto">
          <Table label="Finalized traces">
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Finalized</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {traces.map((trace) => (
                <TableRow key={trace.runId}>
                  <TableCell>{trace.projectId}</TableCell>
                  <TableCell className="font-mono text-xs">{trace.provider}/{trace.model}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(trace.finalizedAt)}</TableCell>
                  <TableCell className="text-xs">{trace.licence}</TableCell>
                  <TableCell className="text-right">
                    {trace.licence === "licensed" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void act(updateTraceLicences(githubId, "withdraw", [trace.runId]), (next) => {
                            setOverride(next);
                            setNotice("Trace licence withdrawn.");
                          })
                        }
                      >
                        Withdraw
                      </Button>
                    ) : trace.licence === "none" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void act(updateTraceLicences(githubId, "opt-in", [trace.runId]), (next) => {
                            setOverride(next);
                            setNotice("Trace opted in.");
                          })
                        }
                      >
                        Opt in
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
