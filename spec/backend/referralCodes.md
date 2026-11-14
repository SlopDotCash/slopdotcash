# Member-owned referral links

PRD section 11 and the approved development revision
`0d0f0817a439df03cc022bf7aeed4bbe64ef4c65` govern custom names. Sources are
`backend/referrals/codes.ts`, `src/lib/referral-code.ts`,
`migrations/0124_referral_codes.sql` and `formal/models/referrals/referral_code.qnt`.
The backend owns the permanent reservation and the one name each member uses.
Project registration continues to own referral capture for a final project
record. Saving or following a named link creates neither an accrual nor an
award and does not activate the deferred referral program.

## Story: Choose a name for a member's referral link

### Write admission binds an authenticated member and the reviewed name bytes

The shell accepts only a same-origin JSON POST carrying exactly one string
`code` within the bounded request body. It authenticates the current GitHub
actor and checks any expected-actor header. Valid names are 3–32 ASCII
letters, digits, hyphens or underscores, with alphanumeric endpoints. Keys
use lowercase ASCII. The reserved-name comparison strips hyphens and
underscores from that key. The exact reserved names are `api`, `eliza`,
`elizalabs`, `elizaos`, `help`, `new`, `null`, `referral`, `referrals`,
`security`, `shaw`, `shawwalters`, `slop`, `slopbot`, `slopcash`, `slopdesk`,
`slopdotcash`, `team`, `umia`, `umiafinance` and `undefined`. The reserved
substrings are `admin`, `moderator`, `official`, `staff` and `support`.
The shell derives syntax, normalized key and reservation findings from the
same exact bytes. GitHub checks a new name only if it is a possible GitHub
login. A confirmed missing login, one owned by the same immutable actor, or
a name outside GitHub login syntax can proceed. An unavailable lookup or a
login belonging to a different account refuses. Administrator and moderator
accounts cannot choose a name.

```quint
type NameEvidence = { text: str, key: str, syntaxValid: bool, reserved: bool }
type GitHubEvidence = LoginAbsent | LoginBelongsToActor | LoginElsewhere | LookupUnavailable | NotAGitHubLogin
type Choice = Accepted | OriginForbidden | ActorRequired | InvalidName | TeamAccount | ReservedName | NameTaken | OtherGitHubLogin | GitHubUnavailable | AtLifetimeLimit
type CodeRecord = { actor: str, text: str }
type LinkRegistry = { reservations: str -> CodeRecord, active: str -> str, held: str -> List[str], keys: List[str], actors: List[str] }
pure val initial: LinkRegistry = { reservations: Map(), active: Map(), held: Map(), keys: List(), actors: List() }
pure val byValues = Set("", "alice-id", "bob-id")
pure val nameValues = Set({ text: "Alpha", key: "alpha", syntaxValid: true, reserved: false })
  .union(Set({ text: "ALPHA", key: "alpha", syntaxValid: true, reserved: false }))
  .union(Set({ text: "Bravo", key: "bravo", syntaxValid: true, reserved: false }))
  .union(Set({ text: "charlie", key: "charlie", syntaxValid: true, reserved: false }))
  .union(Set({ text: "delta", key: "delta", syntaxValid: true, reserved: false }))
  .union(Set({ text: "echo", key: "echo", syntaxValid: true, reserved: false }))
  .union(Set({ text: "foxtrot", key: "foxtrot", syntaxValid: true, reserved: false }))
  .union(Set({ text: "Team", key: "team", syntaxValid: true, reserved: true }))
  .union(Set({ text: "_bad", key: "", syntaxValid: false, reserved: false }))
pure val githubValues = Set(LoginAbsent, LoginBelongsToActor, LoginElsewhere, LookupUnavailable, NotAGitHubLogin)
pure val weight_choose = 8
pure def recordFor(s: LinkRegistry, key: str): CodeRecord =
  if (s.keys.includes(key)) s.reservations.getOr(key, { actor: "", text: "" }) else { actor: "", text: "" }
pure def namesHeld(s: LinkRegistry, actor: str): List[str] =
  if (s.actors.includes(actor)) s.held.getOr(actor, List()) else List()
pure def choice(s: LinkRegistry, name: NameEvidence, sameOrigin: bool, team: bool, github: GitHubEvidence, actor: str): Choice =
  val previous = recordFor(s, name.key)
  if (not(sameOrigin)) OriginForbidden
  else if (actor == "") ActorRequired
  else if (not(name.syntaxValid) or name.text == "" or name.key == "") InvalidName
  else if (team) TeamAccount
  else if (name.reserved) ReservedName
  else if (previous.actor == actor) Accepted
  else if (previous.actor != "") NameTaken
  else if (github == LoginElsewhere) OtherGitHubLogin
  else if (github == LookupUnavailable) GitHubUnavailable
  else if (namesHeld(s, actor).length() >= 5) AtLifetimeLimit
  else Accepted
```

### The reservation and change of active name commit together

The transaction claims a free key, retires the old active name and sets the
requested active name. It gives each account five lifetime reservations.
An abandoned name remains reserved to its original actor. The same actor can
reuse any of its names at the cap and can change the displayed spelling of the
same canonical key. Transaction contention is resolved against the winning
reservation and current count before changing any active name. A failed
submission leaves the current name in use.

```quint
pure def canChoose(s: LinkRegistry, name: NameEvidence, sameOrigin: bool, team: bool, github: GitHubEvidence, by: str): bool =
  choice(s, name, sameOrigin, team, github, by) == Accepted
pure def choose(s: LinkRegistry, name: NameEvidence, sameOrigin: bool, team: bool, github: GitHubEvidence, by: str): LinkRegistry =
  { reservations: s.reservations.put(name.key, { actor: by, text: name.text }),
    active: s.active.put(by, name.key),
    held: if (recordFor(s, name.key).actor == by) s.held else s.held.put(by, namesHeld(s, by).append(name.key)),
    keys: if (s.keys.includes(name.key)) s.keys else s.keys.append(name.key),
    actors: if (s.actors.includes(by)) s.actors else s.actors.append(by) }
pure def activeKey(s: LinkRegistry, actor: str): str =
  if (s.actors.includes(actor)) s.active.getOr(actor, "") else ""
pure def alwaysPairedOwnership(s: LinkRegistry): bool =
  s.keys.every(key => key != "" and recordFor(s, key).actor != "" and recordFor(s, key).text != ""
    and s.actors.includes(recordFor(s, key).actor) and namesHeld(s, recordFor(s, key).actor).includes(key))
  and s.actors.every(actor => actor != "" and namesHeld(s, actor).every(key =>
    s.keys.includes(key) and recordFor(s, key).actor == actor))
pure def alwaysLifetimeLimit(s: LinkRegistry): bool = s.actors.every(actor => namesHeld(s, actor).length() <= 5)
pure def alwaysActiveReserved(s: LinkRegistry): bool = s.actors.every(actor => actor != "" and activeKey(s, actor) != ""
  and recordFor(s, activeKey(s, actor)).actor == actor)
pure def stepHoldingsGrow(before: LinkRegistry, after: LinkRegistry): bool = before.keys.every(key =>
  after.keys.includes(key) and recordFor(before, key).actor == recordFor(after, key).actor)
pure def retiredBy(s: LinkRegistry, actor: str, key: str): bool = recordFor(s, key).actor == actor and activeKey(s, actor) != key
pure def sometimesReplacedLink(s: LinkRegistry): bool = retiredBy(s, "alice-id", "alpha") and activeKey(s, "alice-id") == "bravo"
pure def sometimesDistinctOwners(s: LinkRegistry): bool = activeKey(s, "alice-id") != "" and activeKey(s, "bob-id") != ""
```

## Story: Follow a referral link to the project form

### A current reservation resolves through current open membership

GET and HEAD return a non-cacheable redirect to the same-origin project
form. The optional `ref` parameter is the member's current GitHub login. It
comes from joining `points_members` by the immutable actor ID, using the
active reservation and an open member. Malformed, unknown, replaced and
closed-account links reach the form without a referral. A failed database
read for a syntactically valid code returns 503 and invites retry. Other
methods return 405. A route that does not match the referral prefix is
outside this contract. The shell must percent-encode the returned login and
must derive syntax and membership from verified route and database data.

```quint
type Lookup = MemberFound({ actor: str, login: str }) | MemberAbsent | ReadUnavailable
type Redirect = MethodDenied | Form | FormWithRef({ login: str }) | LinkUnavailable
pure def destination(s: LinkRegistry, safeMethod: bool, key: str, syntaxValid: bool, membership: Lookup): Redirect =
  if (not(safeMethod)) MethodDenied
  else if (not(syntaxValid) or key == "") Form
  else match membership {
    | ReadUnavailable => LinkUnavailable
    | MemberAbsent => Form
    | MemberFound(member) =>
      if (member.actor != "" and member.login != "" and recordFor(s, key).actor == member.actor
        and activeKey(s, member.actor) == key) FormWithRef({ login: member.login }) else Form
  }
```

### The referral path without a name opens Settings without a database read

PRD section 11 at `78eed5564d796119d82ae541c36b0c770263dc5f` adds a route
for `/referral` and `/referral/`. Both open same-origin `/account#referral`
with no database lookup. Other referral paths use the named-link policy
above, including its generic project form and unavailable outcomes. Other
routes fall through. Only GET and HEAD can redirect.

```quint
type ReferralPath = BareReferral | NamedReferral | OutsideReferral
type ReferralRoute = FallThrough | ReferralSettings | RedirectResult({ result: Redirect })
pure def linkRoute(s: LinkRegistry, route: ReferralPath, safeMethod: bool, key: str, syntaxValid: bool, membership: Lookup): ReferralRoute =
  if (route == OutsideReferral) FallThrough
  else if (not(safeMethod)) RedirectResult({ result: MethodDenied })
  else if (route == BareReferral) ReferralSettings
  else RedirectResult({ result: destination(s, safeMethod, key, syntaxValid, membership) })
pure def lawBareReferralIgnoresLookup(s: LinkRegistry, key: str, syntaxValid: bool, membership: Lookup): bool =
  val selected = linkRoute(s, BareReferral, true, key, syntaxValid, membership)
  match selected { | ReferralSettings => true | _ => false }
pure def lawUnsafeReferralCannotRedirect(s: LinkRegistry, route: ReferralPath, key: str, syntaxValid: bool, membership: Lookup): bool =
  val selected = linkRoute(s, route, false, key, syntaxValid, membership)
  route != OutsideReferral implies match selected {
    | RedirectResult(redirect) => isMethodDenied(redirect.result)
    | _ => false
  }
pure def isMethodDenied(result: Redirect): bool = match result { | MethodDenied => true | _ => false }
pure val sValues = Set(initial)
pure val keyValues = Set("", "alpha")
pure val membershipValues = Set(MemberAbsent, ReadUnavailable, MemberFound({ actor: "alice-id", login: "alice" }))
```
