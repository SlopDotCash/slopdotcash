# Payout exception audience

PRD section 9 ("Notifications") sends each payout exception to the account
that answers for the project's payouts. Nobody can sign in as a GitHub
Organization, so development (`backend/notifications/events.ts`, `LISTED_BY`
and `PAYOUT_EXCEPTION_RECIPIENTS`; `workers/notify/activity.ts`,
`stillProjectRecipient`; the recipient table of `workers/notify/README.md`;
commits 02974afb1 and 94af74d6a) sends it to the project's GitHub steward
when the steward is a user account, and to the account that listed the
project when the steward is an Organization. This library is that choice.
The [notice outbox](./notifications.md) rechecks it before each payout
exception is sent, and a held payout and an underfunded month
([moderator and steward Inbox](./moderation.md)) are addressed to it.

## Story: A payout exception reaches an account that can sign in

### The account that listed a project is its source application's applicant, else the actor of its first revision

A project created from an application was listed by that application's
applicant. A project with no source application was listed by the actor of
its revision 1 when that actor is recorded. Otherwise no lister is recorded
(`0`): a project whose source application has no recorded applicant has
none, and its first revision is not consulted.

```quint
type Listing = { fromApplication: bool, applicant: int, firstActor: int }
pure def listedBy(listing: Listing): int =
  if (listing.fromApplication and listing.applicant > 0) listing.applicant
  else if (not(listing.fromApplication) and listing.firstActor > 0) listing.firstActor
  else 0
pure def lawListerIsRecorded(listing: Listing): bool =
  val lister = listedBy(listing)
  lister >= 0 and (lister > 0 implies (if (listing.fromApplication) lister == listing.applicant else lister == listing.firstActor))
pure val listingValues = Set(
  { fromApplication: true, applicant: 7, firstActor: 9 },
  { fromApplication: true, applicant: 0, firstActor: 9 },
  { fromApplication: false, applicant: 7, firstActor: 9 },
  { fromApplication: false, applicant: 0, firstActor: 0 })
```

### A payout exception reaches a user steward, or the lister of an Organization steward when one is recorded

A steward whose GitHub account type is anything other than `Organization`
(a user, or a missing type) keeps the notice, and the lister gets no copy. An
Organization steward's notice goes only to the account that listed the
project; when no lister is recorded it stays with the steward. The audience
is one account, so a replay or a recheck never adds a second recipient.

```quint
type StewardAccount = UserSteward | OrganizationSteward
type PayoutProject = { steward: int, stewardAccount: StewardAccount, listing: Listing }
pure def payoutRecipient(project: PayoutProject): int =
  val lister = listedBy(project.listing)
  if (project.stewardAccount == OrganizationSteward and lister > 0) lister
  else if (project.steward > 0) project.steward
  else 0
pure def inPayoutAudience(project: PayoutProject, recipient: int): bool =
  recipient > 0 and recipient == payoutRecipient(project)
pure def lawUserStewardKeepsPayoutException(project: PayoutProject, recipient: int): bool =
  project.stewardAccount == UserSteward implies
    (inPayoutAudience(project, recipient) iff (recipient > 0 and recipient == project.steward))
pure def lawOrganizationStewardPayoutReachesLister(project: PayoutProject, recipient: int): bool =
  (project.stewardAccount == OrganizationSteward and listedBy(project.listing) > 0) implies
    (inPayoutAudience(project, recipient) iff recipient == listedBy(project.listing))
pure def lawUnlistedOrganizationKeepsSteward(project: PayoutProject, recipient: int): bool =
  (project.stewardAccount == OrganizationSteward and listedBy(project.listing) == 0) implies
    (inPayoutAudience(project, recipient) iff (recipient > 0 and recipient == project.steward))
pure val projectValues = Set(
  { steward: 8, stewardAccount: UserSteward, listing: { fromApplication: true, applicant: 7, firstActor: 9 } },
  { steward: 8, stewardAccount: OrganizationSteward, listing: { fromApplication: true, applicant: 7, firstActor: 9 } },
  { steward: 8, stewardAccount: OrganizationSteward, listing: { fromApplication: false, applicant: 0, firstActor: 9 } },
  { steward: 8, stewardAccount: OrganizationSteward, listing: { fromApplication: true, applicant: 0, firstActor: 9 } })
pure val recipientValues = Set(0, 7, 8, 9)
```
