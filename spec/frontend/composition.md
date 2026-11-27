# Account-owned browser composition

PRD sections 3, 8 and 12. This machine composes navigation, draft and mounted private-report lifetimes.
Backend project, financial and case machines retain their own authority checks.

## Story: Change accounts without disclosing the prior account's draft

### The active draft and navigation share one authenticated actor

```quint
import navigation as N from "./navigation"
import drafts as D from "./drafts"
import reportDetails as R from "./reportDetails"
type BrowserSession = { navigation: N::Navigation, draft: D::Draft, details: R::DetailSet, returnPath: str }
pure val initial: BrowserSession = { navigation: N::initial, draft: D::initial, details: R::emptyDetails, returnPath: "/" }
pure def canAuthenticate(b: BrowserSession, actorId: int): bool = N::canSignIn(b.navigation, actorId)
pure def authenticate(b: BrowserSession, actorId: int): BrowserSession =
  { navigation: N::signIn(b.navigation, actorId), draft: D::initial, details: R::emptyDetails, returnPath: b.returnPath }
pure def logout(b: BrowserSession): BrowserSession =
  { navigation: N::signOut(b.navigation), draft: D::initial, details: R::emptyDetails, returnPath: "/" }
pure def canServerSessionEnded(b: BrowserSession): bool = b.navigation.actor > 0
pure def serverSessionEnded(b: BrowserSession): BrowserSession = logout(b)
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

### Sign-in keeps only a safe same-origin return destination

PRD section 3 keeps the return destination through sign-in. The shell's
parser (`src/lib/login-return.ts`) turns the requested `next` value into a
`ParsedNext`: `SameOriginPath` with the decoded path when the value is a
same-origin path starting with exactly one `/` and holding no backslash
(`next=earnings` is its alias for `/earnings`), and `ForeignOrMalformed`
otherwise; that parse is a shell obligation over the raw value. This machine
decides the rest: only a same-origin path that is not the login page itself, in any form that resolves to it ("/login" or "/login/"),
is kept, and anything else returns to `/`, so the saved destination is never
empty and never loops back to sign-in. A private report draft is never a
permitted draft across an account change: authentication erases it (below).
A server answer that the session expired, was revoked or the account closed
ends the browser session exactly like sign-out.

```quint
type ParsedNext = SameOriginPath({ path: str }) | ForeignOrMalformed
pure val loginPath = "/login"
pure def isLoginPath(p: str): bool = p == loginPath or p == "/login/"
pure def returnFor(request: ParsedNext): str = match request {
  | SameOriginPath(p) => if (p.path != "" and not(isLoginPath(p.path))) p.path else "/"
  | _ => "/"
}
pure def canSaveReturn(b: BrowserSession, request: ParsedNext): bool = b.navigation.actor == 0
pure def saveReturn(b: BrowserSession, request: ParsedNext): BrowserSession = { ...b, returnPath: returnFor(request) }
pure def alwaysReturnPathSafe(b: BrowserSession): bool = b.returnPath != "" and not(isLoginPath(b.returnPath))
pure def stepServerEndClearsPrivateState(before: BrowserSession, via: str, after: BrowserSession): bool =
  via == "serverSessionEnded" implies after.draft == D::initial and after.details.opened.size() == 0 and after.navigation.actor == 0
pure def stepSignInKeepsReturnPath(before: BrowserSession, via: str, after: BrowserSession): bool =
  via == "authenticate" implies after.returnPath == before.returnPath
pure val requestValues = Set(SameOriginPath({ path: "/inbox" }), SameOriginPath({ path: "/login" }), SameOriginPath({ path: "/login/" }),
  SameOriginPath({ path: "" }), ForeignOrMalformed)
pure def sometimesSafeReturnKept(b: BrowserSession): bool = b.navigation.actor > 0 and b.returnPath == "/inbox"
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
  (via == "authenticate" or via == "logout" or via == "serverSessionEnded") implies after.details.opened.size() == 0
pure def sometimesSiblingDetails(b: BrowserSession): bool = b.details.opened.size() > 1
pure val submissionValues = Set(1, 2)
pure val requestEpochValues = Set(1, 2, 3, 4)
```

### A focus identity refresh changes the account only through sign-in or sign-out

The shell's focus re-read of the session reaches the browser session through
the navigation rule "An identity refresh applies only within the navigation
lifetime that requested it". The same account keeps the report draft, its
mounted details and the return destination. Another account or no account
erases them exactly as authentication and logout do.

```quint
pure def canRefreshAccount(b: BrowserSession, refreshedActor: int, requestEpoch: int): bool =
  N::canRefreshIdentity(b.navigation, refreshedActor, requestEpoch)
pure def refreshAccount(b: BrowserSession, refreshedActor: int, requestEpoch: int): BrowserSession =
  if (refreshedActor == b.navigation.actor) b
  else if (refreshedActor == 0) logout(b)
  else authenticate(b, refreshedActor)
pure def stepRefreshChangesAccountOnlyByClearing(before: BrowserSession, via: str, after: BrowserSession): bool =
  (via == "refreshAccount" and after.navigation.actor != before.navigation.actor) implies
    after.draft == D::initial and after.details.opened.size() == 0
pure val refreshedActorValues = Set(0, 1, 2)
```

### Account changes erase drafts and preserve every child invariant

```quint
pure def alwaysSharedActor(b: BrowserSession): bool = b.draft.actor == 0 or b.draft.actor == b.navigation.actor
pure def alwaysChildrenValid(b: BrowserSession): bool = N::alwaysPrivateRowsHaveOwner(b.navigation) and N::alwaysEpochsAreValid(b.navigation) and D::alwaysDraftBinding(b.draft)
pure def stepAccountChangeClearsDraft(before: BrowserSession, via: str, after: BrowserSession): bool =
  (via == "authenticate" or via == "logout" or via == "serverSessionEnded") implies after.draft == D::initial
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
pure val eval_witness_sometimesSiblingDetails = (
  ("authenticate", 1),
  ("openDetail", 1, 1, 1, true),
  ("openDetail", 1, 1, 2, true)
)
pure val eval_witness_sometimesReportSubmitted = (
  ("authenticate", 1),
  ("beginReport", 1),
  ("editReport", 1, true),
  "reviewReport",
  ("submitReport", 1)
)
```
