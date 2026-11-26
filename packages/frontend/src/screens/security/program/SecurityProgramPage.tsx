// spec/security/program.md, "Receipt terms come only from the open published revision"; spec/security/terms.md, "Paid terms carry their split, funding policy, eligibility class and asset"; spec/security/terms.md, "Exclusions are frozen with the terms and stay advice"; spec/security/reportingReadiness.md, "Only a fresh, enabled, verified observation is ready"; spec/frontend/presentation.md, "Home keeps distinct contribution and report entry points and generic agent setup"
import { Alert, Button, DataState, ExternalLink, Metric, MetricGrid, PageHeader, Status, type StatusProps } from "@repo/ui";
import { ExternalLink as ExternalLinkIcon, ShieldCheck } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { PageProps } from "../../../app/pages.ts";
import { pageOrigin } from "../../../platform/environment.ts";
import { writeClipboard } from "../../../platform/navigatorClipboard.ts";
import { useView } from "../../account/useView.ts";
import { bountyPrompt } from "../../funding/awards/BountyIntroduction.tsx";
import { AgentPrompt } from "../../home/AgentPrompt.tsx";
import { ProjectNav } from "../../projects/ProjectNav.tsx";
import { run, useOnce } from "./hooks.ts";
import { programShares } from "./amounts.ts";
import { IntakePanel } from "./IntakePanel.tsx";
import { AwardTerms, ScopeTerms, TrustTerms } from "./ProgramTerms.tsx";
import { ReportForm } from "./ReportForm.tsx";
import { checkReadiness, loadProgram, type ProgramRead, type ProgramRuntime, programMessages, programRuntime, watchReadiness } from "./runtime.vibe";
import { type ProgramProject, type ProgramTerms, programProjectOf } from "./terms.schema.ts";

const programStatus: Readonly<Record<ProgramTerms["status"], StatusProps["presentation"]>> = {
  draft: { tone: "Neutral", icon: "Dot", label: "Draft" },
  "pending-approval": { tone: "Neutral", icon: "Dot", label: "Draft" },
  open: { tone: "Positive", icon: "Check", label: "Open" },
  paused: { tone: "Caution", icon: "Pause", label: "Paused" },
  closed: { tone: "Neutral", icon: "Ban", label: "Closed" },
};

export type SecurityProgramViewProps = {
  project: ProgramProject;
  /** The origin the page was reached at, which the agent prompt names the skill by. */
  origin: string;
  /** The revision the owner just published from this page. */
  revision?: number;
  /** The private report section: Slop's intake and GitHub's private route. */
  intake: ReactNode;
  /** The owner's program settings, shown below the report for a maintainer. */
  settings?: ReactNode;
  /** The project's section tabs, shown unless the project is a bounty-only listing. */
  nav?: ReactNode;
  onCopy: (text: string) => Promise<void>;
};

/** A revision published from this page, applied in place to the terms above it. */
export type PublishedProgram = { readonly revision: number; readonly manifest: unknown };

const pageClass = "mx-auto flex w-full max-w-(--breakpoint-md) flex-1 flex-col gap-8 px-4 py-12";

function Published({ revision }: { revision: number | undefined }) {
  return revision === undefined ? null : (
    <p role="status">
      <Status presentation={{ tone: "Positive", icon: "Check", label: `Rev ${revision}` }} />
    </p>
  );
}

function Unpublished({ project, revision, intake, settings, nav }: Omit<SecurityProgramViewProps, "origin" | "onCopy">) {
  return (
    <main className={pageClass}>
      <PageHeader
        icon={<ShieldCheck className="size-6" />}
        title={
          <>
            <a href={`/projects/${project.slug}`} className="text-primary underline underline-offset-4 hover:decoration-2">
              {project.name}
            </a>{" "}
            security
          </>
        }
        actions={<Status presentation={{ tone: "Neutral", icon: "Slash", label: "No bounty" }} />}
      />
      {nav}
      <Published revision={revision} />
      {intake}
      {settings}
    </main>
  );
}

/** A project's security page: its published bounty terms, the agent setup and the private report path. */
export function SecurityProgramView({ project, origin, revision, intake, settings, nav, onCopy }: SecurityProgramViewProps) {
  const terms = project.securityBounty;
  if (terms === undefined) return <Unpublished project={project} revision={revision} intake={intake} settings={settings} nav={nav} />;
  const repository = project.links?.repository;
  return (
    <main className={pageClass}>
      <div className="flex flex-col gap-4">
        <PageHeader
          icon={<ShieldCheck className="size-6" />}
          title={`${project.name} security`}
          actions={
            repository ? (
              <ExternalLink href={repository} label="View in GitHub" title="View in GitHub" className="text-muted-foreground hover:text-primary">
                <ExternalLinkIcon aria-hidden className="size-5" />
              </ExternalLink>
            ) : null
          }
        />
        <div className="flex flex-wrap items-end gap-6">
          <MetricGrid className="flex-1">
            <Metric label="Bounty" value={programShares(terms)?.gross ?? "—"} />
          </MetricGrid>
          <Status presentation={programStatus[terms.status]} />
        </div>
      </div>
      {terms.rewardMode === "bounty-only" ? null : nav}
      <Published revision={revision} />
      <section aria-labelledby="bounty-agent-setup" className="flex flex-col gap-3">
        <h2 id="bounty-agent-setup" className="text-xl font-semibold text-foreground">
          Agent setup
        </h2>
        <AgentPrompt prompt={bountyPrompt(origin, terms.intake.repository)} origin={origin} onCopy={onCopy} />
      </section>
      <AwardTerms terms={terms} />
      <ScopeTerms terms={terms} onCopy={onCopy} />
      {intake}
      {settings}
      <TrustTerms terms={terms} />
    </main>
  );
}

function ProgramFailed({ read, onRetry }: { read: Exclude<ProgramRead, { kind: "found" }>; onRetry: () => void }) {
  return (
    <main className={pageClass}>
      <PageHeader icon={<ShieldCheck className="size-6" />} title="Security" />
      {read.kind === "missing" ? (
        <Alert variant="warn">{programMessages.missing}</Alert>
      ) : (
        <Alert
          variant="destructive"
          action={
            <Button variant="link" onClick={onRetry}>
              Reload the page
            </Button>
          }
        >
          {read.message}
        </Alert>
      )}
    </main>
  );
}

/** The owner's settings below the report path; `onPublished` applies a newly published revision to this page in place. */
export type SettingsSlot = (project: ProgramProject, onPublished: (published: PublishedProgram) => void) => ReactNode;

type Shown = { readonly projectId: string; readonly revision: number; readonly project: ProgramProject | undefined };

/** `/projects/:slug/security` in the page runtime: the project from the registry, its intake readiness and the reporter's draft. */
export function SecurityProgramPage({ runtime, route, settings }: PageProps & { settings?: SettingsSlot }) {
  const section = programRuntime(runtime);
  const [published, setPublished] = useState<Shown | null>(null);
  const read = useOnce(section, `program:${route.projectId}`, () => loadProgram(route.projectId));
  if (read.status === "running")
    return (
      <main className={pageClass}>
        <DataState status="Loading" />
      </main>
    );
  if (read.status === "failed") return <ProgramFailed read={{ kind: "failed", message: read.message }} onRetry={() => location.reload()} />;
  if (read.value.kind !== "found") return <ProgramFailed read={read.value} onRetry={() => location.reload()} />;
  const loaded = read.value.project;
  const current = published?.projectId === loaded.id ? published : null;
  const project = current?.project ?? loaded;
  const onPublished = ({ revision, manifest }: PublishedProgram) => setPublished({ projectId: loaded.id, revision, project: programProjectOf(manifest) });
  return (
    <SecurityProgramView
      project={project}
      origin={pageOrigin()}
      revision={current?.revision}
      intake={<Intake section={section} project={project} form={<ReportForm runtime={runtime} section={section} project={project} />} />}
      settings={settings?.(project, onPublished)}
      nav={<ProjectNav runtime={runtime} project={{ id: project.id, slug: project.slug, bountyOnly: project.securityBounty?.rewardMode === "bounty-only" }} current="security" />}
      onCopy={writeClipboard}
    />
  );
}

function Intake({ section, project, form }: { section: ProgramRuntime; project: ProgramProject; form: ReactNode }) {
  useOnce(section, `readiness:${project.id}`, () => checkReadiness(project.id));
  const readiness = useView(section, watchReadiness) ?? { status: "checking" as const };
  const shown = readiness.status === "checking" || readiness.projectId === project.id ? readiness : { status: "checking" as const };
  return <IntakePanel readiness={shown} project={project} form={form} onCheck={() => void run(section, checkReadiness(project.id))} />;
}
