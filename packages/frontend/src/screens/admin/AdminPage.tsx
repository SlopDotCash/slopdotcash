// spec/frontend/navigation.md, "Administration sections and project selection are parameters of the one Administration page"; spec/frontend/navigation.md, "Every existing product route is one Page and only private destinations need an account"; spec/frontend/navigation.md, "A signed-out private destination keeps its URL and shows sign-in in place with private reads disabled"; spec/backend/projects.md, "Administrators hold, delist, change the steward or place a project"
import { NavTab, NavTabs, PageHeader } from "@repo/ui";
import { Coins, FolderGit2, Lock, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { PageProps } from "../../app/pages.ts";
import { SignInPanel } from "../../app/SignInPanel.tsx";
import { useAddress } from "../../app/useAddress.ts";
import { loginHrefFor, useSession } from "../../app/useSession.ts";
import { refreshSession } from "../setup/proposal/create.vibe";
import { FeeConversions } from "./FeeConversions.tsx";
import { openWithin, page } from "./parts.tsx";
import { adminAddressOf, adminHref, projectSectionOf } from "./projects.ts";
import { ProjectsSection } from "./ProjectsSection.tsx";

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className={page}>
      <PageHeader icon={<ShieldCheck aria-hidden />} title="Admin" />
      {children}
    </main>
  );
}

/** Administration: projects and their enforcement, vetting, settings and skills, and the fee conversions; the server decides every read and action, this page only hides what the account cannot use. */
export function AdminPage({ runtime }: PageProps) {
  const address = useAddress();
  const shown = useSession(runtime);
  const { project, view } = adminAddressOf(address);
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
  const { session } = shown.view;
  if (!session.admin)
    return (
      <Frame>
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <Lock aria-hidden className="size-4" /> Admins only
        </p>
      </Frame>
    );
  const fees = view === "AdminFees";
  const onAccessLost = () => {
    runtime.runFork(refreshSession());
  };
  return (
    <Frame>
      <NavTabs label="Administration">
        <NavTab href="/admin" onClick={openWithin("/admin")} current={!fees}>
          <FolderGit2 aria-hidden /> Projects
        </NavTab>
        <NavTab href={adminHref(null, "fees")} onClick={openWithin(adminHref(null, "fees"))} current={fees}>
          <Coins aria-hidden /> Fee conversions
        </NavTab>
      </NavTabs>
      {fees ? (
        <FeeConversions key={session.githubId} runtime={runtime} actorId={session.githubId} />
      ) : (
        <ProjectsSection key={session.githubId} runtime={runtime} actorId={session.githubId} selectedProject={project} section={projectSectionOf(view)} onAccessLost={onAccessLost} />
      )}
    </Frame>
  );
}
