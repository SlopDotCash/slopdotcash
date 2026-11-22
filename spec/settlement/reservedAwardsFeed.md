# Reserved awards feed

PRD section 9 (operator decision, 17 November 2026): when a month is paid
from a project vault, an award stays reserved while its contributor has no
confirmed payout wallet on the vault's network or has not authorized the
payout, and nothing else tells that contributor. One operator service reads
this private feed to remind them. The feed names accounts only and changes
no payment state. Sources at development `8660a6121`:
`backend/payments/reserved-awards-feed.ts` (`bearerTokenAuthorized`,
`readReservedAwards`, `handleReservedAwardsFeed`), its route in
`functions/api/v1/[[path]].ts`, `backend/payments/reserved-awards-feed.test.ts`
and the retained model `formal/models/api/api_reserved_awards_feed.qnt`. The
reserved obligations themselves are [payment dispatch](./paymentDispatch.md)
and [monthly allocations](./monthly.md); the operator secret check is shared
by every private operator route, among them the [protected-months
read](../points/protectedMonths.md), each with its own secret.

## Story: Remind contributors whose funded award is still reserved

> As an operator service, I want the accounts whose funded award waits on
> their own wallet or authorization, so that I can remind them without
> learning what they are owed or where it would be paid.

### The feed opens only for the exact configured bearer secret and is otherwise not found

`/api/v1/operator/reserved-awards`, with or without a trailing slash,
answers only a request whose `Authorization` header equals
`Bearer <OPERATOR_FEED_TOKEN>`. The header is compared in constant time
against the configured value, or against a stand-in of the minimum length
when the secret is unset, so the time taken does not show whether the
secret exists; a secret shorter than 32 characters counts as unset. Without
the secret, without a token or with any other token, the request falls
through to the API's ordinary not-found answer, so the route cannot be told
apart from a path that does not exist. With the right token a method other
than `GET` or `HEAD` answers 405 `method_not_allowed`; a read answers
`{ schema: "slop-reserved-awards-v1", generatedAt, awards }` with
`Cache-Control: no-store`, and a failed read answers the API's ordinary
error.

```quint
type FeedAnswer = FeedNotFound | FeedMethodNotAllowed | FeedListing | FeedUnavailable
pure val minimumTokenLength = 32
pure val reservedAwardsSchema = "slop-reserved-awards-v1"
pure def feedOpen(secretLength: int, presentedMatches: bool): bool = secretLength >= minimumTokenLength and presentedMatches
pure def feedAnswer(secretLength: int, presentedMatches: bool, readRequest: bool, listingRead: bool): FeedAnswer =
  if (not(feedOpen(secretLength, presentedMatches))) FeedNotFound
  else if (not(readRequest)) FeedMethodNotAllowed
  else if (listingRead) FeedListing
  else FeedUnavailable
pure def lawClosedFeedAnswersNothing(secretLength: int, presentedMatches: bool, readRequest: bool, listingRead: bool): bool =
  not(feedOpen(secretLength, presentedMatches)) implies feedAnswer(secretLength, presentedMatches, readRequest, listingRead) == FeedNotFound
pure def lawShortSecretNeverOpens(secretLength: int, presentedMatches: bool): bool =
  secretLength < minimumTokenLength implies not(feedOpen(secretLength, presentedMatches))
pure val secretLengthValues = Set(0, 31, 32, 64)
```

### Each row names one account, project and network and what it still needs, and never an amount, address, award or month

The feed reads every payment obligation in state reserved. Its award is
*confirmed* when the contributor's current effective wallet claim on the
award's chain has a wallet authorization, by the same join the dispatcher
uses, and *bound* when it is confirmed and a payout binding is on record for
that claim on the award's network and vault: a signed EVM binding
authorization (vault compared lower-case) or a Solana binding attempt that
did not fail, for an obligation of the same account, network and vault. A
binding in progress needs nothing more from the contributor. An award that
is not confirmed needs a wallet; one confirmed and not bound needs an
authorization; one confirmed and bound is being paid and is left out.
Several reserved awards of one account and project are one row, which keeps
the network of the first award read (by project, then numeric account id),
and a missing wallet wins over a missing authorization: nothing can be
authorized without it. Administrators and moderators, closed accounts and,
in production, testnet networks are left out; staging keeps testnets. Each
row also carries the account's login (its Points member login, else the
newest monthly award login for that project, else its newest wallet claim
login, else none) and the project's name (none when the project record is
unavailable). A row's account id that is not a positive safe integer fails
the read. The answer carries no amount, wallet address, award id or month,
and the read writes nothing.

```quint
type Need = NeedsWallet | NeedsAuthorize
type ReservedAward = { actor: int, project: str, network: str, testnet: bool, confirmed: bool, bound: bool }
type FeedRow = { actor: int, project: str, network: str, needs: Need }
pure def needOf(confirmed: bool): Need = if (confirmed) NeedsAuthorize else NeedsWallet
pure def listedAward(o: ReservedAward, team: List[int], closed: List[int], staging: bool): bool =
  not(team.includes(o.actor)) and not(closed.includes(o.actor)) and (staging or not(o.testnet))
    and not(o.confirmed and o.bound)
pure def mergedNeed(a: Need, b: Need): Need = if (a == NeedsWallet or b == NeedsWallet) NeedsWallet else NeedsAuthorize
pure def sameRow(r: FeedRow, o: ReservedAward): bool = r.actor == o.actor and r.project == o.project
pure def feedRows(awards: List[ReservedAward], team: List[int], closed: List[int], staging: bool): List[FeedRow] =
  awards.select(o => listedAward(o, team, closed, staging)).foldl(List(), (rows, o) =>
    if (rows.some(r => sameRow(r, o)))
      rows.listMap(r => if (sameRow(r, o)) { ...r, needs: mergedNeed(r.needs, needOf(o.confirmed)) } else r)
    else rows.append({ actor: o.actor, project: o.project, network: o.network, needs: needOf(o.confirmed) }))
pure def lawBoundAwardNotListed(o: ReservedAward, team: List[int], closed: List[int], staging: bool): bool =
  (o.confirmed and o.bound) implies not(listedAward(o, team, closed, staging))
pure def lawTeamAndClosedNotListed(o: ReservedAward, team: List[int], closed: List[int], staging: bool): bool =
  (team.includes(o.actor) or closed.includes(o.actor)) implies feedRows(List(o), team, closed, staging).length() == 0
pure def lawOneRowPerAccountAndProject(awards: List[ReservedAward], team: List[int], closed: List[int], staging: bool): bool =
  val rows = feedRows(awards, team, closed, staging)
  rows.every(r => rows.select(x => x.actor == r.actor and x.project == r.project).length() == 1)
pure def lawMissingWalletWins(awards: List[ReservedAward], team: List[int], closed: List[int], staging: bool): bool =
  feedRows(awards, team, closed, staging).every(r =>
    awards.some(o => sameRow(r, o) and listedAward(o, team, closed, staging) and not(o.confirmed)) implies r.needs == NeedsWallet)
pure val awaiting: ReservedAward = { actor: 1, project: "asi", network: "base-mainnet", testnet: false, confirmed: false, bound: false }
pure val oValues = Set(awaiting, { ...awaiting, confirmed: true }, { ...awaiting, confirmed: true, bound: true },
  { ...awaiting, actor: 2, network: "base-sepolia", testnet: true })
pure val awardsValues = Set(List(), List(awaiting), List({ ...awaiting, confirmed: true }, awaiting),
  List({ ...awaiting, confirmed: true }, { ...awaiting, confirmed: true, bound: true }, { ...awaiting, actor: 2, testnet: true }))
pure val teamValues = Set(List(), List(2))
pure val closedValues = Set(List(), List(1))
```
