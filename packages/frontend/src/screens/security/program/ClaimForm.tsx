// spec/security/cases.md, "A case is received once, from a Slop receipt, a verified GitHub receipt or a confirmed legacy claim"
import { Alert, Button, Field, Input, Select } from "@repo/ui";
import { type FormEvent, useState } from "react";
import type { PageRuntime } from "../../../app/runtime.vibe";
import { run } from "./hooks.ts";
import { linkReport } from "./runtime.vibe";

export interface ProgramChoice {
  readonly id: string;
  readonly name: string;
  readonly security?: unknown;
}

export type ClaimFormViewProps = {
  projects: ReadonlyArray<ProgramChoice>;
  projectId: string;
  advisory: string;
  busy: boolean;
  error: string | null;
  onProject: (projectId: string) => void;
  onAdvisory: (advisory: string) => void;
  onSubmit: () => void;
};

const ghsa = "GHSA-[2-9cfghjmpqrvwx]{4}-[2-9cfghjmpqrvwx]{4}-[2-9cfghjmpqrvwx]{4}";

/** The project and GitHub advisory ID of a report filed on GitHub; only the ID, never its details. */
export function ClaimFormView({ projects, projectId, advisory, busy, error, onProject, onAdvisory, onSubmit }: ClaimFormViewProps) {
  if (projects.length === 0) return <p className="text-muted-foreground">No project runs a security program yet.</p>;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <Field label="Project">
        <Select value={projectId} onChange={(event) => onProject(event.target.value)}>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="GitHub advisory ID" hint="Only the ID. Do not paste report details here.">
        <Input autoComplete="off" pattern={ghsa} placeholder="GHSA-xxxx-xxxx-xxxx" required spellCheck={false} value={advisory} onChange={(event) => onAdvisory(event.target.value)} />
      </Field>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <Button type="submit" className="self-start" loading={busy}>
        {busy ? "Linking…" : "Link my GitHub report"}
      </Button>
    </form>
  );
}

export type ClaimFormProps = {
  runtime: PageRuntime;
  /** The signed-in reporter's GitHub user ID. */
  owner: string;
  projects: ReadonlyArray<ProgramChoice>;
  /** The case the link created, as the server returned it. */
  onCreated: (created: unknown) => void;
};

export function ClaimForm({ runtime, owner, projects, onCreated }: ClaimFormProps) {
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [advisory, setAdvisory] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projectId = projects.some((project) => project.id === selectedProjectId) ? selectedProjectId : (projects[0]?.id ?? "");
  const submit = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void run(runtime, linkReport(owner, projectId, advisory, key)).then((done) => {
      setBusy(false);
      if (!done.ok) return setError(done.message);
      const { key: used, result } = done.value;
      if (result.kind !== "done") {
        setKey(used);
        return setError(result.message);
      }
      setAdvisory("");
      setKey(null);
      onCreated(result.value.case);
    });
  };
  return <ClaimFormView projects={projects} projectId={projectId} advisory={advisory} busy={busy} error={error} onProject={setSelectedProjectId} onAdvisory={setAdvisory} onSubmit={submit} />;
}

/** `#security-link`: where a reporter links a report filed on GitHub. */
export function LinkReportSection(props: ClaimFormProps) {
  return (
    <section id="security-link" aria-labelledby="security-link-heading" className="flex flex-col gap-4">
      <h2 id="security-link-heading" className="text-xl font-semibold text-foreground">
        Link a report you submitted on GitHub
      </h2>
      <p className="text-muted-foreground">A maintainer verifies the link.</p>
      <ClaimForm {...props} />
    </section>
  );
}
