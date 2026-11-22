// spec/frontend/views.md, "A project card shows one reward variant per registry policy, and a paid bounty-only program replaces ordinary work on cards"; spec/frontend/poolListing.md, "Home shows the listed Featured and Community projects once the funding read settles, Featured as cards and Community ten to a page"; spec/frontend/projections.md, "Listings tag a positive current amount as Vaulted, Promised or Configured, and say when it is not vaulted"; spec/frontend/views.md, "A published maintainer share shows this month's share, and next month's while a change waits"
import { ProjectCard, Status, type StatusProps } from "@repo/ui";
import { type CardReward, cardLines, cardReward, homeDescription, imageOf, type ListedProject, projectHref, type ShownTag } from "./listing.ts";

export type MergeLine = (project: ListedProject) => string | null;

const tagPresentations = {
  Vaulted: { tone: "Positive", icon: "Check", label: "Vaulted" },
  Promised: { tone: "Caution", icon: "Alert", label: "Promised" },
  Configured: { tone: "Neutral", icon: "Dot", label: "Configured" },
} as const satisfies Record<ShownTag, StatusProps["presentation"]>;

/** The funding tag of a listed month and the warning beside it. */
export function FundingTags({ reward }: { reward: CardReward }) {
  return reward.tag ? (
    <>
      <Status presentation={tagPresentations[reward.tag]} />
      {reward.warning ? <span className="text-sm text-muted-foreground">{reward.warning}</span> : null}
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
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
