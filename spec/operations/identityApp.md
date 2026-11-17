# Slop Identity App check after publication

After the static site is verified ([release run](./release.md), "Served
bytes are verified against the deployment's own source"), development at
df21e37b7 checks that the Slop Identity GitHub App is still public and
unchanged, from the release workflow's "Require public identity OAuth app"
step (`.github/workflows/deploy.yml`, commit 8207aaa63), which a superseded
run and a run that rotates an RPC endpoint skip. It runs after the site check, so an identity configuration failure cannot hide an already
verified site fix. The lookups carry no GitHub credentials, because a private
App is visible to the organization's token but answers 404 to contributors.
This library is the verdict of that step.

## Story: Contributors can still find the unchanged Slop Identity App

### The public App lookup is retried on refusal and its contract fields must match exactly

The unauthenticated `GET https://api.github.com/apps/slop-identity` is made
at most four times; an HTTP 403, 429 or transport failure (`000`) before the
fourth attempt waits 15 seconds times the attempt number and tries again,
and any other status ends the lookups. A 200 passes only when the slug is
`slop-identity`, the name `Slop Identity`, the client ID the configured
`GITHUB_CLIENT_ID`, the owner `elizaOS`, the permissions `{}` and the events
`[]`. When the last answer is not 200 and is rate limited (HTTP 429, or any
answer with `x-ratelimit-remaining: 0`), a 200 from the public page
`https://github.com/apps/slop-identity` passes with a warning that the
contract fields were not re-read this release; they are read again on the
next release whose lookup is not refused. Any other answer fails the step.

```quint
type IdentityVerdict = IdentityVerified | IdentityPublicOnly | IdentityFailed
type AppContract = { slug: str, name: str, clientMatches: bool, owner: str, noPermissions: bool, noEvents: bool }
type AppLookup = { status: int, rateLimited: bool, contract: AppContract, pageStatus: int }
pure val maxLookups = 4
pure def retriedStatus(status: int): bool = status == 403 or status == 429 or status == 0
pure def retryAfter(status: int, attempt: int): bool = retriedStatus(status) and attempt < maxLookups
pure def retryWaitSeconds(attempt: int): int = attempt * 15
pure def contractHolds(contract: AppContract): bool =
  contract.slug == "slop-identity" and contract.name == "Slop Identity" and contract.clientMatches
    and contract.owner == "elizaOS" and contract.noPermissions and contract.noEvents
pure def identityVerdict(lookup: AppLookup): IdentityVerdict =
  if (lookup.status == 200 and contractHolds(lookup.contract)) IdentityVerified
  else if (lookup.status != 200 and (lookup.status == 429 or lookup.rateLimited) and lookup.pageStatus == 200)
    IdentityPublicOnly
  else IdentityFailed
pure def lawDriftedContractFails(lookup: AppLookup): bool =
  (lookup.status == 200 and not(contractHolds(lookup.contract))) implies identityVerdict(lookup) == IdentityFailed
pure def lawPublicPageOnlyWhenRateLimited(lookup: AppLookup): bool =
  identityVerdict(lookup) == IdentityPublicOnly implies
    (lookup.status != 200 and (lookup.status == 429 or lookup.rateLimited) and lookup.pageStatus == 200)
pure def lawFourthRefusalNotRetried(status: int): bool = not(retryAfter(status, maxLookups))
pure val goodContract: AppContract = { slug: "slop-identity", name: "Slop Identity", clientMatches: true, owner: "elizaOS",
  noPermissions: true, noEvents: true }
pure val lookupValues = Set(
  { status: 200, rateLimited: false, contract: goodContract, pageStatus: 0 },
  { status: 200, rateLimited: false, contract: { ...goodContract, noPermissions: false }, pageStatus: 0 },
  { status: 403, rateLimited: true, contract: goodContract, pageStatus: 200 },
  { status: 403, rateLimited: false, contract: goodContract, pageStatus: 200 },
  { status: 429, rateLimited: false, contract: goodContract, pageStatus: 404 },
  { status: 404, rateLimited: false, contract: goodContract, pageStatus: 200 })
pure val statusValues = Set(0, 200, 403, 404, 429)
```
