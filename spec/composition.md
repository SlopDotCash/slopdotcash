# Account-owned browser composition

PRD sections 3, 8 and 12. This machine composes navigation, draft and mounted private-report lifetimes.
Backend project, financial and case machines retain their own authority checks.

## Story: Change accounts without disclosing the prior account's draft

### The active draft and navigation share one authenticated actor

```quint
import navigation as N from "./frontend/navigation"
import drafts as D from "./frontend/drafts"
import reportDetails as R from "./frontend/reportDetails"
type BrowserSession = { navigation: N::Navigation, draft: D::Draft, details: R::DetailSet }
pure val initial: BrowserSession = { navigation: N::initial, draft: D::initial, details: R::emptyDetails }
pure def canAuthenticate(b: BrowserSession, actorId: int): bool = N::canSignIn(b.navigation, actorId)
pure def authenticate(b: BrowserSession, actorId: int): BrowserSession = { navigation: N::signIn(b.navigation, actorId), draft: D::initial, details: R::emptyDetails }
pure def logout(b: BrowserSession): BrowserSession = { navigation: N::signOut(b.navigation), draft: D::initial, details: R::emptyDetails }
pure def canBeginReport(b: BrowserSession, projectId: int): bool = b.navigation.actor > 0 and projectId > 0
pure def beginReport(b: BrowserSession, projectId: int): BrowserSession = {
  ...b, navigation: N::navigate(b.navigation, N::Report), draft: D::open(b.draft, b.navigation.actor, projectId)
}
pure def canEditReport(b: BrowserSession, contentDigest: int): bool = D::canEdit(b.draft, contentDigest)
pure def editReport(b: BrowserSession, contentDigest: int, storageAvailable: bool): BrowserSession =
  { ...b, draft: D::edit(b.draft, contentDigest, storageAvailable) }
pure def canReviewReport(b: BrowserSession): bool = D::canReview(b.draft)
pure def reviewReport(b: BrowserSession): BrowserSession = { ...b, draft: D::review(b.draft) }
pure def canSubmitReport(b: BrowserSession, submissionKey: int): bool = D::canSend(b.draft, submissionKey)
pure def submitReport(b: BrowserSession, submissionKey: int): BrowserSession = { ...b, draft: D::send(b.draft, submissionKey) }
```

### Each mounted report must belong to the authorized current account lifetime

Current authority comes from the case service and is checked against the exact
submission. A response captured for a prior account or navigation epoch cannot
mount a detail. Sign-out and authentication erase every mounted detail. Closing
one detail leaves its siblings mounted.

```quint
pure def canOpenDetail(b: BrowserSession, actorId: int, requestEpoch: int, submission: int, caseReadAuthorized: bool): bool =
  b.navigation.actor > 0 and actorId == b.navigation.actor and requestEpoch == b.navigation.epoch and caseReadAuthorized
    and R::canOpenDetail(b.details, submission)
pure def openDetail(b: BrowserSession, actorId: int, requestEpoch: int, submission: int, caseReadAuthorized: bool): BrowserSession =
  { ...b, details: R::openDetail(b.details, submission) }
pure def canCloseDetail(b: BrowserSession, submission: int): bool = R::canCloseDetail(b.details, submission)
pure def closeDetail(b: BrowserSession, submission: int): BrowserSession = { ...b, details: R::closeDetail(b.details, submission) }
pure def alwaysDetailsOwned(b: BrowserSession): bool = b.details.opened.size() > 0 implies b.navigation.actor > 0
pure def stepAccountChangeClearsDetails(before: BrowserSession, via: str, after: BrowserSession): bool =
  (via == "authenticate" or via == "logout") implies after.details.opened.size() == 0
pure def sometimesSiblingDetails(b: BrowserSession): bool = b.details.opened.size() > 1
pure val submissionValues = Set(1, 2)
pure val requestEpochValues = Set(1, 2, 3, 4)
```

### Account changes erase drafts and preserve every child invariant

```quint
pure def alwaysSharedActor(b: BrowserSession): bool = b.draft.actor == 0 or b.draft.actor == b.navigation.actor
pure def alwaysChildrenValid(b: BrowserSession): bool = N::alwaysPrivateRowsHaveOwner(b.navigation) and N::alwaysEpochsAreValid(b.navigation) and D::alwaysDraftBinding(b.draft)
pure def stepAccountChangeClearsDraft(before: BrowserSession, via: str, after: BrowserSession): bool =
  (via == "authenticate" or via == "logout") implies after.draft == D::initial
pure def sometimesReportSubmitted(b: BrowserSession): bool = b.draft.stage == D::Sending and b.navigation.actor == b.draft.actor
pure def sometimesLogoutClears(b: BrowserSession): bool = b.navigation.epoch > 2 and b.navigation.actor == 0 and b.draft == D::initial
pure val actorIdValues = Set(1, 2)
pure val projectIdValues = Set(1, 2)
pure val contentDigestValues = Set(1, 2)
pure val submissionKeyValues = Set(1, 2)
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val viaValues = Set("", "a", "b")
```
