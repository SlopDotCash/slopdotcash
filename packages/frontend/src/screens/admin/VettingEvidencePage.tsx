// spec/security/privacy.md, "Read authorization comes from the current case roles and is audited before delivery"; spec/security/evidence.md, "Successful admission stays permanent and ordinary evidence waits ninety days"; spec/frontend/navigation.md, "Every existing product route is one Page and only private destinations need an account"; spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"
import { Alert, Button, Disclosure, Field, Input, PageHeader, Spinner } from "@repo/ui";
import { LockKeyhole, TriangleAlert } from "lucide-react";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import type { PageProps } from "../../app/pages.ts";
import type { PageRuntime } from "../../app/runtime.vibe";
import { SignInPanel } from "../../app/SignInPanel.tsx";
import { useAddress } from "../../app/useAddress.ts";
import { loginHrefFor, useSession } from "../../app/useSession.ts";
import type { EvidenceRun } from "../../flows/projects/vetting.vibe";
import { useRun } from "../setup/proposal/run.ts";
import { evidenceInventory } from "./actions.vibe";
import { EvidenceItem } from "./EvidenceItem.tsx";
import { EvidenceRunCard, type EvidenceRunView } from "./EvidenceRunCard.tsx";
import { Chip, page } from "./parts.tsx";
import { isRecord } from "./projects.ts";

/** @throws {never} */
function policyVersionOf(run: EvidenceRunView, fallback: string): string {
  return isRecord(run.policy) && typeof run.policy.version === "string" ? run.policy.version : fallback;
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className={page}>
      <PageHeader
        icon={<LockKeyhole aria-hidden />}
        title="Vetting evidence"
        actions={
          <Chip tone="Caution" icon={<TriangleAlert aria-hidden />}>
            Hostile content
          </Chip>
        }
      />
      {children}
    </main>
  );
}

function Inventory({ runtime, actorId, lookup, attempt, onEdit, onRetry }: { runtime: PageRuntime; actorId: string; lookup: EvidenceRun; attempt: number; onEdit: () => void; onRetry: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const read = useRun(runtime, `evidence:${actorId}:${lookup.assessmentId}:${lookup.runId}:${attempt}`, () => evidenceInventory(actorId, lookup), "Evidence could not be loaded");
  if (read === undefined || read.status === "running")
    return (
      <p role="status">
        <span title="Loading" className="inline-flex">
          <Spinner size="sm" role="img" label="Loading" />
        </span>
      </p>
    );
  if (read.status === "failed")
    return (
      <Alert variant="destructive">
        {read.message}{" "}
        <Button variant="link" onClick={onEdit}>
          Edit
        </Button>{" "}
        <Button variant="link" onClick={onRetry}>
          Retry
        </Button>
      </Alert>
    );
  const overview = read.value;
  return (
    <>
      {overview.runs.map((run) => {
        const prefix = `${run.assessmentId}/${run.runId}/`;
        return (
          <EvidenceRunCard
            key={prefix}
            run={run}
            retentionBoundary={overview.retentionBoundary}
            policyVersion={policyVersionOf(run, overview.policy.version)}
            selected={selected?.startsWith(prefix) ? selected.slice(prefix.length) : null}
            onSelect={(sha256) => setSelected(`${prefix}${sha256}`)}
            item={(object) => <EvidenceItem key={`${actorId}:${prefix}${object.sha256}`} runtime={runtime} run={{ assessmentId: run.assessmentId, runId: run.runId }} object={object} actorId={actorId} />}
          />
        );
      })}
    </>
  );
}

/** Private vetting evidence for a scanner operator: the inventory of one assessment run, and each object read or downloaded only through a fresh audited grant. */
export function VettingEvidencePage({ runtime }: PageProps) {
  const address = useAddress();
  const shown = useSession(runtime);
  const [initial] = useState(() => {
    const query = new URLSearchParams(location.search);
    return { assessmentId: query.get("assessmentId") ?? "", runId: query.get("runId") ?? "" };
  });
  const [assessmentId, setAssessmentId] = useState(initial.assessmentId);
  const [runId, setRunId] = useState(initial.runId);
  const [lookup, setLookup] = useState<EvidenceRun | null>(initial.assessmentId && initial.runId ? initial : null);
  const [open, setOpen] = useState(lookup === null);
  const [attempt, setAttempt] = useState(0);
  const assessmentInputRef = useRef<HTMLInputElement>(null);
  const pendingFocusRef = useRef(false);
  if (shown === undefined)
    return (
      <Frame>
        <SignInPanel view={{ status: "checking" }} href="/login" />
      </Frame>
    );
  if (shown.view.status !== "signedIn")
    return (
      <Frame>
        <SignInPanel view={shown.view} href={loginHrefFor(shown, address)} />
      </Frame>
    );
  const actorId = shown.view.session.githubId;
  const inspect = (event: FormEvent) => {
    event.preventDefault();
    const next = { assessmentId: assessmentId.trim(), runId: runId.trim() };
    const url = new URL(location.href);
    url.searchParams.set("assessmentId", next.assessmentId);
    url.searchParams.set("runId", next.runId);
    history.replaceState(history.state, "", url);
    setLookup(next);
    setAttempt((count) => count + 1);
    setOpen(false);
  };
  const assessmentRef = (node: HTMLInputElement | null) => {
    assessmentInputRef.current = node;
    if (node !== null && pendingFocusRef.current) {
      pendingFocusRef.current = false;
      node.focus();
    }
  };
  const edit = () => {
    if (open) return assessmentInputRef.current?.focus();
    pendingFocusRef.current = true;
    setOpen(true);
  };
  return (
    <Frame>
      <Disclosure summary="Find evidence" open={open} onOpenChange={setOpen}>
        <form className="flex flex-col gap-4" onSubmit={inspect}>
          <Field label="Assessment ID">
            <Input ref={assessmentRef} required value={assessmentId} onChange={(event) => setAssessmentId(event.target.value)} />
          </Field>
          <Field label="Run ID">
            <Input required value={runId} onChange={(event) => setRunId(event.target.value)} />
          </Field>
          <Button type="submit" className="self-start">
            Load
          </Button>
        </form>
      </Disclosure>
      {lookup ? <Inventory key={actorId} runtime={runtime} actorId={actorId} lookup={lookup} attempt={attempt} onEdit={edit} onRetry={() => setAttempt((count) => count + 1)} /> : null}
    </Frame>
  );
}
