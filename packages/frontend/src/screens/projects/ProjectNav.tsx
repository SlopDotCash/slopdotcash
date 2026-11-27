// spec/frontend/navigation.md, "Every existing product route is one Page and only private destinations need an account"; spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"
import { NavTab, NavTabs } from "@repo/ui";
import type { PageRuntime } from "../../app/runtime.vibe";
import { useSession } from "../../app/useSession.ts";
import { maintainerCheck } from "../../session/maintainer.vibe";
import { useRun } from "../setup/proposal/run.ts";

export type ProjectSection = "overview" | "funding" | "settings" | "security";

export type NavProject = { readonly id: string; readonly slug: string; readonly bountyOnly: boolean };

export function ProjectNav({ runtime, project, current }: { runtime: PageRuntime; project: NavProject; current: ProjectSection }) {
  const shown = useSession(runtime);
  const actorId = shown?.view.status === "signedIn" ? shown.view.session.githubId : undefined;
  const access = useRun(runtime, current === "settings" || actorId === undefined ? undefined : `navMaintainer:${project.id}:${actorId}`, () => maintainerCheck(project.id, actorId ?? ""), "Project access could not be checked. Retry.");
  const base = `/projects/${project.slug}`;
  const links: ReadonlyArray<{ readonly id: ProjectSection; readonly label: string; readonly href: string }> = [
    { id: "overview", label: "Overview", href: base },
    project.bountyOnly ? { id: "security", label: "Security bounty", href: `${base}/security` } : { id: "funding", label: "Funds & awards", href: `${base}/funding` },
    ...(current === "settings" || (access?.status === "done" && access.value.kind === "Allowed") ? [{ id: "settings" as const, label: "Settings", href: `${base}/manage` }] : []),
  ];
  return (
    <NavTabs label="Project navigation">
      {links.map((link) => (
        <NavTab key={link.id} href={link.href} current={link.id === current}>
          {link.label}
        </NavTab>
      ))}
    </NavTabs>
  );
}
