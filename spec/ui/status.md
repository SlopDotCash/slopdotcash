# Status presentation

Every state the interface shows a person maps to one presentation: a tone, an
icon and a word. The tone is a color role of the design system; the icon and
the word carry the same meaning for a person who cannot tell the colors apart,
and the word is the accessible name. The owning specs decide the state; this
library only decides how it looks.

## Story: Read a state without relying on color

### A presentation is a tone, an icon and a word

The tone is a role of [the design system](../designSystem/). `Emphasis` marks
the one thing that is current or selected and is never a status. `Negative` is
reserved for refusals and failures.

```quint
import designSystem.* from "../designSystem"
type Icon = Check | Clock | Wallet | Send | Pause | Alert | Ban | Spinner | Lock | Eye | Dot | Slash | Refresh
type Presentation = { tone: Tone, icon: Icon, label: str }
pure def shown(tone: Tone, icon: Icon, label: str): Presentation = { tone: tone, icon: icon, label: label }
pure def distinguishable(a: Presentation, b: Presentation): bool =
  a.label != b.label and (a.tone != b.tone or a.icon != b.icon)
```

### Payment states keep award, funding and settlement apart

Only finalized exact settlement is shown as paid. Held, submitted and
scheduled payments keep their obligation and say so.

```quint
import projections as P from "../frontend/projections"
pure def paymentPresentation(payment: P::PaymentDisplay): Presentation =
  if (payment == P::PaymentUnavailable) shown(Neutral, Slash, "Unavailable")
  else if (payment == P::PaymentUnderfunded) shown(Caution, Wallet, "Underfunded")
  else if (payment == P::AwaitingWallet) shown(Notice, Wallet, "Needs wallet")
  else if (payment == P::ReadyToPay) shown(Neutral, Clock, "Queued")
  else if (payment == P::ScheduledPayment) shown(Notice, Clock, "Scheduled")
  else if (payment == P::HeldPayment) shown(Caution, Pause, "Held")
  else if (payment == P::SubmittedPayment) shown(Notice, Send, "Submitted")
  else shown(Positive, Check, "Paid")
pure def awardPresentation(decision: P::AwardDecision): Presentation =
  if (decision == P::Projected) shown(Neutral, Dot, "Projected")
  else if (decision == P::UnderReview) shown(Notice, Eye, "Under review")
  else if (decision == P::ApprovedAward) shown(Positive, Check, "Approved")
  else shown(Neutral, Ban, "Excluded")
pure def fundingPresentation(funding: P::FundingObservation): Presentation =
  if (funding == P::FundingUnavailable) shown(Neutral, Slash, "Unavailable")
  else if (funding == P::Underfunded) shown(Caution, Wallet, "Underfunded")
  else shown(Positive, Check, "Funded")
pure val paymentStates = List(P::PaymentUnavailable, P::PaymentUnderfunded, P::AwaitingWallet, P::ReadyToPay,
  P::ScheduledPayment, P::HeldPayment, P::SubmittedPayment, P::PaidPayment)
pure def lawOnlyPaidLooksSettled(payment: P::PaymentDisplay): bool =
  paymentPresentation(payment).tone == Positive iff payment == P::PaidPayment
pure def lawPaymentStatesAreDistinguishable(a: P::PaymentDisplay, b: P::PaymentDisplay): bool =
  a != b implies distinguishable(paymentPresentation(a), paymentPresentation(b))
pure def lawAwardStatesAreDistinguishable(a: P::AwardDecision, b: P::AwardDecision): bool =
  a != b implies distinguishable(awardPresentation(a), awardPresentation(b))
pure def lawFundingStatesAreDistinguishable(a: P::FundingObservation, b: P::FundingObservation): bool =
  a != b implies distinguishable(fundingPresentation(a), fundingPresentation(b))
```

### Read states show loading, emptiness, staleness and failure differently

Loading and stale reads are announced politely; denied, invalid, unavailable
and failed reads interrupt. A stale read keeps its retained rows beside the
notice, and only a failure that can be retried offers Retry.

```quint
import requests as R from "../frontend/requests"
type Announcement = Silent | Polite | Assertive
pure def readPresentation(status: R::ReadStatus): Presentation =
  if (status == R::Idle) shown(Neutral, Dot, "Not loaded")
  else if (status == R::Loading) shown(Neutral, Spinner, "Loading")
  else if (status == R::Current) shown(Neutral, Check, "Current")
  else if (status == R::Empty) shown(Neutral, Slash, "Nothing yet")
  else if (status == R::Stale) shown(Caution, Clock, "May be outdated")
  else if (status == R::Denied) shown(Negative, Lock, "Not allowed")
  else if (status == R::Invalid) shown(Negative, Alert, "Could not be read")
  else if (status == R::Unavailable) shown(Caution, Slash, "Unavailable")
  else if (status == R::Failed) shown(Negative, Refresh, "Could not load")
  else shown(Neutral, Ban, "Cancelled")
pure def readAnnouncement(status: R::ReadStatus): Announcement =
  if (status == R::Loading or status == R::Stale or status == R::Empty or status == R::Cancelled) Polite
  else if (status == R::Idle or status == R::Current) Silent
  else Assertive
pure def readOffersRetry(status: R::ReadStatus): bool =
  status == R::Stale or status == R::Unavailable or status == R::Failed or status == R::Cancelled
pure def readShowsRows(status: R::ReadStatus): bool = status == R::Current or status == R::Stale
pure def lawReadStatesAreDistinguishable(a: R::ReadStatus, b: R::ReadStatus): bool =
  a != b implies distinguishable(readPresentation(a), readPresentation(b))
pure def lawFailuresInterrupt(status: R::ReadStatus): bool =
  readPresentation(status).tone == Negative implies readAnnouncement(status) == Assertive
pure def lawOnlyCurrentAndStaleShowRows(status: R::ReadStatus): bool =
  readShowsRows(status) implies (status == R::Current or status == R::Stale)
pure def lawDeniedNeverRetries(status: R::ReadStatus): bool =
  status == R::Denied implies not(readOffersRetry(status))
```

### Setup checks never look ready unless they are

```quint
import presentation as S from "../frontend/presentation"
pure def setupPresentation(status: S::SetupStatus): Presentation =
  if (status == S::SetupMissing) shown(Neutral, Dot, "Missing")
  else if (status == S::SetupChecking) shown(Neutral, Spinner, "Checking")
  else if (status == S::SetupReady) shown(Positive, Check, "Ready")
  else if (status == S::SetupRefused) shown(Negative, Ban, "Refused")
  else shown(Caution, Slash, "Unavailable")
pure def lawOnlyReadyLooksReady(status: S::SetupStatus): bool =
  setupPresentation(status).tone == Positive iff status == S::SetupReady
pure def lawSetupStatesAreDistinguishable(a: S::SetupStatus, b: S::SetupStatus): bool =
  a != b implies distinguishable(setupPresentation(a), setupPresentation(b))
```
