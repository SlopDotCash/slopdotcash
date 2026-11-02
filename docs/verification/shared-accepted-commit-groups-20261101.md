# Shared accepted-commit discovery

PRD sections 5 and 7 require source-bound value assessments and no duplicate
commit credit. This fixes the discovery portion of issue #1992. It does not
close that issue or prove that production publication is unblocked.

Base: `7dc06877162cc3f09ed74cf336c06b6f63ba9ede`.
Tested product and regression commit: `c61fc29d830445b36fd9e5d435647743550ad7a6`.
This document records that product commit; it changes no executable source.

## Failure and result

The producer followed PR text references, cross-reference events and retained
joint membership. Accepted PRs with shared commits but no links could reach
separate assessments. The publication overlap guard correctly rejected them.

The collector now reads accepted commit associations and a complete API-era
merged-PR commit census. Both discovery paths use the same accepted commit
selection as work-unit valuation. An imported merge without declared resolution
scope cannot expand the group. Declared resolution scope still needs the
existing full validation before a credit claim is admitted.

Every discovered member still passes current repository authority, complete
source, policy and occurrence-time checks. The 32-source bound remains. Missing,
moving or truncated census evidence stays pending. GitHub search's 1,000-result
boundary is not treated as complete coverage. No inference attempt cap is reset.

## Reproduced checks

Environment: Windows, Bun 1.3.14, Node 24.15.0.

| Check | Result |
| --- | --- |
| Same 12 new collector tests on the base | 2 pass, 10 fail |
| New collector tests on the product commit | 12 pass, 0 fail |
| `bun test --timeout 30000 ./workers/slopbot` | 310 pass, 0 fail, 19 files |
| `bun run typecheck` | Pass |
| `bun run lint:check` | Exit 0; existing warnings remain |
| `bun run projects:sync`, documented public-snapshot ledger preparation, `bun run build` | Pass; 139 public files in build manifest |
| Full `bun run verify` | Stopped after unchanged Windows downloader abort test hung; same unchanged test timed out after 20 seconds in the clean base |
| Full `bun run test:e2e` | Pinned Chromium headless and Firefox executables absent; browser launch failed |
| Documented Chromium executable override, preview homepage Points and contributor/cycle tests | 4/4 pass, desktop and mobile, Chromium 156.0.8078.4 |

To reproduce the source regressions, run:

```sh
bun install --frozen-lockfile
bun test workers/slopbot/value-shared-commit-group.test.ts
bun test --timeout 30000 ./workers/slopbot
bun run typecheck
```

For the before result, create a separate worktree at the base above, copy only
`workers/slopbot/value-shared-commit-group.test.ts` from the product commit,
install the same frozen lockfile and run that test. Do not replace the base
collector or work-unit implementation.

## Read-only public-source control

At `2026-11-01T12:57:39Z`, the actual census function collected 239 accepted Pump
PRs in three GraphQL queries. Two REST reads supplied repository identity and
#3914's 41-commit list: five public reads in this control. It found:

| Shared commit | Census carriers | Commit/pulls endpoint alone |
| --- | --- | --- |
| `1fe5f75c11b56c1151350cd525154b27cdcd5eda` | #3914 and #3842 | #3914 only |
| `da0febe5f56c14e8e3860ff95c2af1a5d4620b41` | #3914 and #3850 | #3914 only |

All 41 commits exposed 19 API-era candidate carriers, not just these three PRs.
This is discovery evidence, not a successful full 19-member assessment.

The following control uses the actual product function and the operator's
existing GitHub CLI sign-in. It reads public metadata only. It does not read or
print credentials, infer ratings, write a journal, alter a queue, release a site
or send a payment. Counts can grow after the observation above.

```sh
bun --eval '
import {execFileSync} from "node:child_process";
import {collectAcceptedCommitCensus} from "./workers/slopbot/value-accepted-commit-census.ts";
const read = (path) => JSON.parse(execFileSync("gh", ["api", path], {encoding:"utf8"}));
const repository = "lalalune/pumpfun-source";
const identity = read(`repos/${repository}`);
let queries = 0;
const github = {async graphql(query, variables) {
  queries++;
  const result = JSON.parse(execFileSync("gh", ["api", "graphql", "--input", "-"], {
    input:JSON.stringify({query,variables}), encoding:"utf8", maxBuffer:20000000
  }));
  if (result.errors) throw Error("GitHub query was incomplete");
  return result.data;
}};
const census = await collectAcceptedCommitCensus(github, {
  repository, repositoryNodeId:identity.node_id, repositoryDatabaseId:identity.id
}, Date.parse("2026-11-01T00:00:00Z"));
if (!census) throw Error("No complete census result is claimed");
const commits = read(`repos/${repository}/pulls/3914/commits?per_page=100`);
const carriers = new Map();
for (const commit of commits)
  for (const carrier of census.carriers.get(commit.sha) ?? [])
    carriers.set(carrier.nodeId, carrier);
console.log(JSON.stringify({graphqlQueries:queries,restQueries:2,
  acceptedPullRequests:census.ids.size,carriers:[...carriers.values()]},null,2));
'
```

Actual producer collection also performs a paginated association lookup per
distinct captured commit or accepted merge, plus existing full-source reads.
The census and associations are cached within one group only. This control is
not a production latency or quota qualification.

## Applicability and limits

- `llm_evidence`: not applicable to the data-only discovery result. The changed
  path runs before inference. No provider response stands in for model evidence.
  A new live joint assessment and the issue's production release were **not run**.
- `agent_clients`: Codex desktop drove the local commands. Other agent clients
  were not tested; no client protocol or provider integration changed.
- No production assessment, rating, protected history, journal, inference cap, queue state,
  Points, release or payment was changed by these checks.
- The overlap and profile-inventory publication guards remain intact. Other
  source, attribution or group-size limits can still hold the discovered group.
- Full verify and the full browser matrix did not pass locally; the narrower
  green checks above do not replace those missing results.
