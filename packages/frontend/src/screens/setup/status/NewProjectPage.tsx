// spec/frontend/presentation.md, "Setup readiness shows authority, Slopbot, security and funding separately"; spec/backend/projects.md, "An applicant cancels a pending application or update without GitHub access"
import type { PageProps } from "../../../app/pages.ts";
import { ProposalPage } from "../proposal/ProposalPage.tsx";
import { PendingApplications } from "./PendingApplications.tsx";
import { SetupStatusPanel } from "./SetupStatusPanel.tsx";

/** Add a project, with the account's saved applications above the steps and the new project's setup status once created. */
export function NewProjectPage(props: PageProps) {
  return (
    <ProposalPage
      {...props}
      pendingApplications={<PendingApplications runtime={props.runtime} />}
      setupStatus={(created) => <SetupStatusPanel runtime={props.runtime} projectId={created.projectId} actorId={created.actorId} initial={created.setup} showProjectLink={false} />}
    />
  );
}
