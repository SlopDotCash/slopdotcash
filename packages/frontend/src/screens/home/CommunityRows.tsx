// spec/frontend/poolListing.md, "Home shows the listed Featured and Community projects once the funding read settles, Featured as cards and Community ten to a page"; spec/ui/pagination.md, "The page stays within the pages that exist"; spec/frontend/projections.md, "Listings tag a positive current amount as Vaulted, Promised or Configured, and say when it is not vaulted"
import { cn, focusRing, Pagination } from "@repo/ui";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { communityPageSize } from "../../../gen/frontend__poolListing.ts";
import { pageRows, usePages } from "../points/pages.ts";
import { cardLines, cardReward, homeDescription, imageOf, type ListedProject, projectHref } from "./listing.ts";
import { FundingTags } from "./ProjectCards.tsx";

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
    <li className="border-b border-border last:border-b-0">
      <a href={projectHref(project)} className={cn(focusRing, "group grid grid-cols-[auto_1fr_auto_auto] items-center gap-4 px-2 py-4.5 hover:bg-muted max-sm:grid-cols-[auto_1fr_auto]")}>
        <RowImage project={project} />
        <span className="flex min-w-0 flex-col gap-1">
          <strong className="text-lg font-semibold text-foreground">{project.name}</strong>
          <small className="text-sm text-muted-foreground">{homeDescription(project.description)}</small>
        </span>
        <span className="flex flex-col items-end gap-1 text-right max-sm:col-span-full max-sm:col-start-2 max-sm:items-start max-sm:text-left">
          <span className="flex flex-wrap items-baseline justify-end gap-2 font-mono tabular-nums">
            <strong className="font-semibold text-foreground">{reward.amount}</strong>
            {reward.unit ? <span className="text-sm text-muted-foreground">{reward.unit}</span> : null}
            <FundingTags reward={reward} />
          </span>
          {cardLines(project).map((line) => (
            <small key={line} className="text-sm text-muted-foreground">
              {line}
            </small>
          ))}
        </span>
        <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground group-hover:text-primary max-sm:row-start-1 max-sm:col-start-3" />
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
    <section aria-labelledby="community-projects" className="flex flex-col gap-4">
      <h3 id="community-projects" className="text-lg font-semibold text-foreground">
        Community
      </h3>
      <ul className="flex flex-col">
        {pageRows(projects, pages, communityPageSize).map((project) => (
          <CommunityRow key={project.id} project={project} />
        ))}
      </ul>
      <Pagination state={pages} onSend={send} label="Community project pages" pageLabel={(page, count) => `${page} / ${count}`} />
    </section>
  );
}
