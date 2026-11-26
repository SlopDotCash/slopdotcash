// spec/backend/accounts.md, "Public reads show only public open members and never publish anything"; spec/backend/xConnection.md, "The verified X ID is reserved forever to the first GitHub identity that links it"; spec/ui/pagination.md, "The page stays within the pages that exist"
import type { Person, XProfile } from "@repo/backend/client";
import type { ProfileIndex } from "@repo/points/client";
import { DataState, ExternalLink, Pagination } from "@repo/ui";
import { GitMerge, Wrench } from "lucide-react";
import type { Shown } from "../home/listing.ts";
import { pageRows, usePages } from "./pages.ts";
import { type ListedPerson, listedPeople, peoplePageSize } from "./peopleRows.ts";
import { matching } from "./standings.ts";

export type PeopleMembers = { readonly kind: "preview"; readonly site: string } | { readonly kind: "read"; readonly people: Shown<ReadonlyArray<Person>> };

export type PeopleProps = {
  /** Everyone with a recorded pull request, from the profile census. */
  census: Shown<ProfileIndex>;
  /** Public members, read only on Slop's own origins. */
  members: PeopleMembers;
  /** Project names by the GitHub node id of their verified steward. */
  stewards: ReadonlyMap<string, ReadonlyArray<string>>;
  /** Part of a login; only matching people are listed. */
  query: string;
};

export const panelClass = "flex flex-col gap-4 rounded-xl border border-border p-4 md:p-6 lg:p-7.5 xl:p-8";

const linkClass = "text-primary underline underline-offset-4 hover:decoration-2";

/** The public X profile a member connected, opened by its numeric id. */
export function XAccountLink({ account }: { account: XProfile }) {
  return (
    <ExternalLink href={`https://x.com/intent/user?user_id=${encodeURIComponent(account.id)}`} className={linkClass} title={`Account connected ${account.verifiedAt.slice(0, 10)}`}>
      X · @{account.username}
    </ExternalLink>
  );
}

function PersonRow({ person, stewards }: { person: ListedPerson } & Pick<PeopleProps, "stewards">) {
  const maintains = stewards.get(person.id) ?? [];
  return (
    <li className="grid gap-2 rounded-md border border-border p-4 wrap-anywhere">
      <a href={`/contributors/${encodeURIComponent(person.login)}`} className="justify-self-start underline decoration-foreground/22 underline-offset-4 hover:decoration-foreground">
        {person.login}
      </a>
      <span className="inline-flex items-center gap-1.5" title={person.merged === null ? "PR count unavailable" : "Merged PRs"}>
        <GitMerge aria-hidden className="size-3.5" />
        {person.merged === null ? "—" : person.merged.toLocaleString("en-US")}
        <span className="sr-only">{person.merged === null ? " PR count unavailable" : " merged PRs"}</span>
      </span>
      {maintains.length > 0 ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 text-xs text-muted-foreground" title="Project maintainer">
          <Wrench aria-hidden className="size-3.5" />
          <span className="sr-only">Project maintainer · </span>
          {maintains.join(", ")}
        </span>
      ) : null}
      {person.member?.x ? <XAccountLink account={person.member.x} /> : null}
    </li>
  );
}

function List({ people, stewards }: { people: ReadonlyArray<ListedPerson> } & Pick<PeopleProps, "stewards">) {
  const [pages, send] = usePages(1, people.length, peoplePageSize);
  return (
    <>
      <p>{people.length.toLocaleString("en-US")} people</p>
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4">
        {pageRows(people, pages, peoplePageSize).map((person) => (
          <PersonRow key={person.id} person={person} stewards={stewards} />
        ))}
      </ul>
      {people.length === 0 ? <p className="text-muted-foreground">No matches.</p> : null}
      <Pagination state={pages} onSend={send} label="People pages" pageLabel={(page, count) => `People page ${page} of ${count}`} />
    </>
  );
}

/** The contributor directory: public members and everyone with a recorded pull request, in login order and without a rank. */
export function People({ census, members, stewards, query }: PeopleProps) {
  const read = members.kind === "read" ? members.people : undefined;
  const people = listedPeople(census.value, read?.value);
  const shown = census.value !== undefined || read?.value !== undefined;
  return (
    <section id="people" aria-labelledby="people-heading" className={panelClass}>
      <h2 id="people-heading" className="mb-1 text-2xl leading-page font-extrabold tracking-amount uppercase">
        People
      </h2>
      <DataState status={census.status} onRetry={census.onRetry} retryLabel="Retry contributors" />
      {members.kind === "preview" ? (
        <p>
          <a href={`${members.site}/points#people`} className={linkClass}>
            View on {new URL(members.site).hostname}
          </a>
        </p>
      ) : (
        <DataState status={members.people.status} onRetry={members.people.onRetry} retryLabel="Retry members" />
      )}
      {shown ? <List key={query} people={matching(people, query.trim(), (person) => person.login)} stewards={stewards} /> : null}
    </section>
  );
}
