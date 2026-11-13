# Participation restrictions and retained rights

PRD sections 2, 7, 8 and 9. A project investigation identifies responsible
accounts individually. Current ownership or original application authorship
cannot establish responsibility. Human moderators decide confirmed-malicious
participation restrictions. Project reinstatement leaves account decisions
independent.

## Story: Restrict new participation while preserving funded awards and appeals

### An account restriction records its human decision independently of project state

The moderator input comes from the authenticated current-role service. Evidence
identity binds the decision to the affected account. Neither a model verdict
nor a closed pull request supplies this authority.

```quint
type Participation = Allowed | Banned
type RestrictionDecision = { decisionId: int, evidenceId: int, banned: bool }
type Access = { actor: int, participation: Participation, decisions: List[RestrictionDecision], appeal: bool, appealDecision: int, fundedAwards: int, originalFundedAwards: int }
pure val initial: Access = { actor: 1, participation: Allowed, decisions: List(), appeal: false, appealDecision: 0, fundedAwards: 1, originalFundedAwards: 1 }
pure def canBan(a: Access, actorId: int, decisionId: int, evidenceId: int, moderator: bool): bool =
  actorId == a.actor and moderator and evidenceId > 0 and decisionId > 0 and a.participation == Allowed and
  not(a.decisions.some(d => d.decisionId == decisionId))
pure def ban(a: Access, actorId: int, decisionId: int, evidenceId: int, moderator: bool): Access =
  { ...a, participation: Banned, decisions: a.decisions.append({ decisionId: decisionId, evidenceId: evidenceId, banned: true }) }
pure def canAppeal(a: Access, by: int): bool = by == a.actor and a.participation == Banned and not(a.appeal)
pure def appeal(a: Access, by: int): Access = { ...a, appeal: true }
pure def canDecideAppeal(a: Access, decisionId: int, evidenceId: int, moderator: bool): bool =
  a.appeal and moderator and decisionId > 0 and evidenceId > 0 and not(a.decisions.some(d => d.decisionId == decisionId))
pure def decideAppeal(a: Access, decisionId: int, evidenceId: int, moderator: bool, uphold: bool): Access =
  { ...a, appeal: false, appealDecision: decisionId, participation: if (uphold) Banned else Allowed,
    decisions: a.decisions.append({ decisionId: decisionId, evidenceId: evidenceId, banned: uphold }) }
```

### A ban blocks new credit and commitments while existing funded rights remain

```quint
pure def newParticipationAllowed(a: Access): bool = a.participation == Allowed
pure def fundedPaymentAllowed(a: Access): bool = a.fundedAwards > 0
pure def appealAccessAllowed(a: Access): bool = true
pure def alwaysFundsPreserved(a: Access): bool = a.fundedAwards == a.originalFundedAwards and a.fundedAwards >= 0
pure def alwaysDecisionsIdentified(a: Access): bool = a.decisions.every(d => d.decisionId > 0 and d.evidenceId > 0)
pure def alwaysBanBlocksNewWork(a: Access): bool = a.participation == Banned implies not(newParticipationAllowed(a))
pure def stepHistoryRetained(before: Access, after: Access): bool = after.decisions.length() >= before.decisions.length()
pure def sometimesBannedWithFunding(a: Access): bool = a.participation == Banned and fundedPaymentAllowed(a)
pure def sometimesAppealOpen(a: Access): bool = a.appeal
pure def sometimesReinstated(a: Access): bool = a.participation == Allowed and a.appealDecision > 0
pure val actorIdValues = Set(1, 2)
pure val byValues = Set(1, 2)
pure val decisionIdValues = Set(1, 2, 3)
pure val evidenceIdValues = Set(1, 2)
```
