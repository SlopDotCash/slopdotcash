# Referral link settings

PRD section 11 authorizes link names even while referral accrual is deferred.
This model follows developer revision `0d0f0817a439df03cc022bf7aeed4bbe64ef4c65`
and its `src/ReferralCode.tsx`, `src/Points.tsx` and
`formal/models/ui/ui_referral_code.qnt`. [The registry](../backend/referralCodes.md)
owns the names and checks write authority. The account response carries the
current name. Settings shows the link when one exists and explains that saving
a new name stops the old link. The page makes no reward claim.

## Story: Edit and save the current account's referral name

### A loaded account owns the displayed link and the editable draft

Loading another account or signing out invalidates the form lifetime. A
fresh member record starts with its own saved name. The shell shows only its
current link, constructed from the current origin and saved code. Failed
clipboard access allows manual selection without changing the saved name.

```quint
import referrals as RF from "../settlement/referrals"
type SaveNotice = Quiet | Saving | InvalidDraft | Saved | SaveFailed
type Answer = Stored({ code: str }) | EmptyAnswer | FailedAnswer
type Settings = { actor: str, lifetime: int, sequence: int, savedCode: str, draft: str, pending: int, notice: SaveNotice,
  programEnabled: bool, programMode: RF::ReferralMode, claimShown: bool }
pure val initial: Settings = { actor: "", lifetime: 0, sequence: 0, savedCode: "", draft: "", pending: 0, notice: Quiet,
  programEnabled: false, programMode: RF::Off, claimShown: false }
pure val actorValues = Set("alice-id", "bob-id")
pure val codeValues = Set("", "Alpha", "Bravo")
pure val textValues = Set("", "Alpha", "Bravo", "_bad")
pure val answerValues = Set(Stored({ code: "Alpha" }), Stored({ code: "Bravo" }), EmptyAnswer, FailedAnswer)
pure val lifetimeValues = Set(1, 2, 3)
pure val requestValues = Set(1, 2, 3)
pure def canMount(s: Settings, actor: str): bool = actor != "" and s.lifetime < 9007199254740991
pure def mount(s: Settings, actor: str, code: str): Settings = { ...s, actor: actor, lifetime: s.lifetime + 1,
  savedCode: code, draft: code, pending: 0, notice: Quiet, claimShown: false }
pure def signOut(s: Settings): Settings = { ...s, actor: "", savedCode: "", draft: "", pending: 0, notice: Quiet, claimShown: false }
pure def canEdit(s: Settings): bool = s.actor != "" and s.pending == 0
pure def edit(s: Settings, text: str): Settings = { ...s, draft: text, notice: if (s.notice == Saved) Quiet else s.notice }
```

### Exactly one request can act for each active account lifetime

The shell trims the draft, validates referral syntax and sends the expected
actor with a same-origin authenticated request. An invalid draft never posts.
Selecting the current spelling offers no save. A response is accepted only
for the same account, mounted lifetime and request. The returned code must
pass the same response parser. An error or invalid response preserves the
last saved link. Closing the form prevents a later response from showing on a
new account, even if the transport finishes. A parsed empty success has no
saved name to apply and also preserves the link.

```quint
pure def canSubmit(s: Settings, text: str, normalized: str, syntaxValid: bool): bool = s.actor != "" and s.pending == 0
  and text == s.draft and normalized != s.savedCode and (not(syntaxValid) or (s.sequence < 9007199254740991 and normalized != ""))
pure def submit(s: Settings, text: str, normalized: str, syntaxValid: bool): Settings =
  if (syntaxValid) { ...s, sequence: s.sequence + 1, pending: s.sequence + 1, notice: Saving }
  else { ...s, notice: InvalidDraft }
pure def canResolve(s: Settings, actor: str, lifetime: int, request: int): bool = s.actor != "" and actor == s.actor
  and lifetime == s.lifetime and request > 0 and request == s.pending
pure def resolve(s: Settings, actor: str, lifetime: int, request: int, answer: Answer): Settings =
  match answer {
    | Stored(value) => if (value.code == "") { ...s, pending: 0, notice: SaveFailed }
      else { ...s, pending: 0, savedCode: value.code, draft: value.code, notice: Saved }
    | EmptyAnswer => { ...s, pending: 0, notice: Quiet }
    | FailedAnswer => { ...s, pending: 0, notice: SaveFailed }
  }
pure def alwaysOwner(s: Settings): bool = (s.actor != "" implies s.lifetime > 0) and (s.actor == "" implies s.pending == 0 and s.savedCode == "" and s.draft == "" and s.notice == Quiet)
pure def alwaysRequest(s: Settings): bool = s.sequence >= 0 and s.lifetime >= 0 and s.pending >= 0
  and (s.pending > 0 implies s.sequence == s.pending and s.lifetime > 0)
  and ((s.pending > 0) iff (s.notice == Saving))
pure def alwaysSaved(s: Settings): bool = s.notice == Saved implies s.savedCode != "" and s.savedCode == s.draft
pure def stepRetainsNameOutsideVerifiedReply(before: Settings, via: str, after: Settings): bool =
  (via != "mount" and via != "signOut" and (via != "resolve" or after.notice != Saved)) implies before.savedCode == after.savedCode
pure def stepRequestOrder(before: Settings, after: Settings): bool = before.sequence <= after.sequence and before.lifetime <= after.lifetime
pure def sometimesSaving(s: Settings): bool = s.pending > 0
pure def sometimesSaved(s: Settings): bool = s.notice == Saved
pure def sometimesFailedPreservesLink(s: Settings): bool = s.notice == SaveFailed and s.savedCode != ""
```

## Story: Keep the referral claim surface absent while referrals are deferred

### The claim surface renders only for an enabled program whose posting is activated

The owner deferred referrals from launch on 27 October 2026: the accrual
mode stays off and the program flag false. The claim surface of
`src/ReferralClaims.tsx` renders only when the server reports the program
enabled and the [referral program](../settlement/referrals.md) has reached
its activated posting mode; otherwise it is absent, with no disabled control
or placeholder. A new account or a sign-out hides it until the program is
observed again. Modelling the claim lifetime (its lock, storage failure and
late result, retained as `ui_referral_claim_lifetime`) is deferred until the
owner approves reactivation.

```quint
pure def observeProgram(s: Settings, programOn: bool, mode: RF::ReferralMode): Settings =
  { ...s, programEnabled: programOn, programMode: mode, claimShown: s.actor != "" and programOn and mode == RF::Posting }
pure def alwaysClaimOnlyWhenActivated(s: Settings): bool =
  s.claimShown implies s.actor != "" and s.programEnabled and s.programMode == RF::Posting
pure def sometimesClaimAbsentWhileDeferred(s: Settings): bool = s.actor != "" and not(s.claimShown) and s.programMode == RF::Off
pure def sometimesClaimShown(s: Settings): bool = s.claimShown
```
