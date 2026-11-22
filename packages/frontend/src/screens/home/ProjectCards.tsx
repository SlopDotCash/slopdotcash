// spec/frontend/views.md, "A project card shows one reward variant per registry policy, and a paid bounty-only program replaces ordinary work on cards"; spec/frontend/poolListing.md, "Home shows the listed Featured and Community projects once the funding read settles, Featured as cards and Community ten to a page"; spec/frontend/projections.md, "Listings tag a positive current amount as Vaulted, Promised or Configured, and say when it is not vaulted"; spec/frontend/views.md, "A published maintainer share shows this month's share, and next month's while a change waits"
import { ProjectCard, Status, type StatusProps } from "@repo/ui";
import { type CardReward, cardLines, cardReward, homeDescription, imageOf, type ListedProject, projectHref, type ShownTag } from "./listing.ts";

/** The look of Home's section heading row, its title, a tier's title and a tier's note. */
export const sectionHeading = "mb-12 flex flex-wrap items-center justify-between gap-6";
export const sectionTitle = "m-0 max-w-200 text-5xl leading-display font-extrabold tracking-tighter text-foreground uppercase md:text-7xl lg:text-8xl";
export const tierTitle = "mb-5 text-copy font-bold tracking-normal text-muted-foreground normal-case";
export const tierNote = "-mt-3 mb-5 text-sm text-muted-foreground";

/** Development's project grid: as many 340px columns as fit, one on a narrow screen. */
export const projectGrid = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,21.25rem),1fr))] gap-5";

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
