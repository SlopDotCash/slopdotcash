module security__enforcement { // # Project restrictions and reinstatement

// PRD section 8 binds restrictions to the immutable project and repositories.
// Current GitHub authority and fresh evidence are adapter-verified inputs.

// ## Story: Pause unsafe work while retaining history and obligations

// ### Clearance and restrictions are independent dimensions

// ```quint
type Restriction = Available | AdmissionPaused | FlagPaused | Quarantined | ConfirmedBan
type ContributorFlag = { receipt: int, actor: int, filedDay: int }
type Enforcement = { restriction: Restriction, appealOpen: bool, retired: bool, exemptionEvents: List[str], required: Set[int], clean: Set[int], flags: List[ContributorFlag], resolvedFlags: List[ContributorFlag], withdrawn: Set[int], clockDay: int, scanEpoch: int, restrictionEpoch: int, notice: bool, original: Set[int], frozenExemptions: Set[int], ownerExemptions: Set[int], revokedExemptions: Set[int] }
pure val initial: Enforcement = { restriction: Available, appealOpen: false, retired: false, exemptionEvents: List(), required: Set(1), clean: Set(), flags: List(), resolvedFlags: List(), withdrawn: Set(), clockDay: 0, scanEpoch: 0, restrictionEpoch: 0, notice: false, original: Set(1), frozenExemptions: Set(), ownerExemptions: Set(), revokedExemptions: Set() }
pure def activeFlag(e: Enforcement, f: ContributorFlag): bool = not(e.withdrawn.contains(f.receipt)) and not(e.resolvedFlags.foldl(false, (std_includes_0, std_x_0) => std_includes_0 or std_x_0 == (f))) and e.clockDay - f.filedDay < 90
pure def flagCount(e: Enforcement): int = e.flags.foldl(0, (count, f) => count + (if (activeFlag(e, f)) 1 else 0))
pure def twoActiveFlaggers(e: Enforcement): bool = e.flags.foldl(false, (std_some_2, first) => std_some_2 or ( activeFlag(e, first) and e.flags.foldl(false, (std_some_1, second) => std_some_1 or ( activeFlag(e, second) and first.actor != second.actor))))
pure def cleared(e: Enforcement): bool = e.required.forall(id => e.clean.contains(id) or e.frozenExemptions.contains(id) or (e.ownerExemptions.contains(id) and not(e.revokedExemptions.contains(id))))
pure def mayContribute(e: Enforcement): bool = not(e.retired) and e.restriction == Available and cleared(e)
pure def canRecordClean(e: Enforcement, repository: int, startedEpoch: int): bool = e.required.contains(repository) and not(e.retired) and startedEpoch == e.restrictionEpoch
pure def recordClean(e: Enforcement, repository: int, startedEpoch: int): Enforcement = { ...e, clean: e.clean.union(Set(repository)), scanEpoch: e.restrictionEpoch, restriction: if (e.restriction == AdmissionPaused and e.required.forall(id => id == repository or e.clean.contains(id) or e.frozenExemptions.contains(id) or (e.ownerExemptions.contains(id) and not(e.revokedExemptions.contains(id))))) Available else e.restriction }
pure val startedEpochValues = Set(0, 1, 2, 3)
pure def canAppendRepository(e: Enforcement, repository: int): bool = mayContribute(e) and repository > 0 and not(e.required.contains(repository))
pure def appendRepository(e: Enforcement, repository: int): Enforcement = { ...e, required: e.required.union(Set(repository)), restriction: AdmissionPaused }
pure def canCheckSetup(e: Enforcement): bool = e.restriction == AdmissionPaused and cleared(e)
pure def checkSetup(e: Enforcement): Enforcement = { ...e, restriction: Available }
// ```

// ### Two distinct eligible contributors pause the project

// The eligibility input verifies membership, contribution eligibility and absence
// of disqualifying self or maintainer identity. Repeated live flags by one actor count
// once. An account must be at least 30 days old and have one accepted Slop
// contribution. Each flag counts for 90 days. Withdrawal stops that receipt
// counting while retaining its history. Scan reinstatement records resolved flags
// separately from voluntary withdrawals. The pause immediately prevents skill publication and collection.

// Discovered by the proof. An admission pause cannot mask a two-contributor
// flag pause, so completing admission cannot reactivate a flagged project.

// ```quint
pure def eligibleFlag(member: bool, ageDays: int, acceptedContribution: bool, ownProject: bool): bool = member and ageDays >= 30 and acceptedContribution and not(ownProject)
pure def canFlag(e: Enforcement, actor: int, receipt: int, eligible: bool): bool = eligible and actor > 0 and receipt > 0 and not(e.flags.foldl(false, (std_some_3, f) => std_some_3 or ( f.receipt == receipt or (f.actor == actor and activeFlag(e, f))))) and not(e.retired) and (e.restriction == Available or e.restriction == AdmissionPaused or e.restriction == FlagPaused)
pure def flag(e: Enforcement, actor: int, receipt: int, eligible: bool): Enforcement = {
  ...e,
  flags: e.flags.append({ receipt: receipt, actor: actor, filedDay: e.clockDay }),
  restriction: if (e.flags.foldl(false, (std_some_4, f) => std_some_4 or ( activeFlag(e, f)))) FlagPaused else e.restriction,
  notice: e.notice or e.flags.foldl(false, (std_some_5, f) => std_some_5 or ( activeFlag(e, f))),
  clean: if (e.flags.foldl(false, (std_some_6, f) => std_some_6 or ( activeFlag(e, f)))) Set() else e.clean,
  restrictionEpoch: if (e.flags.foldl(false, (std_some_7, f) => std_some_7 or ( activeFlag(e, f)))) e.restrictionEpoch + 1 else e.restrictionEpoch
}
pure def canWithdrawFlag(e: Enforcement, by: int, receipt: int): bool = e.flags.foldl(false, (std_some_8, f) => std_some_8 or ( f.actor == by and f.receipt == receipt)) and not(e.withdrawn.contains(receipt))
pure def withdrawFlag(e: Enforcement, by: int, receipt: int): Enforcement = { ...e, withdrawn: e.withdrawn.union(Set(receipt)) }
pure def canAdvanceDay(e: Enforcement, day: int): bool = day >= e.clockDay
pure def advanceDay(e: Enforcement, day: int): Enforcement = { ...e, clockDay: day }
pure val dayValues = Set(0, 30, 89, 90, 91)
pure def alwaysFlagTimes(e: Enforcement): bool = e.flags.foldl(true, (std_every_9, f) => std_every_9 and ( f.filedDay <= e.clockDay))
pure def alwaysFlagPause(e: Enforcement): bool = twoActiveFlaggers(e) implies e.restriction != Available and e.restriction != AdmissionPaused
pure def alwaysFlagNotice(e: Enforcement): bool = twoActiveFlaggers(e) implies e.notice
pure def alwaysActiveActorsUnique(e: Enforcement): bool = e.flags.foldl(true, (std_every_11, first) => std_every_11 and ( e.flags.foldl(true, (std_every_10, second) => std_every_10 and ( (activeFlag(e, first) and activeFlag(e, second) and first.actor == second.actor) implies first.receipt == second.receipt))))
pure def alwaysResolvedHistory(e: Enforcement): bool = e.resolvedFlags.foldl(true, (std_every_13, f) => std_every_13 and ( e.flags.foldl(false, (std_includes_12, std_x_12) => std_includes_12 or std_x_12 == (f))))
// ```

// ### Fresh clean scans resolve flag-only pauses while humans decide confirmed malice

// ```quint
pure def canReinstateFlags(e: Enforcement): bool = e.restriction == FlagPaused and e.required.subseteq(e.clean) and e.scanEpoch == e.restrictionEpoch
pure def reinstateFlags(e: Enforcement): Enforcement = { ...e, restriction: Available, resolvedFlags: e.flags }
pure def canConfirmMalice(e: Enforcement, moderator: bool, evidence: bool): bool = moderator and evidence and not(e.retired)
pure def confirmMalice(e: Enforcement, moderator: bool, evidence: bool): Enforcement = { ...e, restriction: ConfirmedBan, restrictionEpoch: e.restrictionEpoch + 1, clean: Set(), notice: true, appealOpen: false }
pure def canReinstateBan(e: Enforcement, moderator: bool, independent: bool): bool = moderator and independent and e.appealOpen and e.restriction == ConfirmedBan and e.required.subseteq(e.clean) and e.scanEpoch == e.restrictionEpoch
pure def reinstateBan(e: Enforcement, moderator: bool, independent: bool): Enforcement = { ...e, restriction: Available, appealOpen: false, resolvedFlags: e.flags }
pure def alwaysBanNotice(e: Enforcement): bool = e.restriction == ConfirmedBan implies e.notice
// ```

// ### Exemptions retain explicit identity and revocation

// The permanent migration-0075 set is loaded from retained migration identity.
// The boolean input here is an authenticated membership result. It cannot add
// projects or newly appended repositories to that frozen set. An owner-approved
// exemption requires the separately recorded human decision for its bound revision,
// repository and steward. It remains distinct from a clean scan.

// ```quint
pure def canRecognizeFrozen(e: Enforcement, repository: int, frozenMember: bool): bool = frozenMember and e.original.contains(repository) and not(e.retired) and e.restriction == Available
pure def recognizeFrozen(e: Enforcement, repository: int, frozenMember: bool): Enforcement = { ...e, frozenExemptions: e.frozenExemptions.union(Set(repository)) }
pure def canGrantOwnerExemption(e: Enforcement, repository: int, ownerDecision: bool, exactBinding: bool): bool = ownerDecision and exactBinding and e.required.contains(repository) and (not(e.ownerExemptions.contains(repository)) or e.revokedExemptions.contains(repository)) and not(e.retired) and (e.restriction == Available or e.restriction == AdmissionPaused)
pure def grantOwnerExemption(e: Enforcement, repository: int, ownerDecision: bool, exactBinding: bool): Enforcement = { ...e, ownerExemptions: e.ownerExemptions.union(Set(repository)), revokedExemptions: e.revokedExemptions.exclude(Set(repository)), exemptionEvents: e.exemptionEvents.append("granted") }
pure def canRevokeExemption(e: Enforcement, repository: int, owner: bool): bool = owner and e.ownerExemptions.contains(repository) and not(e.revokedExemptions.contains(repository))
pure def revokeExemption(e: Enforcement, repository: int, owner: bool): Enforcement = { ...e, revokedExemptions: e.revokedExemptions.union(Set(repository)), exemptionEvents: e.exemptionEvents.append("revoked") }
pure def canQuarantine(e: Enforcement, administrator: bool): bool = administrator and not(e.retired) and (e.restriction == Available or e.restriction == AdmissionPaused or e.restriction == FlagPaused)
pure def quarantine(e: Enforcement, administrator: bool): Enforcement = { ...e, restriction: Quarantined, appealOpen: false, clean: Set(), restrictionEpoch: e.restrictionEpoch + 1 }
pure def canRequestAppeal(e: Enforcement, currentOwner: bool): bool = currentOwner and e.restriction != Available and e.restriction != AdmissionPaused and not(e.appealOpen)
pure def requestAppeal(e: Enforcement, currentOwner: bool): Enforcement = { ...e, appealOpen: true }
pure def canReleaseQuarantine(e: Enforcement, moderator: bool, independent: bool): bool = moderator and independent and e.appealOpen and e.restriction == Quarantined and e.required.subseteq(e.clean) and e.scanEpoch == e.restrictionEpoch
pure def releaseQuarantine(e: Enforcement, moderator: bool, independent: bool): Enforcement = { ...e, restriction: Available, appealOpen: false, resolvedFlags: e.flags }
pure def canRetire(e: Enforcement, currentOwner: bool): bool = currentOwner and not(e.retired)
pure def retire(e: Enforcement, currentOwner: bool): Enforcement = { ...e, retired: true }
pure def alwaysRestrictionsBlockWork(e: Enforcement): bool = (e.retired or e.restriction != Available) implies not(mayContribute(e))
pure def stepRetainsExemptionHistory(before: Enforcement, after: Enforcement): bool = after.exemptionEvents.length() >= before.exemptionEvents.length()
pure def alwaysFrozenOriginalOnly(e: Enforcement): bool = e.frozenExemptions.subseteq(e.original)
pure def sometimesQuarantineRecovered(e: Enforcement): bool = e.restriction == Available and e.restrictionEpoch > 0 and not(e.appealOpen)
pure def sometimesAppendedPaused(e: Enforcement): bool = e.restriction == AdmissionPaused
pure def sometimesRetired(e: Enforcement): bool = e.retired
pure def sometimesReinstated(e: Enforcement): bool = e.restriction == Available and e.notice and not(e.flags.foldl(false, (std_some_14, f) => std_some_14 or ( activeFlag(e, f))))
pure def sometimesPaused(e: Enforcement): bool = e.restriction == FlagPaused
pure def sometimesExempt(e: Enforcement): bool = e.ownerExemptions.exclude(e.revokedExemptions).size() > 0
// ```

// Every restriction preserves registry rows, Points, cases and funded obligations.
// Account bans belong to `spec/access.md`. Reinstating this project's enforcement
// state does not dispatch an account-reinstatement event. The retained moderator
// appeal and independent-review requirements come from `api_project_enforcement`
// at the pinned main source revision.
// Append-repository setup and all-repository activation are modeled by the project
// registry specification. Collection never reads a paused or retired project.

// ### Simulation samples exercise missing, matching and conflicting evidence

// These input sets bound simulation only. The generated guards accept every
// value allowed by their declared types and product rules.

// ```quint
pure val actorValues = Set(0, 1, 2)
pure val ageDaysValues = Set(-1, 29, 30, 31)
pure val byValues = Set(0, 1, 2)
pure val receiptValues = Set(0, 1, 2)
pure val repositoryValues = Set(0, 1, 2)
// ```

}
