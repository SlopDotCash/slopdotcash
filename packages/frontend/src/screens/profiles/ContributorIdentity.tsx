// spec/frontend/views.md, "A profile login resolves through membership, current actors, directory and journal in that order, and any current source vetoes a stale login"
import { Avatar, ExternalLink } from "@repo/ui";
import { FolderGit2 } from "lucide-react";
import type { ReactNode } from "react";

export type ContributorIdentityProps = {
  /** The contributor as a record confirms them; without `url` the login is only what the visitor typed. */
  actor: { readonly login: string; readonly avatarUrl?: string; readonly url?: string };
  /** Links shown beside the GitHub profile, such as the wallet. */
  children?: ReactNode;
};

const linkClass = "inline-flex min-h-6 items-center gap-1.5 rounded-sm hover:text-foreground";

/** One identity header for scored, historical and newly registered contributors; an unconfirmed login links to no GitHub profile. */
export function ContributorIdentity({ actor, children }: ContributorIdentityProps) {
  return (
    <section className="flex items-center gap-3.5 pt-1 pb-5 md:gap-5.5">
      {actor.url ? <Avatar size="lg" name={actor.login} src={actor.avatarUrl} className="size-14 border border-border bg-secondary md:size-20" /> : null}
      <div className="flex min-w-0 flex-col gap-2">
        <h1 className="truncate text-heading leading-heading font-extrabold tracking-tighter text-foreground uppercase lg:text-4xl xl:text-hero xl:leading-none">{actor.login}</h1>
        {actor.url ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ui font-semibold text-muted-foreground">
            <ExternalLink href={actor.url} label={`GitHub · @${actor.login}`} className={linkClass}>
              <FolderGit2 aria-hidden className="size-4" />@{actor.login}
            </ExternalLink>
            {children}
          </div>
        ) : null}
      </div>
    </section>
  );
}
