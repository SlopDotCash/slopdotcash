// spec/frontend/poolListing.md, "Home shows the listed Featured and Community projects once the funding read settles, Featured as cards and Community ten to a page"; spec/ui/pagination.md, "The page stays within the pages that exist"; spec/frontend/projections.md, "Listings tag a positive current amount as Vaulted, Promised or Configured, and say when it is not vaulted"
import { cn, focusRing, Pagination } from "@repo/ui";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { communityPageSize } from "../../../gen/frontend__poolListing.ts";
import { pageRows, usePages } from "../points/pages.ts";
import { cardLines, cardReward, homeDescription, imageOf, type ListedProject, projectHref } from "./listing.ts";
import { FundingTags, tierTitle } from "./ProjectCards.tsx";

const avatar = "size-11 shrink-0 rounded-avatar bg-popover";

function RowImage({ project }: { project: ListedProject }) {
  const image = imageOf(project);
  const [failed, setFailed] = useState<string | null>(null);
  return image && failed !== image ? (
    <img src={image} alt="" aria-hidden width={44} height={44} loading="lazy" decoding="async" onError={() => setFailed(image)} className={cn(avatar, "object-cover")} />
  ) : (
    <span aria-hidden className={cn(avatar, "grid place-items-center text-lg font-extrabold")}>
      {project.name.slice(0, 1)}
    </span>
  );
}

function CommunityRow({ project }: { project: ListedProject }) {
  const reward = cardReward(project);
  return (
    <li className="border-b border-border">
      <a
        href={projectHref(project)}
        className={cn(
          focusRing,
          "group flex items-center gap-5 px-2 py-4.5 hover:bg-foreground/3 max-md:grid max-md:grid-cols-[auto_minmax(0,1fr)_auto] max-md:items-start max-md:gap-x-3 max-md:gap-y-2",
        )}
      >
        <RowImage project={project} />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <strong className="text-lg leading-page font-bold text-foreground">{project.name}</strong>
          <small className="mt-1.25 text-sm leading-page wrap-anywhere text-muted-foreground">{homeDescription(project.description)}</small>
        </span>
        <span className="grid max-w-[36%] gap-1 font-mono text-copy leading-data font-bold wrap-anywhere text-foreground max-md:col-start-2 max-md:max-w-none">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1.5">
            <span className="min-w-0">
              <strong className="font-bold">{reward.amount}</strong>
              {reward.unit ? <> {reward.unit}</> : null}
            </span>
            <FundingTags reward={reward} />
          </span>
          {cardLines(project).map((line) => (
            <small key={line} className="mt-1.75 block text-sm text-primary-hover">
              {line}
            </small>
          ))}
        </span>
        <ChevronRight aria-hidden className="size-4.5 shrink-0 text-muted-foreground group-hover:text-primary max-md:col-start-3 max-md:row-start-1" />
      </a>
    </li>
  );
}

export type CommunityRowsProps = {
  /** The Community projects in the home order. */
  projects: ReadonlyArray<ListedProject>;
};

/** Home's Community section: the projects as rows, ten to a page; the page shown is this view's own state. */
export function CommunityRows({ projects }: CommunityRowsProps) {
  const [pages, send] = usePages(1, projects.length, communityPageSize);
  if (projects.length === 0) return null;
  return (
    <section aria-labelledby="community-projects">
      <h3 id="community-projects" className={tierTitle}>
        Community
      </h3>
      <ul className="border-t border-border">
        {pageRows(projects, pages, communityPageSize).map((project) => (
          <CommunityRow key={project.id} project={project} />
        ))}
      </ul>
      <Pagination className="mt-8" state={pages} onSend={send} label="Community project pages" pageLabel={(page, count) => `${page} / ${count}`} />
    </section>
  );
}
