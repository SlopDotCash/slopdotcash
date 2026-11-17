// spec/frontend/views.md, "Who-builds counts come only from the committed 2026-09-17 snapshot pinned by its digest"; spec/frontend/views.md, "Model outcome statistics aggregate self-reported identities against accepted outcomes and never change a score"
import { DataState, Disclosure, ExternalLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@repo/ui";
import { SOURCE_REPOSITORY } from "../../platform/site.ts";
import type { Shown } from "../home/listing.ts";

export interface WhoBuildsSnapshot {
  readonly generatedAt: string;
  readonly externalReposExMass: number;
  readonly externalPrsExMass: number;
  readonly aiRepoMedianStars: number;
  readonly aiRepoShareUnder10: number;
  readonly cohorts: readonly [{ readonly size: number; readonly classifiable: number; readonly aiPrimary: number; readonly aiExternalPr: number }, ...unknown[]];
  readonly focus: ReadonlyArray<{ readonly area: string; readonly repos: number; readonly prs: number; readonly primaryContributors: number }>;
  readonly recognizable: ReadonlyArray<{ readonly repo: string; readonly prs: number; readonly stars: number }>;
  readonly massAccounts: ReadonlyArray<unknown>;
}

export interface LiveFootprint {
  readonly contributors: number;
  readonly windowDays: number;
  readonly scoredEvents: number;
  readonly mergedPullRequests: number;
  readonly mergedPullRequestsWithModel: number;
}

const count = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 0 });
const link = "text-primary underline underline-offset-4 hover:decoration-2";

/** @throws {RangeError} */
export function whoBuildsDateLabel(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

/** @throws {never} */
function percentOfRatio(ratio: number): string {
  if (ratio <= 0) return "0%";
  const rounded = Math.round(100 * ratio);
  return rounded === 0 ? "under 1%" : `${rounded}%`;
}

/** @throws {never} */
function percent(part: number, whole: number): string {
  return whole <= 0 ? "0%" : percentOfRatio(part / whole);
}

/** @throws {never} */
function massNote(excluded: number): string {
  if (excluded === 0) return "";
  if (excluded === 1) return ", one mass pull-request account excluded";
  return `, ${excluded === 2 ? "two" : count.format(excluded)} mass pull-request accounts excluded`;
}

function Figure({ value, children }: { value: string; children: string }) {
  return (
    <p className="flex flex-col gap-1">
      <strong className="font-mono text-3xl font-semibold tabular-nums text-foreground">{value}</strong>
      <span className="text-sm text-muted-foreground">{children}</span>
    </p>
  );
}

export type WhoBuildsProps = {
  /** The committed snapshot, quoted only when its digest is the pinned one. */
  snapshot: WhoBuildsSnapshot;
  /** The live leaderboard's footprint and model declarations. */
  live: Shown<LiveFootprint>;
  /** The source branch the pinned files are linked on. */
  branch: string;
};

/** Where the leaderboard's contributors work outside Slop, from the pinned snapshot. */
export function WhoBuilds({ snapshot, live, branch }: WhoBuildsProps) {
  const [all] = snapshot.cohorts;
  const pinned = (file: string) => `${SOURCE_REPOSITORY}/blob/${branch}/data/who-builds/${snapshot.generatedAt}/${file}`;
  const footprint = live.value;
  return (
    <section aria-labelledby="who-builds-heading" className="flex flex-col gap-6">
      <h2 id="who-builds-heading" className="text-xl font-semibold text-foreground">
        Who builds on Slop.
      </h2>
      <p className="text-muted-foreground">
        What the {count.format(all.size)} contributors on the leaderboard as of {whoBuildsDateLabel(snapshot.generatedAt)} did elsewhere on GitHub in 2026.
      </p>
      <DataState status={live.status} onRetry={live.onRetry} skeleton={[]} />
      <div className="grid gap-6 sm:grid-cols-2">
        <Figure value={percent(all.aiPrimary, all.classifiable)}>{`build AI agents or LLM tooling as their primary focus (${count.format(all.aiPrimary)} of the ${count.format(all.classifiable)} with classifiable public work)`}</Figure>
        <Figure value={percent(all.aiExternalPr, all.size)}>{`merged into an outside AI repository this year (${count.format(all.aiExternalPr)} of ${count.format(all.size)})`}</Figure>
      </div>
      <Disclosure summary="Research details">
        <div className="flex flex-col gap-6 pt-2">
          <div className="grid gap-6 sm:grid-cols-2">
            <Figure value={count.format(snapshot.externalPrsExMass)}>{`merged pull requests across ${count.format(snapshot.externalReposExMass)} outside repositories since 1 January 2026`}</Figure>
            <Figure value={count.format(snapshot.aiRepoMedianStars)}>{`stars is the median outside AI repository they work in; ${percentOfRatio(snapshot.aiRepoShareUnder10)} have fewer than ten`}</Figure>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <section aria-labelledby="who-builds-focus-heading" className="flex flex-col gap-3">
              <h3 id="who-builds-focus-heading" className="font-semibold text-foreground">
                What they build elsewhere
              </h3>
              <Table label="Focus areas outside Slop">
                <TableHeader>
                  <TableRow>
                    <TableHead>Primary focus</TableHead>
                    <TableHead className="text-right">People</TableHead>
                    <TableHead className="text-right">Repos</TableHead>
                    <TableHead className="text-right">Merged PRs</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshot.focus
                    .filter((area) => area.primaryContributors > 0)
                    .map((area) => (
                      <TableRow key={area.area}>
                        <TableHead scope="row" className="text-foreground">
                          {area.area}
                        </TableHead>
                        <TableCell className="text-right font-mono tabular-nums">{count.format(area.primaryContributors)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{count.format(area.repos)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{count.format(area.prs)}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </section>
            <section aria-labelledby="who-builds-known-heading" className="flex flex-col gap-3">
              <h3 id="who-builds-known-heading" className="font-semibold text-foreground">
                Well-known repositories they merged into this year
              </h3>
              <Table label="Well-known repositories outside Slop">
                <TableHeader>
                  <TableRow>
                    <TableHead>Repository</TableHead>
                    <TableHead className="text-right">Stars</TableHead>
                    <TableHead className="text-right">Merged PRs</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshot.recognizable.slice(0, 10).map((row) => (
                    <TableRow key={row.repo}>
                      <TableHead scope="row" className="text-foreground">
                        <ExternalLink className={link} href={`https://github.com/${row.repo}`}>
                          {row.repo}
                        </ExternalLink>
                      </TableHead>
                      <TableCell className="text-right font-mono tabular-nums">{compact.format(row.stars)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{count.format(row.prs)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          </div>
          {footprint && footprint.scoredEvents > 0 ? (
            <p>
              Inside Slop, live: {count.format(footprint.contributors)} contributors scored in the last {footprint.windowDays} days, and {percent(footprint.mergedPullRequestsWithModel, footprint.mergedPullRequests)} of merged pull requests name the model that did
              the work ({count.format(footprint.mergedPullRequestsWithModel)} of {count.format(footprint.mergedPullRequests)}).
            </p>
          ) : null}
        </div>
      </Disclosure>
      <p className="text-sm text-muted-foreground">
        Public GitHub data since 1 January 2026{massNote(snapshot.massAccounts.length)}.{" "}
        <ExternalLink className={link} href={pinned("snapshot.json")}>
          Snapshot JSON, {snapshot.generatedAt}
        </ExternalLink>
        {" · "}
        <ExternalLink className={link} href={pinned("METHOD.md")}>
          Method and caveats
        </ExternalLink>
      </p>
    </section>
  );
}
