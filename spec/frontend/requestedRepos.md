# Requested repos page

The public `/requested` page (development `src/RequestedRepos.tsx` and
`formal/models/ui/ui_requested_repos.qnt` at `f3f2725e0`, byte-identical on
main `b2aa3f920`): the repositories Slop contributors with merged work would
work on, by count, and the viewer's own flags. [The registry of requested
repos](../backend/repoRequests.md) decides every flag, renewal and
withdrawal; this page only asks and shows the answer. The page is keyed by
the account, so an account change starts a new lifetime: a request keeps the
lifetime it began in, and an answer for an earlier lifetime is dropped.

What the shell shows. The heading "Requested repos" and the line "Repos Slop
contributors want to work on. A count is accounts with merged work on Slop
that flagged the repo in the last 90 days." Without `?flag=`, a "Flag a repo"
region holds a Repository field (placeholder `owner/name`, at most 300
characters) that accepts `owner/name` or a GitHub link to the repository or
anything inside it (a trailing `.git` and trailing slashes dropped); text
that is neither shows "Enter the repository as owner/name or paste its
GitHub link." A signed-out submit goes to `/requested?flag=<repo>`. With
`?flag=`, the "Flag a repo" region shows "Enter the repository as
owner/name." for an invalid value, "Checking sign-in" while the session
loads, a sign-in panel "Sign in to flag <repo> as a repo you'd work on."
returning to the same address when signed out ("Sign-in could not be
checked. Try again." when the session read failed), and otherwise "Flag
<repo> as a repo you'd work on?" with a Flag button ("Saving…" while a
request is in flight). A success shows "Flagged <repo> until <date>." or
"Withdrawn your flag on <repo>."; a refusal shows the server's message unless
it is "Internal error", else "Your flag could not be saved. Retry.", and an
answer that cannot be read shows "Your flag could not be read. Reload the
page." Each request carries the signed-in account's GitHub id in the
`x-slop-expected-github-id` header, so the backend refuses it when the
session now belongs to another account. While the first read is in flight
the board shows "Loading requested repos". The board is a table (caption
Requested repos; Repo, Contributors, Last flagged, Pitch, each pitch with a
Copy pitch button answering "Copied." or "Copy failed. Select and copy the
text."), or "No repos are flagged yet.", or "Requested repos could not
load." with Try again. A signed-in viewer with a
loaded board sees "Your flags": "You have not flagged a repo.", or each flag
with "· Counts until <date>" and Renew and Withdraw, or "· Now on Slop as
<project>" and Withdraw only, every button disabled while a request is in
flight. A pitch reads "<n> Slop contributor(s) with
merged work want(s) to work on <repo>. List it free at <link>", where the
link is the viewer's named referral link `<origin>/referral/<code>`, else
the viewer's login link `<origin>/r/<login>`, else `<origin>/projects/new`
signed out (development `src/lib/repo-requests.ts` `pitchLink` and
`pitchText`).

## Story: See requested repos, flag one, renew or withdraw it

> As a visitor, I want to see which repositories Slop contributors would work
> on and copy a pitch for one; as a member with merged work, I want to flag a
> repository, and renew or withdraw my flags, without a slow or stale answer
> undoing what I see.

### A board read keeps a ready board on screen and a failed one offers Try again

`mount` is a new lifetime of the page: the first render of an account, or an
account change (`actor` "" is signed out). A reload keeps a ready board on
screen until its answer arrives, and a failed reload keeps it too; a failed
first read shows the error with Try again. Each read carries the number of
the read it answers; only the latest read of the lifetime settles the board,
so an older answer never replaces the reload a success asked for
(development `src/RequestedRepos.tsx` aborts the earlier load whenever a
new one starts).

```quint
type BoardStatus = BoardLoading | BoardReady | BoardFailed
type RequestNotice = NoNotice | ActDone | ActRefused
type RequestedPage = { actor: str, lifetime: int, reading: int, board: BoardStatus, loading: bool, pending: int,
  notice: RequestNotice }
pure val initial: RequestedPage = { actor: "", lifetime: 1, reading: 1, board: BoardLoading, loading: true, pending: 0,
  notice: NoNotice }
pure def canMount(s: RequestedPage, actor: str): bool = s.lifetime < 9007199254740991 and s.reading < 9007199254740991
pure def mount(s: RequestedPage, actor: str): RequestedPage =
  { actor: actor, lifetime: s.lifetime + 1, reading: s.reading + 1, board: BoardLoading, loading: true, pending: 0,
    notice: NoNotice }
pure def canBoardAnswered(s: RequestedPage, read: int, life: int): bool = s.loading and life == s.lifetime
  and read == s.reading
pure def boardAnswered(s: RequestedPage, ok: bool, read: int, life: int): RequestedPage =
  { ...s, loading: false,
    board: if (ok) BoardReady else if (s.board == BoardReady) BoardReady else BoardFailed }
pure def canRetry(s: RequestedPage): bool = not(s.loading) and s.board == BoardFailed and s.reading < 9007199254740991
pure def retry(s: RequestedPage): RequestedPage = { ...s, reading: s.reading + 1, loading: true, board: BoardLoading }
pure def alwaysLifetimeIsPositive(s: RequestedPage): bool = s.lifetime >= 1
pure def alwaysReadingIsPositive(s: RequestedPage): bool = s.reading >= 1
pure def alwaysFailedBoardIsNotLoading(s: RequestedPage): bool = s.board == BoardFailed implies not(s.loading)
pure def alwaysLoadingBoardIsBeingRead(s: RequestedPage): bool = s.board == BoardLoading implies s.loading
pure def sometimesFailedBoardOffersTryAgain(s: RequestedPage): bool = s.board == BoardFailed and canRetry(s)
pure def sometimesReadyBoardReloading(s: RequestedPage): bool = s.board == BoardReady and s.loading
pure val actorValues = Set("", "900000101", "900000102")
pure val okValues = Set(true, false)
pure val lifeValues = Set(1, 2, 3)
pure val readValues = Set(1, 2, 3)
```

### One flag, renew or withdraw is in flight per lifetime, a success reloads the board and a refusal changes nothing else

Only a signed-in viewer sends a request, and only one at a time. Sending
clears the notice of the last answer. A success shows its notice and reloads
the board, showing loading in place of a failed board and keeping a ready one
on screen; a refusal shows its reason and leaves the board as it is.

```quint
pure def canSubmit(s: RequestedPage): bool = s.pending == 0 and s.actor != ""
pure def submit(s: RequestedPage): RequestedPage = { ...s, pending: s.lifetime, notice: NoNotice }
pure def canActAnswered(s: RequestedPage, life: int): bool =
  s.pending != 0 and s.pending == s.lifetime and life == s.lifetime and s.reading < 9007199254740991
pure def actAnswered(s: RequestedPage, ok: bool, life: int): RequestedPage =
  { ...s, pending: 0, notice: if (ok) ActDone else ActRefused,
    reading: if (ok) s.reading + 1 else s.reading,
    loading: if (ok) true else s.loading,
    board: if (ok and s.board == BoardFailed) BoardLoading else s.board }
pure def alwaysRequestBelongsToThisLifetime(s: RequestedPage): bool = s.pending == 0 or s.pending == s.lifetime
pure def alwaysNoticeNeverBesideARequest(s: RequestedPage): bool = s.pending != 0 implies s.notice == NoNotice
pure def alwaysOnlyASignedInViewerAsks(s: RequestedPage): bool = s.pending != 0 implies s.actor != ""
pure def stepAccountChangeDropsTheRequest(before: RequestedPage, after: RequestedPage): bool =
  after.lifetime != before.lifetime implies (after.pending == 0 and after.notice == NoNotice)
pure def sometimesFlagReloadsTheBoard(s: RequestedPage): bool = s.notice == ActDone and s.loading
pure def sometimesRefusalKeepsTheBoard(s: RequestedPage): bool = s.notice == ActRefused and s.board == BoardReady and not(s.loading)
pure val eval_witness_sometimesFlagReloadsTheBoard = (("mount", "900000101"), "submit", ("actAnswered", true, 2))
pure val eval_witness_sometimesRefusalKeepsTheBoard =
  (("mount", "900000101"), ("boardAnswered", true, 2, 2), "submit", ("actAnswered", false, 2))
```
