// spec/backend/projects.md, "Administrators hold, delist, change the steward or place a project"; spec/frontend/navigation.md, "Administration sections and project selection are parameters of the one Administration page"; spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"; spec/frontend/requests.md, "Loading, empty, stale, denied, invalid and unavailable remain distinct"
import { Input, NavTab, NavTabs, Status } from "@repo/ui";
import { ArrowLeft, ArrowUpRight, Code2, LayoutGrid, Search, Settings2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { PageRuntime } from "../../app/runtime.vibe";
import { SkillPreview } from "../setup/fields/SkillPreview.tsx";
import { useRun } from "../setup/proposal/run.ts";
import { adminProjectsRead, adminReadMessages } from "./actions.vibe";
import { DelistButton } from "./DelistButton.tsx";
import { EnforcementPanel } from "./EnforcementPanel.tsx";
import { LoadFailure, navigateWithin, Notice, openWithin, Waiting } from "./parts.tsx";
import { ProjectEditor } from "./ProjectEditor.tsx";
import { ProjectCounts, ProjectFacts, ProjectList } from "./ProjectList.tsx";
import { type AdminProject, adminAddressOf, adminHref, projectPresentation, type ProjectSection, shownProjects } from "./projects.ts";
import { VettingSection } from "./VettingSection.tsx";

const sections = [
  ["overview", "Overview", LayoutGrid],
  ["security", "Security", ShieldCheck],
  ["settings", "Settings", Settings2],
  ["skills", "Skills", Code2],
] as const;

type SelectedProps = {
  runtime: PageRuntime;
  project: AdminProject;
  actorId: string;
  section: ProjectSection;
  onAccessLost: () => void;
  onSaved: (note: string) => void;
};

function SelectedProject({ runtime, project, actorId, section, onAccessLost, onSaved }: SelectedProps) {
  const backToOverview = () => {
    const current = adminAddressOf(`${location.pathname}${location.search}${location.hash}`);
    if (current.project !== project.id || current.view !== "AdminSettings") return;
    navigateWithin(adminHref(project.id));
    document.getElementById("admin-project-title")?.focus();
    scrollTo({ top: 0, behavior: "auto" });
  };
  return (
    <article className="flex flex-col gap-6 rounded-md border border-border p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 id="admin-project-title" tabIndex={-1} className="text-xl font-semibold text-foreground">
            {project.manifest.name}
          </h3>
          <span className="font-mono text-xs text-muted-foreground">{project.id}</span>
        </div>
        <div className="flex items-center gap-3">
          <Status presentation={projectPresentation(project)} />
          <a href={`/projects/${project.manifest.slug}`} aria-label="View public project" title="View public project" className="text-muted-foreground hover:text-foreground">
            <ArrowUpRight aria-hidden className="size-5" />
          </a>
        </div>
      </header>
      <NavTabs label="Project administration">
        {sections.map(([id, label, Icon]) => (
          <NavTab key={id} href={adminHref(project.id, id)} onClick={openWithin(adminHref(project.id, id))} current={section === id}>
            <Icon aria-hidden /> {label}
          </NavTab>
        ))}
      </NavTabs>
      {section === "overview" ? (
        <>
          <ProjectFacts project={project} />
          <EnforcementPanel runtime={runtime} project={project} actorId={actorId} onAccessLost={onAccessLost} onDone={onSaved} />
          <DelistButton runtime={runtime} project={project} actorId={actorId} onAccessLost={onAccessLost} onDone={onSaved} />
        </>
      ) : section === "security" ? (
        <VettingSection runtime={runtime} actorId={actorId} projectId={project.id} onAccessLost={onAccessLost} />
      ) : section === "settings" ? (
        <ProjectEditor
          key={`${project.id}:${project.revision}`}
          runtime={runtime}
          project={project}
          actorId={actorId}
          onAccessLost={onAccessLost}
          onCancel={backToOverview}
          onSaved={(note) => {
            onSaved(note);
            backToOverview();
          }}
        />
      ) : (
        <SkillPreview manifest={project.raw} provenance={{ status: "ready", registry: { revision: project.revision, manifestSha256: project.manifestSha256 } }} collapsible={false} />
      )}
    </article>
  );
}

export type ProjectsSectionProps = {
  runtime: PageRuntime;
  actorId: string;
  selectedProject: string | null;
  section: ProjectSection;
  onAccessLost: () => void;
};

/** Every project for an administrator, or the selected one with its overview, security, settings and skills; a transient failure keeps the loaded list on screen, an authorization failure replaces it. */
export function ProjectsSection({ runtime, actorId, selectedProject, section, onAccessLost }: ProjectsSectionProps) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<ReadonlyArray<AdminProject>>();
  const [note, setNote] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const read = useRun(runtime, `admin-projects:${actorId}:${attempt}`, () => adminProjectsRead(actorId), adminReadMessages.projects, {
    settle: (value) => {
      if (value.kind === "current") setLoaded(value.projects);
    },
    fail: () => setLoaded(undefined),
  });
  const reload = () => setAttempt((count) => count + 1);
  const saved = (message: string) => {
    setNote(message);
    reload();
  };
  const failed = read?.status === "failed" ? read.message : undefined;
  const unrefreshed = read?.status === "done" && read.value.kind === "unrefreshed" ? read.value.message : undefined;
  const projects = failed === undefined ? loaded : undefined;
  const body = () => {
    if (failed !== undefined) return <LoadFailure message={failed} onRetry={reload} />;
    if (projects === undefined) return unrefreshed === undefined ? <Waiting>Loading projects…</Waiting> : <LoadFailure message={unrefreshed} onRetry={reload} />;
    if (projects.length === 0) return <p className="text-sm text-muted-foreground">No projects.</p>;
    const matching = shownProjects(projects, selectedProject, query);
    if (matching.length === 0) return <p className="text-sm text-muted-foreground">{selectedProject ? "Project not found." : "No matching projects."}</p>;
    if (!selectedProject) return <ProjectList projects={matching} />;
    return matching.map((project) => <SelectedProject key={project.id} runtime={runtime} project={project} actorId={actorId} section={section} onAccessLost={onAccessLost} onSaved={saved} />);
  };
  return (
    <section aria-labelledby="admin-projects" className="flex flex-col gap-4">
      <h2 id="admin-projects" className="sr-only">
        {selectedProject ? "Selected project" : "Projects"}
      </h2>
      {!selectedProject && projects !== undefined ? (
        <div className="flex flex-col gap-4">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" aria-label="Find a project" className="pl-11" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <ProjectCounts projects={projects} />
        </div>
      ) : null}
      {selectedProject ? (
        <a href="/admin" onClick={openWithin("/admin")} className="inline-flex items-center gap-2 self-start text-sm text-primary underline underline-offset-4 [&_svg]:size-4">
          <ArrowLeft aria-hidden /> All projects
        </a>
      ) : null}
      {note ? <Notice>{note}</Notice> : null}
      {projects !== undefined && unrefreshed !== undefined ? <LoadFailure message={unrefreshed} onRetry={reload} /> : null}
      {body()}
    </section>
  );
}
