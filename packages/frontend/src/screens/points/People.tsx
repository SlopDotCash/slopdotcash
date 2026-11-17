// spec/backend/accounts.md, "Public reads show only public open members and never publish anything"; spec/backend/xConnection.md, "The verified X ID is reserved forever to the first GitHub identity that links it"; spec/ui/pagination.md, "The page stays within the pages that exist"
import type { Person, XProfile } from "@repo/backend/client";
import type { ProfileIndex } from "@repo/points/client";
import { DataState, ExternalLink, Pagination } from "@repo/ui";
import type { Shown } from "../home/listing.ts";
import { pageRows, usePages } from "./pages.ts";
import { type ListedPerson, listedPeople, mergedText, peoplePageSize } from "./peopleRows.ts";
import { lifetimeTotals, matching, type StandingHistory } from "./standings.ts";

export type PeopleMembers = { readonly kind: "preview"; readonly site: string } | { readonly kind: "read"; readonly people: Shown<ReadonlyArray<Person>> };

export type PeopleProps = {
  /** Everyone with a recorded pull request, from the profile census. */
  census: Shown<ProfileIndex>;
  /** Public members, read only on Slop's own origins. */
  members: PeopleMembers;
  /** Points earned, from the journal. */
  history: Shown<StandingHistory>;
  /** Project names by the GitHub node id of their verified steward. */
  stewards: ReadonlyMap<string, ReadonlyArray<string>>;
  /** Part of a login; only matching people are listed. */
  query: string;
};

const linkClass = "text-primary underline underline-offset-4 hover:decoration-2";

/** The public X profile a member connected, opened by its numeric id. */
export function XAccountLink({ account }: { account: XProfile }) {
  return (
    <ExternalLink href={`https://x.com/intent/user?user_id=${encodeURIComponent(account.id)}`} className={linkClass} title={`Account connected ${account.verifiedAt.slice(0, 10)}`}>
      X · @{account.username}
    </ExternalLink>
  );
}

type Earned = ReadonlyMap<string, number> | undefined;

function PersonRow({ person, totals, stewards }: { person: ListedPerson; totals: Earned } & Pick<PeopleProps, "stewards">) {
  const earned = totals === undefined ? null : (totals.get(person.id) ?? 0);
  const participation = person.member ? person.member.welcome + person.member.socialPoints : 0;
  const maintains = stewards.get(person.id) ?? [];
  return (
    <li className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
      <a href={`/contributors/${encodeURIComponent(person.login)}`} className={linkClass}>
        {person.login}
      </a>
      <span className="text-sm text-muted-foreground">{mergedText(person.merged)}</span>
      <span className="font-mono text-sm tabular-nums">{earned === null ? "Points unavailable" : `${(earned + participation).toLocaleString("en-US")} pts`}</span>
      {person.member ? <small className="text-xs text-muted-foreground">Public member</small> : null}
      {maintains.length > 0 ? <small className="text-xs text-muted-foreground">Project maintainer · {maintains.join(", ")}</small> : null}
      {person.member?.x ? <XAccountLink account={person.member.x} /> : null}
    </li>
  );
}

function List({ people, ...rest }: { people: ReadonlyArray<ListedPerson>; totals: Earned } & Pick<PeopleProps, "stewards">) {
  const [pages, send] = usePages(1, people.length, peoplePageSize);
  return (
    <>
      <p>{people.length.toLocaleString("en-US")} people</p>
      <ul className="flex flex-col divide-y divide-border">
        {pageRows(people, pages, peoplePageSize).map((person) => (
          <PersonRow key={person.id} person={person} {...rest} />
        ))}
      </ul>
      {people.length === 0 ? <p className="text-muted-foreground">No matches.</p> : null}
      <Pagination state={pages} onSend={send} label="People pages" pageLabel={(page, count) => `People page ${page} of ${count}`} />
    </>
  );
}

/** One people view: public members and everyone with a recorded pull request; people without Points are listed without a rank. */
export function People({ census, members, history, stewards, query }: PeopleProps) {
  const read = members.kind === "read" ? members.people : undefined;
  const people = listedPeople(census.value, read?.value);
  const shown = census.value !== undefined || read?.value !== undefined;
  const totals = history.value === undefined ? undefined : lifetimeTotals(history.value);
  return (
    <section id="people" aria-labelledby="people-heading" className="flex flex-col gap-4">
      <h2 id="people-heading" className="text-xl font-semibold text-foreground">
        People
      </h2>
      <DataState status={census.status} onRetry={census.onRetry} retryLabel="Retry contributors" />
      {members.kind === "preview" ? (
        <p>
          Public members load only on {new URL(members.site).hostname}.{" "}
          <a href={`${members.site}/points#people`} className={linkClass}>
            View public members
          </a>
        </p>
      ) : (
        <DataState status={members.people.status} onRetry={members.people.onRetry} retryLabel="Retry members" />
      )}
      {shown ? <List key={query} people={matching(people, query.trim(), (person) => person.login)} totals={totals} stewards={stewards} /> : null}
    </section>
  );
}
