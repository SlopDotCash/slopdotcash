module slopbot__appeals { // # Appeals and penalty correction

// PRD sections 5, 7 and 9 require Slopbot triage followed by human moderation
// for escalated decisions. A correction appends history and preserves funded
// awards. This specification covers one immutable debit and its appeal.

// ## Story: Appeal a decision and preserve the complete decision journal

// ### An appeal records triage, escalation and resolution separately

// ```quint
type AppealPhase = NotAppealed | BotTriage | Proposed | Escalated | Resolved
type Resolution = NoResolution | Upheld | Reversed
type Appeal = { phase: AppealPhase, resolution: Resolution, debit: int, reversal: int, privateCase: bool, ban: bool, confirmedMalice: bool, daysOpen: int, confidenceHundredths: int, rejectedProposal: bool, appendCount: int, published: bool }
pure val initial: Appeal = { phase: NotAppealed, resolution: NoResolution, debit: 0, reversal: 0, privateCase: false, ban: false, confirmedMalice: false, daysOpen: 0, confidenceHundredths: 100, rejectedProposal: false, appendCount: 0, published: false }
pure def canOpen(a: Appeal, debit: int): bool = a.phase == NotAppealed and debit >= 0
pure def open(a: Appeal, debit: int, privateCase: bool, ban: bool, confirmedMalice: bool): Appeal = { ...a, phase: BotTriage, debit: debit, privateCase: privateCase, ban: ban, confirmedMalice: confirmedMalice, appendCount: a.appendCount + 1 }
pure val debitValues = Set(0, 10, 240, 750)
// ```

// ### High stakes, low confidence, rejection or seven days require escalation

// ```quint
pure def mustEscalate(a: Appeal): bool = a.privateCase or a.ban or a.confirmedMalice or a.debit >= 240 or a.confidenceHundredths < 90 or a.rejectedProposal or a.daysOpen >= 7
pure def canPropose(a: Appeal, confidenceHundredths: int): bool = a.phase == BotTriage and confidenceHundredths >= 0 and confidenceHundredths <= 100
pure def propose(a: Appeal, confidenceHundredths: int): Appeal = { ...a, phase: Proposed, confidenceHundredths: confidenceHundredths }
pure val confidenceHundredthsValues = Set(50, 89, 90, 100)
pure def canRejectProposal(a: Appeal): bool = a.phase == Proposed
pure def rejectProposal(a: Appeal): Appeal = { ...a, rejectedProposal: true }
pure def canAge(a: Appeal, days: int): bool = a.phase != NotAppealed and a.phase != Resolved and days >= a.daysOpen
pure def age(a: Appeal, days: int): Appeal = { ...a, daysOpen: days }
pure val daysValues = Set(0, 6, 7, 8)
pure def canEscalate(a: Appeal): bool = (a.phase == Proposed or a.phase == BotTriage) and mustEscalate(a)
pure def escalate(a: Appeal): Appeal = { ...a, phase: Escalated, appendCount: a.appendCount + 1 }
// ```

// ### Only a moderator resolves an escalated appeal

// The `moderator` fact is checked against the current immutable GitHub actor
// allowlist. A case party cannot derive moderator authority from its case role.
// An accepted bot proposal can resolve only a non-escalated ordinary appeal.

// ```quint
pure def canResolve(a: Appeal, moderator: bool, acceptedProposal: bool, resolution: Resolution): bool = resolution != NoResolution and (if (a.phase == Escalated) moderator else a.phase == Proposed and not(mustEscalate(a)) and acceptedProposal)
pure def resolve(a: Appeal, moderator: bool, acceptedProposal: bool, resolution: Resolution): Appeal = { ...a, phase: Resolved, resolution: resolution, reversal: if (resolution == Reversed) a.debit else 0, appendCount: a.appendCount + 1 }
pure def canPublish(a: Appeal): bool = a.phase == Resolved and not(a.published)
pure def publish(a: Appeal): Appeal = { ...a, published: true }
pure def canReplay(a: Appeal): bool = a.phase == Resolved
pure def replay(a: Appeal): Appeal = a
pure def alwaysReversalBound(a: Appeal): bool = a.reversal >= 0 and a.reversal <= a.debit and (a.resolution == Reversed implies a.reversal == a.debit)
pure def alwaysUnresolvedHasNoReversal(a: Appeal): bool = a.phase != Resolved implies a.resolution == NoResolution and a.reversal == 0
pure def alwaysResolvedBeforePublication(a: Appeal): bool = a.published implies a.phase == Resolved
pure def stepAppendOnly(before: Appeal, after: Appeal): bool = after.appendCount >= before.appendCount
pure def sometimesEscalated(a: Appeal): bool = a.phase == Escalated
pure def sometimesReversed(a: Appeal): bool = a.phase == Resolved and a.resolution == Reversed
// ```

// Discovered by the proof. An unresolved appeal has no reversal record. Opening
// an appeal cannot retain a reversal from an impossible pre-appeal state.

// The penalty table and effective dates stay in the Points domain. No outcome
// here transfers money, reduces a funded obligation or erases the source record.
// A verified maintainer reopening remains a separate GitHub decision. It restores
// protected eligibility according to the retained source evidence.

}
