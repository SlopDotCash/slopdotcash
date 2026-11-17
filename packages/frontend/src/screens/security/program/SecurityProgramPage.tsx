// spec/security/program.md, "Receipt terms come only from the open published revision"; spec/security/terms.md, "Paid terms carry their split, funding policy, eligibility class and asset"; spec/security/reportingReadiness.md, "Only a fresh, enabled, verified observation is ready"
import { Alert, Button, DataState, ExternalLink, PageHeader, Status } from "@repo/ui";
import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { PageProps } from "../../../app/pages.ts";
import { useSession } from "../../../app/useSession.ts";
import { pageOrigin } from "../../../platform/environment.ts";
import { writeClipboard } from "../../../platform/navigatorClipboard.ts";
import { useView } from "../../account/useView.ts";
import { bountyPrompt } from "../../funding/awards/BountyIntroduction.tsx";
import { run, useOnce } from "./hooks.ts";
import { AgentPrompt } from "../../home/AgentPrompt.tsx";
import { programShares } from "./amounts.ts";
import { IntakePanel } from "./IntakePanel.tsx";
import { AwardTerms, ScopeTerms, TrustTerms } from "./ProgramTerms.tsx";
import { ReportForm } from "./ReportForm.tsx";
import { checkReadiness, loadProgram, type ProgramRead, type ProgramRuntime, programMessages, programRuntime, watchReadiness } from "./runtime.vibe";
import type { ProgramProject, ProgramTerms } from "./terms.schema.ts";

const programStatus: Readonly<Record<ProgramTerms["status"], string>> = {
  draft: "Not open for paid reports",
  "pending-approval": "Not open for paid reports",
  open: "Open for paid reports",
  paused: "Paused — no new paid reports",
  closed: "Closed — no new paid reports",
};

export type SecurityProgramViewProps = {
  project: ProgramProject;
  /** The origin the page was reached at, which the agent prompt names the skill by. */
  origin: string;
  /** The private report section: Slop's intake and GitHub's private route. */
  intake: ReactNode;
  /** The owner's program settings, shown below the report for a maintainer. */
  settings?: ReactNode;
  onCopy: (text: string) => Promise<void>;
};

const pageClass = "mx-auto flex w-full max-w-(--breakpoint-md) flex-1 flex-col gap-8 px-4 py-12";

function Unpublished({ project, intake, settings }: Pick<SecurityProgramViewProps, "project" | "intake" | "settings">) {
  return (
    <main className={pageClass}>
      <PageHeader
        icon={<ShieldCheck className="size-6" />}
        title={
          <>
            Report a security issue in{" "}
            <a href={`/projects/${project.slug}`} className="text-primary underline underline-offset-4 hover:decoration-2">
              {project.name}
            </a>
          </>
        }
      />
      <p className="text-muted-foreground">No published bounty terms, so no award is promised.</p>
      {intake}
      {settings}
    </main>
  );
}

/** A project's security page: its published bounty terms, the agent setup and the private report path. */
export function SecurityProgramView({ project, origin, intake, settings, onCopy }: SecurityProgramViewProps) {
  const terms = project.securityBounty;
  if (terms === undefined) return <Unpublished project={project} intake={intake} settings={settings} />;
  const gross = programShares(terms)?.gross;
  const open = terms.status === "open";
  return (
    <main className={pageClass}>
      <div className="flex flex-col gap-2">
        <PageHeader
          icon={<ShieldCheck className="size-6" />}
          title={`${project.name} security bounty`}
          actions={<Status presentation={{ tone: open ? "Positive" : "Notice", icon: open ? "Check" : "Pause", label: programStatus[terms.status] }} />}
        />
        {gross ? <p className="text-lg text-muted-foreground">{gross} security bounty</p> : null}
      </div>
      <p>
        Find {terms.eligibility === "critical-loss-of-funds" ? "a critical" : "an in-scope"} security vulnerability in {project.name}
      </p>
      {project.links?.repository ? (
        <p>
          <ExternalLink href={project.links.repository}>View in GitHub</ExternalLink>
        </p>
      ) : null}
      <section aria-labelledby="bounty-agent-setup" className="flex flex-col gap-3">
        <h2 id="bounty-agent-setup" className="text-xl font-semibold text-foreground">
          Agent setup
        </h2>
        <p>Copy this into your agent.</p>
        <AgentPrompt prompt={bountyPrompt(origin, terms.intake.repository)} origin={origin} onCopy={onCopy} />
      </section>
      <p>
        <a href="#security-scope" className="text-primary underline underline-offset-4 hover:decoration-2">
          Check covered source and safe testing rules
        </a>
      </p>
      <AwardTerms terms={terms} />
      <ScopeTerms terms={terms} />
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

/** `/projects/:slug/security` in the page runtime: the project from the registry, its intake readiness and the reporter's draft. */
export function SecurityProgramPage({ runtime, route, settings }: PageProps & { settings?: (project: ProgramProject) => ReactNode }) {
  const section = programRuntime(runtime);
  const shown = useSession(runtime);
  const read = useOnce(section, `program:${route.projectId}`, () => loadProgram(route.projectId));
  if (read.status === "running")
    return (
      <main className={pageClass}>
        <DataState status="Loading" />
      </main>
    );
  if (read.status === "failed") return <ProgramFailed read={{ kind: "failed", message: read.message }} onRetry={() => location.reload()} />;
  if (read.value.kind !== "found") return <ProgramFailed read={read.value} onRetry={() => location.reload()} />;
  const project = read.value.project;
  return (
    <SecurityProgramView
      project={project}
      origin={pageOrigin()}
      intake={<Intake section={section} project={project} signedIn={shown?.view.status === "signedIn"} form={<ReportForm runtime={runtime} section={section} project={project} />} />}
      settings={settings?.(project)}
      onCopy={writeClipboard}
    />
  );
}

function Intake({ section, project, signedIn, form }: { section: ProgramRuntime; project: ProgramProject; signedIn: boolean; form: ReactNode }) {
  useOnce(section, `readiness:${project.id}`, () => checkReadiness(project.id));
  const readiness = useView(section, watchReadiness) ?? { status: "checking" as const };
  const shown = readiness.status === "checking" || readiness.projectId === project.id ? readiness : { status: "checking" as const };
  return <IntakePanel readiness={shown} signedIn={signedIn} form={form} onCheck={() => void run(section, checkReadiness(project.id))} />;
}
