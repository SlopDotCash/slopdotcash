// spec/frontend/presentation.md, "Settings keeps wallet and email controls expanded without account navigation tabs"
import { Alert, Button, Checkbox, EmptyState, Label, Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@repo/ui";
import { Cause, Exit } from "effect";
import { useState } from "react";
import { retryOnce, useOnce } from "../../app/hooks.ts";
import type { PageRuntime } from "../../app/runtime.vibe";
import {
  licenseTraces,
  loadTraceListing,
  setTraceLicensing,
  type TraceListing,
  type TraceOptInRequest,
  type TraceRow,
  type TraceTermsVersion,
} from "../../flows/account/traceLicensing.vibe";
import { formatDate } from "../projects/summary.ts";

const countFormat = new Intl.NumberFormat("en-US");

const termsLabels: Readonly<Record<TraceTermsVersion, string>> = {
  "private-trace-v1": "v1",
  "private-trace-v2": "v2",
  "private-trace-v3": "v3",
};

const licenceLabels: Readonly<Record<TraceRow["licence"], string>> = {
  none: "not licensed",
  licensed: "licensed",
  withdrawn: "withdrawn",
};

function tracesWord(count: number): string {
  return count === 1 ? "trace" : "traces";
}

function errorFrom(cause: Cause.Cause<unknown>): { readonly message: string; readonly code: string | null } {
  const failure = Cause.squash(cause);
  if (typeof failure === "object" && failure !== null && "message" in failure && typeof failure.message === "string") {
    const code = "code" in failure && typeof failure.code === "string" ? failure.code : null;
    return { message: failure.message, code };
  }
  return { message: "Trace licensing failed.", code: null };
}

function TracesList({
  listing,
  needsV3,
  busy,
  onLicenseAll,
  onLicenseRow,
  onMore,
}: {
  listing: TraceListing;
  needsV3: boolean;
  busy: boolean;
  onLicenseAll: () => void;
  onLicenseRow: (runId: string) => void;
  onMore: () => void;
}) {
  const { setting, totals, traces, nextCursor } = listing;
  if (totals.traces === 0) return <EmptyState title="No traces yet" />;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Your traces ({countFormat.format(totals.traces)}) · licensed {countFormat.format(totals.licensed)}
        </p>
        {setting.enabled && !needsV3 && totals.eligible > 0 ? (
          <Button variant="secondary" size="sm" disabled={busy} onClick={onLicenseAll}>
            License all {countFormat.format(totals.eligible)} earlier {tracesWord(totals.eligible)}
          </Button>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <Table label="Finalized traces">
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Terms</TableHead>
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
                <TableCell className="text-xs text-muted-foreground">{termsLabels[trace.termsVersion]}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDate(trace.finalizedAt)}</TableCell>
                <TableCell className="text-xs">{licenceLabels[trace.licence]}</TableCell>
                <TableCell className="text-right">
                  {setting.enabled && trace.licence !== "licensed" && !(needsV3 && trace.termsVersion === "private-trace-v3") ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`License trace of ${formatDate(trace.finalizedAt)}, ${trace.projectId}`}
                      disabled={busy}
                      onClick={() => onLicenseRow(trace.runId)}
                    >
                      License
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {nextCursor !== null ? (
        <div>
          <Button variant="outline" size="sm" disabled={busy} onClick={onMore}>
            More
          </Button>
        </div>
      ) : null}
    </>
  );
}

export function TraceLicensing({ runtime, githubId }: { runtime: PageRuntime; githubId: string }) {
  const key = `trace-licensing:${githubId}`;
  const loaded = useOnce(runtime, key, () => loadTraceListing(githubId));
  const [override, setOverride] = useState<TraceListing | null>(null);
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [confirmAgainRequired, setConfirmAgainRequired] = useState(false);

  const lead = (
    <p className="text-sm text-muted-foreground">
      Let Slop license your traces to AI model builders for pay. You get 50% of each sale.{" "}
      <a href="/protocol/private-trace-v3.md" className="text-primary underline underline-offset-4 hover:decoration-2">
        Terms
      </a>
    </p>
  );

  if (loaded.status === "running") return <Spinner label="Loading your traces" />;
  if (loaded.status === "failed" && override === null) {
    return (
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
        {lead}
        <Alert variant="destructive" action={<Button variant="outline" size="sm" onClick={() => retryOnce(runtime, key)}>Retry</Button>}>
          {loaded.message}
        </Alert>
      </div>
    );
  }

  const listing = override ?? (loaded.status === "done" ? loaded.value : null);
  if (listing === null) return null;
  const { setting, totals, nextCursor } = listing;
  const needsV3 = confirmAgainRequired || (setting.enabled && setting.confirmedTermsVersion !== "private-trace-v3");

  const reloadListing = async () => {
    const exit = await runtime.runPromiseExit(loadTraceListing(githubId));
    if (Exit.isSuccess(exit)) {
      setOverride(exit.value);
      setReloadError(null);
      if (exit.value.setting.confirmedTermsVersion === "private-trace-v3" || !exit.value.setting.enabled) {
        setConfirmAgainRequired(false);
      }
      return exit.value;
    }
    setReloadError(errorFrom(exit.cause).message);
    return null;
  };

  const turnOn = async () => {
    if (busy || !ticked) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const exit = await runtime.runPromiseExit(setTraceLicensing(githubId, true, true));
    if (Exit.isSuccess(exit)) {
      setTicked(false);
      setConfirmAgainRequired(false);
      setOverride({ ...listing, setting: exit.value.setting });
      await reloadListing();
    } else {
      const detail = errorFrom(exit.cause);
      setError(detail.message);
      if (detail.code === "setting_changed") await reloadListing();
    }
    setBusy(false);
  };

  const turnOff = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const exit = await runtime.runPromiseExit(setTraceLicensing(githubId, false));
    if (Exit.isSuccess(exit)) {
      setConfirmAgainRequired(false);
      const { setting: nextSetting, withdrawn } = exit.value;
      setOverride({
        ...listing,
        setting: nextSetting,
        totals: { traces: listing.totals.traces, licensed: 0, eligible: listing.totals.traces },
        traces: listing.traces.map((row) => (row.licence === "licensed" ? { ...row, licence: "withdrawn" } : row)),
      });
      setNotice(`Turned off. ${countFormat.format(withdrawn)} ${tracesWord(withdrawn)} withdrawn.`);
      await reloadListing();
    } else {
      const detail = errorFrom(exit.cause);
      setError(detail.message);
      if (detail.code === "setting_changed") await reloadListing();
    }
    setBusy(false);
  };

  const licenseChoice = async (choice: TraceOptInRequest, singleRunId?: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const exit = await runtime.runPromiseExit(licenseTraces(githubId, choice));
    if (Exit.isSuccess(exit)) {
      if (singleRunId !== undefined) {
        const moved = Math.min(exit.value.licensed, listing.totals.eligible);
        setOverride({
          ...listing,
          totals: {
            traces: listing.totals.traces,
            licensed: listing.totals.licensed + moved,
            eligible: listing.totals.eligible - moved,
          },
          traces: listing.traces.map((row) => (row.runId === singleRunId ? { ...row, licence: "licensed" } : row)),
        });
      } else {
        await reloadListing();
      }
    } else {
      const detail = errorFrom(exit.cause);
      setError(detail.message);
      if (detail.code === "confirm_again") {
        setConfirmAgainRequired(true);
        await reloadListing();
      } else if (detail.code === "count_changed" || detail.code === "licensing_off") {
        await reloadListing();
      }
    }
    setBusy(false);
  };

  const licenseAll = () => {
    if (typeof window !== "undefined" && !window.confirm(`License ${countFormat.format(totals.eligible)} ${tracesWord(totals.eligible)}? You can turn this off any time.`)) {
      return;
    }
    void licenseChoice({ all: true, expectedCount: totals.eligible });
  };

  const loadMore = async () => {
    if (busy || nextCursor === null) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const exit = await runtime.runPromiseExit(loadTraceListing(githubId, nextCursor));
    if (Exit.isSuccess(exit)) {
      setOverride({ ...exit.value, traces: [...listing.traces, ...exit.value.traces] });
    } else {
      setError(errorFrom(exit.cause).message);
    }
    setBusy(false);
  };

  const confirmId = `trace-provider-terms-${githubId}`;
  const confirmBox = (
    <div className="flex items-start gap-2.5">
      <Checkbox
        id={confirmId}
        checked={ticked}
        disabled={busy}
        onCheckedChange={(checked) => {
          setTicked(checked === true);
          setError(null);
        }}
      />
      <Label htmlFor={confirmId} className="text-sm leading-body text-foreground">
        My model provider&apos;s terms let me license these runs&apos; output, including the code they contain.
      </Label>
    </div>
  );

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      {lead}
      {setting.enabled && setting.since !== null ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-foreground">On since {formatDate(setting.since)}</p>
          {needsV3 ? (
            <div className="flex flex-col gap-3 rounded-md border border-border p-3">
              <p className="text-sm text-foreground">
                Sessions uploaded under v3 include your project&apos;s code. Confirm again to license them.
              </p>
              {confirmBox}
              <div>
                <Button variant="secondary" size="sm" disabled={busy || !ticked} loading={busy} onClick={() => void turnOn()}>
                  Confirm for v3
                </Button>
              </div>
            </div>
          ) : null}
          <div>
            <Button variant="outline" size="sm" disabled={busy} loading={busy} onClick={() => void turnOff()}>
              Turn off
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {confirmBox}
          <div>
            <Button variant="primary" size="sm" disabled={busy || !ticked} loading={busy} onClick={() => void turnOn()}>
              Turn on
            </Button>
          </div>
        </div>
      )}
      {notice ? <p role="status" className="text-sm text-foreground">{notice}</p> : null}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {reloadError ? (
        <Alert variant="destructive" action={<Button variant="outline" size="sm" disabled={busy} onClick={() => void reloadListing()}>Retry</Button>}>
          {reloadError}
        </Alert>
      ) : null}
      <TracesList
        listing={listing}
        needsV3={needsV3}
        busy={busy}
        onLicenseAll={licenseAll}
        onLicenseRow={(runId) => void licenseChoice({ runIds: [runId] }, runId)}
        onMore={() => void loadMore()}
      />
    </div>
  );
}
