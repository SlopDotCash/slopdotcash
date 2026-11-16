module security__enforcement { // # Project restrictions and reinstatement

// PRD section 8 binds restrictions to the immutable project and repositories.
// Current GitHub authority and fresh evidence are adapter-verified inputs.

// ## Story: Pause unsafe work while retaining history and obligations

// ### Clearance and restrictions are independent dimensions

// ```quint
type Restriction = Available | AdmissionPaused | FlagPaused | Quarantined | ConfirmedBan
type ContributorFlag = { receipt: int, actor: int, filedDay: int }
type Enforcement = { restriction: Restriction, appealOpen: bool, bannedAccounts: Set[int], retired: bool, exemptionEvents: List[str], required: Set[int], clean: Set[int], flags: List[ContributorFlag], withdrawn: Set[int], clockDay: int, scanEpoch: int, restrictionEpoch: int, notice: bool, original: Set[int], frozenExemptions: Set[int], ownerExemptions: Set[int], revokedExemptions: Set[int] }
pure val initial: Enforcement = { restriction: Available, appealOpen: false, bannedAccounts: Set(), retired: false, exemptionEvents: List(), required: Set(1), clean: Set(), flags: List(), withdrawn: Set(), clockDay: 0, scanEpoch: 0, restrictionEpoch: 0, notice: false, original: Set(1), frozenExemptions: Set(), ownerExemptions: Set(), revokedExemptions: Set() }
pure def activeFlag(e: Enforcement, f: ContributorFlag): bool = not(e.withdrawn.contains(f.receipt)) and e.clockDay - f.filedDay < 90
pure def flagCount(e: Enforcement): int = e.flags.foldl(0, (count, f) => count + (if (activeFlag(e, f)) 1 else 0))
pure def cleared(e: Enforcement): bool = e.required.subseteq(e.clean.union(e.frozenExemptions).union(e.ownerExemptions.exclude(e.revokedExemptions)))
pure def mayContribute(e: Enforcement): bool = not(e.retired) and e.restriction == Available and cleared(e)
pure def canRecordClean(e: Enforcement, repository: int, startedEpoch: int): bool = e.required.contains(repository) and not(e.retired) and startedEpoch == e.restrictionEpoch
pure def recordClean(e: Enforcement, repository: int, startedEpoch: int): Enforcement = { ...e, clean: e.clean.union(Set(repository)), scanEpoch: e.restrictionEpoch, restriction: if (e.restriction == AdmissionPaused and e.required.subseteq(e.clean.union(Set(repository)).union(e.frozenExemptions).union(e.ownerExemptions.exclude(e.revokedExemptions)))) Available else e.restriction }
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
// counting while retaining its history. The pause immediately prevents skill publication and collection.

// ```quint
pure def eligibleFlag(member: bool, ageDays: int, acceptedContribution: bool, ownProject: bool): bool = member and ageDays >= 30 and acceptedContribution and not(ownProject)
pure def canFlag(e: Enforcement, actor: int, receipt: int, eligible: bool): bool = eligible and actor > 0 and receipt > 0 and not(e.flags.foldl(false, (std_some_0, f) => std_some_0 or ( f.receipt == receipt or (f.actor == actor and activeFlag(e, f))))) and not(e.retired) and (e.restriction == Available or e.restriction == AdmissionPaused or e.restriction == FlagPaused)
pure def flag(e: Enforcement, actor: int, receipt: int, eligible: bool): Enforcement = {
  ...e,
  flags: e.flags.append({ receipt: receipt, actor: actor, filedDay: e.clockDay }),
  restriction: if (flagCount(e) >= 1) FlagPaused else e.restriction,
  clean: if (flagCount(e) >= 1) Set() else e.clean,
  restrictionEpoch: if (flagCount(e) >= 1) e.restrictionEpoch + 1 else e.restrictionEpoch
}
pure def canWithdrawFlag(e: Enforcement, by: int, receipt: int): bool = e.flags.foldl(false, (std_some_1, f) => std_some_1 or ( f.actor == by and f.receipt == receipt)) and not(e.withdrawn.contains(receipt))
pure def withdrawFlag(e: Enforcement, by: int, receipt: int): Enforcement = { ...e, withdrawn: e.withdrawn.union(Set(receipt)) }
pure def canAdvanceDay(e: Enforcement, day: int): bool = day >= e.clockDay
pure def advanceDay(e: Enforcement, day: int): Enforcement = { ...e, clockDay: day }
pure val dayValues = Set(0, 30, 89, 90, 91)
pure def alwaysFlagTimes(e: Enforcement): bool = e.flags.foldl(true, (std_every_2, f) => std_every_2 and ( f.filedDay <= e.clockDay))
pure def alwaysFlagPause(e: Enforcement): bool = flagCount(e) >= 2 implies e.restriction != Available
// ```

// ### Fresh clean scans resolve flag-only pauses while humans decide confirmed malice

// ```quint
pure def canReinstateFlags(e: Enforcement): bool = e.restriction == FlagPaused and e.required.subseteq(e.clean) and e.scanEpoch == e.restrictionEpoch
pure def reinstateFlags(e: Enforcement): Enforcement = { ...e, restriction: Available, withdrawn: e.flags.foldl(e.withdrawn, (receipts, f) => receipts.union(Set(f.receipt))) }
pure def canConfirmMalice(e: Enforcement, moderator: bool, evidence: bool): bool = moderator and evidence and not(e.retired)
pure def confirmMalice(e: Enforcement, moderator: bool, evidence: bool): Enforcement = { ...e, restriction: ConfirmedBan, restrictionEpoch: e.restrictionEpoch + 1, clean: Set(), notice: true, appealOpen: false }
pure def canReinstateBan(e: Enforcement, moderator: bool, independent: bool): bool = moderator and independent and e.appealOpen and e.restriction == ConfirmedBan and e.required.subseteq(e.clean) and e.scanEpoch == e.restrictionEpoch
pure def reinstateBan(e: Enforcement, moderator: bool, independent: bool): Enforcement = { ...e, restriction: Available, appealOpen: false, withdrawn: e.flags.foldl(e.withdrawn, (receipts, f) => receipts.union(Set(f.receipt))) }
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
pure def releaseQuarantine(e: Enforcement, moderator: bool, independent: bool): Enforcement = { ...e, restriction: Available, appealOpen: false, withdrawn: e.flags.foldl(e.withdrawn, (receipts, f) => receipts.union(Set(f.receipt))) }
pure def canBanAccount(e: Enforcement, actor: int, moderator: bool, individualEvidence: bool): bool = actor > 0 and moderator and individualEvidence and not(e.bannedAccounts.contains(actor))
pure def banAccount(e: Enforcement, actor: int, moderator: bool, individualEvidence: bool): Enforcement = { ...e, bannedAccounts: e.bannedAccounts.union(Set(actor)) }
pure def canReinstateAccount(e: Enforcement, actor: int, moderator: bool, independent: bool): bool = e.bannedAccounts.contains(actor) and moderator and independent
pure def reinstateAccount(e: Enforcement, actor: int, moderator: bool, independent: bool): Enforcement = { ...e, bannedAccounts: e.bannedAccounts.exclude(Set(actor)) }
pure def canRetire(e: Enforcement, currentOwner: bool): bool = currentOwner and not(e.retired)
pure def retire(e: Enforcement, currentOwner: bool): Enforcement = { ...e, retired: true }
pure def alwaysRestrictionsBlockWork(e: Enforcement): bool = (e.retired or e.restriction != Available) implies not(mayContribute(e))
pure def stepRetainsExemptionHistory(before: Enforcement, after: Enforcement): bool = after.exemptionEvents.length() >= before.exemptionEvents.length()
pure def alwaysFrozenOriginalOnly(e: Enforcement): bool = e.frozenExemptions.subseteq(e.original)
pure def stepProjectRecoveryPreservesAccountBans(before: Enforcement, via: str, after: Enforcement): bool = (via == "reinstateFlags" or via == "reinstateBan" or via == "releaseQuarantine") implies before.bannedAccounts.subseteq(after.bannedAccounts)
pure def sometimesQuarantineRecovered(e: Enforcement): bool = e.restriction == Available and e.restrictionEpoch > 0 and not(e.appealOpen)
pure def sometimesAppendedPaused(e: Enforcement): bool = e.restriction == AdmissionPaused
pure def sometimesRetired(e: Enforcement): bool = e.retired
pure def sometimesReinstated(e: Enforcement): bool = e.restriction == Available and e.notice and flagCount(e) == 0
pure def sometimesPaused(e: Enforcement): bool = e.restriction == FlagPaused
pure def sometimesExempt(e: Enforcement): bool = e.ownerExemptions.exclude(e.revokedExemptions).size() > 0
// ```

// Every restriction preserves registry rows, Points, cases and funded obligations.
// Append-repository setup and all-repository activation are modeled by the project
// registry specification. Collection never reads a paused or retired project.

// ### Simulation samples exercise missing, matching and conflicting evidence

// These input sets bound simulation only. The generated guards accept every
// value allowed by their declared types and product rules.

// ```quint
pure val actorValues = Set(0, 1, 2)
pure val ageDaysValues = Set(0, 1, 2)
pure val byValues = Set(0, 1, 2)
pure val receiptValues = Set(0, 1, 2)
pure val repositoryValues = Set(0, 1, 2)
pure val viaValues = Set("", "a", "b")
// ```

}
