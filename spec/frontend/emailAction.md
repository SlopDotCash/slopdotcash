# Email link actions

PRD section 7. A verification or unsubscribe email links to
`/inbox#verify-email=<token>` or `/inbox#unsubscribe-email=<token>`. The server
half is [the email rules](../backend/email.md), "Verification is
account-bound, single-use, unexpired and applies the consent requested with
it". This machine is the browser half: opening the link never acts by itself,
and the token survives the GitHub sign-in round trip without entering a URL.

## Story: Verify an email address after signing in from the link

> As a member who opened a verification link while signed out, I want to sign
> in and then verify with one click, for my own account only.

### An email verify or unsubscribe token survives sign-in and is applied once to the signed-in account

On load the shell moves the fragment's token into session storage
(`slop:email-action:v1`, with its kind, the account it is bound to and the
capture time) and removes the fragment from the address, so the token never
reaches a request URL, a referrer or the sign-in return address. A verify
token is 64 lowercase hex digits; an unsubscribe token is two such groups
joined by a dot; any other token shows "This email link is invalid." A stored
action is restored only within 30 minutes of its capture. A verify link needs
a signed-in account: the first session check binds the action to that account,
and a later check naming another account refuses with "Your account changed".
The person then presses Verify email or Unsubscribe; an unsubscribe needs no
sign-in. The request carries the bound account as its expected actor. Only a
confirmed answer erases the stored action and shows the result; Dismiss
erases it unused. A new link replaces the action and every earlier answer for
it is dropped.

```quint
type EmailKind = NoEmailAction | VerifyEmail | UnsubscribeEmail
type EmailAction = { kind: EmailKind, tokenValid: bool, boundActor: int, signedIn: int, accountChanged: bool, done: bool, generation: int }
pure val initial: EmailAction = { kind: NoEmailAction, tokenValid: false, boundActor: 0, signedIn: 0, accountChanged: false, done: false, generation: 0 }
pure val emailActionLifetimeMs = 1800000
pure def restorable(ageMs: int): bool = ageMs >= 0 and ageMs < emailActionLifetimeMs
pure def canCapture(a: EmailAction, kind: EmailKind): bool = kind != NoEmailAction
pure def capture(a: EmailAction, kind: EmailKind, tokenValid: bool): EmailAction =
  { ...a, kind: kind, tokenValid: tokenValid, boundActor: 0, accountChanged: false, done: false, generation: a.generation + 1 }
pure def canCheckSession(a: EmailAction, actorId: int, requestGeneration: int): bool =
  a.kind == VerifyEmail and a.tokenValid and not(a.done) and actorId >= 0 and requestGeneration == a.generation
pure def checkSession(a: EmailAction, actorId: int, requestGeneration: int): EmailAction =
  if (actorId > 0 and a.boundActor > 0 and actorId != a.boundActor) { ...a, signedIn: actorId, accountChanged: true }
  else { ...a, signedIn: actorId, boundActor: if (actorId > 0) actorId else a.boundActor, accountChanged: false }
pure def accountChange(a: EmailAction): EmailAction =
  { ...a, signedIn: 0, accountChanged: false, generation: a.generation + 1 }
pure def mayApply(a: EmailAction): bool = a.kind != NoEmailAction and a.tokenValid and not(a.done) and
  (a.kind == VerifyEmail implies a.signedIn > 0 and a.signedIn == a.boundActor and not(a.accountChanged))
pure def canConfirmAction(a: EmailAction, requestGeneration: int): bool = mayApply(a) and requestGeneration == a.generation
pure def confirmAction(a: EmailAction, requestGeneration: int): EmailAction = { ...a, done: true }
pure def dismiss(a: EmailAction): EmailAction = { ...initial, generation: a.generation + 1 }
pure def alwaysAppliedOnlyForItsAccount(a: EmailAction): bool =
  (a.done implies a.kind != NoEmailAction and a.tokenValid) and
  ((a.done and a.kind == VerifyEmail) implies a.boundActor > 0) and
  (a.kind == NoEmailAction implies not(a.done) and a.boundActor == 0) and a.generation >= 0
pure def stepAppliedOnce(before: EmailAction, via: str, after: EmailAction): bool = via == "confirmAction" implies not(before.done)
pure def stepSignInKeepsTheToken(before: EmailAction, via: str, after: EmailAction): bool =
  (via == "checkSession" or via == "accountChange") implies after.kind == before.kind and after.tokenValid == before.tokenValid
pure def stepBindingIsKept(before: EmailAction, via: str, after: EmailAction): bool =
  (via != "capture" and via != "dismiss" and before.boundActor > 0) implies after.boundActor == before.boundActor
pure def lawStaleActionIsNotRestored(ageMs: int): bool = ageMs >= emailActionLifetimeMs implies not(restorable(ageMs))
pure def sometimesVerifiedAfterSignIn(a: EmailAction): bool = a.done and a.kind == VerifyEmail and a.generation > 1
pure def sometimesAccountChangeRefused(a: EmailAction): bool = a.accountChanged
pure def sometimesUnsubscribedSignedOut(a: EmailAction): bool = a.done and a.kind == UnsubscribeEmail and a.signedIn == 0
pure val actorIdValues = Set(0, 1, 2)
pure val requestGenerationValues = Set(0, 1, 2, 3)
pure val ageMsValues = Set(-1, 0, 1799999, 1800000)
```
