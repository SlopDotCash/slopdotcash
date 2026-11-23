// spec/frontend/views.md, "A project card shows one reward variant per registry policy, and a paid bounty-only program replaces ordinary work on cards"; spec/frontend/poolListing.md, "Home shows the listed Featured and Community projects once the funding read settles, Featured as cards and Community ten to a page"; spec/frontend/projections.md, "Listings tag a positive current amount as Vaulted, Promised or Configured, and say when it is not vaulted"; spec/frontend/views.md, "A published maintainer share shows this month's share, and next month's while a change waits"; spec/ui/status.md, "Read states show loading, emptiness, staleness and failure differently"; spec/frontend/registry.md, "A page that acts on a project manifest needs a current registry and other pages show the last good registry labelled stale"
import { DataState, ProjectCard, Status, type StatusProps } from "@repo/ui";
import type { ReactNode } from "react";
import { readShowsRows } from "../../../gen/ui__status.ts";
import { type CardReward, cardLines, cardReward, homeDescription, imageOf, type ListedProject, projectHref, type Shown, type ShownTag } from "./listing.ts";

/** The look of Home's section heading row, its title, a tier's title and a tier's note. */
export const sectionHeading = "mb-12 flex flex-wrap items-center justify-between gap-6";
export const sectionTitle = "m-0 max-w-200 text-title font-extrabold tracking-tighter text-foreground uppercase lg:text-title-lg xl:text-title-xl";
export const tierTitle = "mb-5 text-copy leading-page font-bold tracking-normal text-muted-foreground normal-case";
export const tierNote = "-mt-3 mb-5 text-sm text-muted-foreground";

/** Development's project grid: as many 340px columns as fit, one on a narrow screen. */
export const projectGrid = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,21.25rem),1fr))] gap-5";

export type MergeLine = (project: ListedProject) => string | null;

const tagPresentations = {
  Vaulted: { tone: "Positive", icon: "Check", label: "Vaulted" },
  Promised: { tone: "Caution", icon: "Alert", label: "Promised" },
  Configured: { tone: "Neutral", icon: "Dot", label: "Configured" },
} as const satisfies Record<ShownTag, StatusProps["presentation"]>;

export type ListedReadProps = {
  /** The registry read a Home section lists. */
  read: Shown<unknown>;
  /** The section's rows, shown while the read is current or stale; the registry gate labels a stale read. */
  children: ReactNode;
};

/** A Home section's rows once the registry is read, nothing while it loads, and why it failed with a retry. */
export function ListedRead({ read, children }: ListedReadProps) {
  if (readShowsRows(read.status)) return <>{children}</>;
  return read.status === "Loading" || read.status === "Idle" ? null : <DataState status={read.status} onRetry={read.onRetry} />;
}

/** The funding tag of a listed month and the warning beside it. */
export function FundingTags({ reward }: { reward: CardReward }) {
  return reward.tag ? (
    <>
      <Status badge presentation={tagPresentations[reward.tag]} />
      {reward.warning ? <span className="text-copy font-bold text-muted-foreground">{reward.warning}</span> : null}
    </>
  ) : null;
}

export type ProjectGridProps = {
  /** The projects as they are shown, each a link to its page. */
  projects: ReadonlyArray<ListedProject>;
};

/** The projects in the order given, as cards. */
export function ProjectGrid({ projects }: ProjectGridProps) {
  return (
    <ul className={projectGrid}>
      {projects.map((project) => {
        const reward = cardReward(project);
        const lines = cardLines(project);
        return (
          <li key={project.id} className="flex">
            <ProjectCard
              className="flex-1"
              name={project.name}
              image={imageOf(project)}
              description={homeDescription(project.description)}
              amount={reward.amount}
              unit={reward.unit}
              tags={<FundingTags reward={reward} />}
              lines={lines.length > 0 ? lines.map((line) => <small key={line}>{line}</small>) : undefined}
            >
              <a href={projectHref(project)} />
            </ProjectCard>
          </li>
        );
      })}
    </ul>
  );
}
