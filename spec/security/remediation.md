# Private remediation, disclosure and recognition

PRD sections 8 and 10 require independent private patch review,
exact-revision tests, separate mitigation verification, exact-content
disclosure approval, embargo history and separate recognition consent
(`security_cases.remediation_state`, `disclosure_state` and `recognition`).
This machine holds one received [case](./cases.md) for its roles: the case's
verified authority snapshot and its triager membership decide who may act.
Source: Slop development `backend/security/handler.ts` (`remediation`,
`disclosure` and `recognition` actions).

## Story: Verify remediation and approve exact disclosure independently

### Remediation acts under the case's current roles

Role changes come from the case: a newer authority snapshot or a triager
revocation removes the power to act at once.

```quint
import money as M from "../settlement/money"
import terms as T from "./terms"
import cases as C from "./cases"
type Stage = NotStarted | Investigating | Fixing | Retest | Resolved | MitigationVerified | Reopened
type Disclosure = Embargoed | RedactionApproved | Disclosed
type Recognition = PrivateRecognition | OptIn
type Remediation = { privateCase: C::PrivateCase, stage: Stage, patchDigest: int, patchAuthor: int, verifiedPatch: int,
  patchReviewer: int, mitigatedDigest: int, verifiedPatches: List[int], disclosure: Disclosure, approvedDigest: int,
  publishedDigest: int, embargoHistory: List[int], recognition: Recognition, revision: int }
pure val receivedCase: C::PrivateCase = C::observeAuthority(C::receive(C::initial, C::SlopReceived, T::standardTerms, C::NewReceipt, M::zero, 1), C::staff)
pure val initial: Remediation = { privateCase: receivedCase, stage: NotStarted, patchDigest: 0, patchAuthor: 0, verifiedPatch: 0,
  patchReviewer: 0, mitigatedDigest: 0, verifiedPatches: List(), disclosure: Embargoed, approvedDigest: 0, publishedDigest: 0,
  embargoHistory: List(), recognition: PrivateRecognition, revision: 1 }
pure def canObserveAuthority(r: Remediation, snapshot: C::Authority): bool = C::canObserveAuthority(r.privateCase, snapshot)
pure def observeAuthority(r: Remediation, snapshot: C::Authority): Remediation = { ...r, privateCase: C::observeAuthority(r.privateCase, snapshot) }
pure def canAssignTriager(r: Remediation, by: int, checkedEpoch: int, actor: int): bool = C::canAssignTriager(r.privateCase, by, checkedEpoch, actor)
pure def assignTriager(r: Remediation, by: int, checkedEpoch: int, actor: int): Remediation = { ...r, privateCase: C::assignTriager(r.privateCase, by, checkedEpoch, actor) }
pure def canRevokeTriager(r: Remediation, by: int, checkedEpoch: int, actor: int): bool = C::canRevokeTriager(r.privateCase, by, checkedEpoch, actor)
pure def revokeTriager(r: Remediation, by: int, checkedEpoch: int, actor: int): Remediation = { ...r, privateCase: C::revokeTriager(r.privateCase, by, checkedEpoch, actor) }
```


### The exact patch is reviewed independently before it resolves, and mitigation is verified separately

A current technical approver or triager moves remediation. A recorded patch
digest names its author. Resolution requires exact-revision tests of that
digest by a different reviewer. Deployed mitigation is verified only after
resolution, at the same digest. Reopening keeps every earlier verified patch.

```quint
pure def remediator(r: Remediation, by: int, checkedEpoch: int): bool = by > 0
  and (C::technicalNow(r.privateCase, by, checkedEpoch) or C::triagerNow(r.privateCase, by, checkedEpoch))
pure def canProgressRemediation(r: Remediation, by: int, checkedEpoch: int, stage: Stage): bool = remediator(r, by, checkedEpoch)
  and (stage == Investigating or stage == Fixing) and r.stage != Resolved and r.stage != MitigationVerified
pure def progressRemediation(r: Remediation, by: int, checkedEpoch: int, stage: Stage): Remediation =
  { ...r, stage: stage, revision: r.revision + 1 }
pure def canRecordPatch(r: Remediation, by: int, checkedEpoch: int, digest: int): bool = remediator(r, by, checkedEpoch) and digest > 0
  and r.stage != Resolved and r.stage != MitigationVerified and not(r.verifiedPatches.includes(digest))
pure def recordPatch(r: Remediation, by: int, checkedEpoch: int, digest: int): Remediation =
  { ...r, stage: Retest, patchDigest: digest, patchAuthor: by, verifiedPatch: 0, patchReviewer: 0, mitigatedDigest: 0, revision: r.revision + 1 }
pure def canResolveRemediation(r: Remediation, by: int, checkedEpoch: int, testedDigest: int): bool = remediator(r, by, checkedEpoch)
  and r.stage == Retest and testedDigest == r.patchDigest and testedDigest > 0 and by != r.patchAuthor
pure def resolveRemediation(r: Remediation, by: int, checkedEpoch: int, testedDigest: int): Remediation =
  { ...r, stage: Resolved, verifiedPatch: testedDigest, patchReviewer: by, verifiedPatches: r.verifiedPatches.append(testedDigest), revision: r.revision + 1 }
pure def canVerifyMitigation(r: Remediation, by: int, checkedEpoch: int, deployedDigest: int): bool = remediator(r, by, checkedEpoch)
  and r.stage == Resolved and deployedDigest == r.verifiedPatch
pure def verifyMitigation(r: Remediation, by: int, checkedEpoch: int, deployedDigest: int): Remediation =
  { ...r, stage: MitigationVerified, mitigatedDigest: deployedDigest, revision: r.revision + 1 }
pure def canReopenRemediation(r: Remediation, by: int, checkedEpoch: int): bool = remediator(r, by, checkedEpoch)
  and (r.stage == Resolved or r.stage == MitigationVerified)
pure def reopenRemediation(r: Remediation, by: int, checkedEpoch: int): Remediation =
  { ...r, stage: Reopened, verifiedPatch: 0, patchReviewer: 0, mitigatedDigest: 0, revision: r.revision + 1 }
pure def alwaysResolvedPatchReviewed(r: Remediation): bool = (r.stage == Resolved or r.stage == MitigationVerified) implies
  r.verifiedPatch > 0 and r.verifiedPatch == r.patchDigest and r.patchReviewer != r.patchAuthor and r.patchReviewer > 0
  and r.verifiedPatches.includes(r.verifiedPatch)
pure def alwaysMitigationExact(r: Remediation): bool = (r.stage == MitigationVerified) == (r.mitigatedDigest > 0)
  and (r.mitigatedDigest > 0 implies r.mitigatedDigest == r.verifiedPatch)
pure def stepRevisionAdvances(before: Remediation, after: Remediation): bool = after.revision >= before.revision
pure def stepVerifiedPatchesRetained(before: Remediation, after: Remediation): bool = before.verifiedPatches.every(d => after.verifiedPatches.includes(d))
pure def sometimesMitigationVerified(r: Remediation): bool = r.stage == MitigationVerified
pure def sometimesReopened(r: Remediation): bool = r.stage == Reopened and r.verifiedPatches.length() > 0
```

### Only separately approved exact redacted content is disclosed, with embargo history

A current technical approver decides disclosure. Remediation, payment and an
elapsed deadline never authorize it. Approving redacted content binds its
exact digest. Recording disclosure needs the latest approval of the same
bytes; changed bytes need a new approval. An explicit embargo change is kept
in history. Recognition consent is the reporter's separate choice, which they
may change; public credit names the reporter only with opt-in.

```quint
pure def canDecideDisclosure(r: Remediation, by: int, checkedEpoch: int, target: Disclosure, digest: int, embargoChange: int): bool =
  C::technicalNow(r.privateCase, by, checkedEpoch) and r.disclosure != Disclosed and embargoChange >= 0
    and (if (target == Embargoed) digest == 0 else if (target == RedactionApproved) digest > 0
      else r.disclosure == RedactionApproved and digest == r.approvedDigest and digest > 0)
pure def decideDisclosure(r: Remediation, by: int, checkedEpoch: int, target: Disclosure, digest: int, embargoChange: int): Remediation =
  { ...r, disclosure: target, approvedDigest: if (target == Embargoed) 0 else if (target == RedactionApproved) digest else r.approvedDigest,
    publishedDigest: if (target == Disclosed) digest else 0,
    embargoHistory: if (embargoChange > 0) r.embargoHistory.append(embargoChange) else r.embargoHistory, revision: r.revision + 1 }
pure def canSetRecognition(r: Remediation, by: int, choice: Recognition): bool = by == r.privateCase.reporter and choice != r.recognition
pure def setRecognition(r: Remediation, by: int, choice: Recognition): Remediation = { ...r, recognition: choice, revision: r.revision + 1 }
pure def publicCredit(r: Remediation): bool = r.disclosure == Disclosed and r.recognition == OptIn
pure def alwaysExactDisclosure(r: Remediation): bool = (r.disclosure == Disclosed) == (r.publishedDigest > 0)
  and (r.publishedDigest > 0 implies r.publishedDigest == r.approvedDigest)
  and (r.disclosure == RedactionApproved implies r.approvedDigest > 0)
pure def stepDisclosedPermanent(before: Remediation, after: Remediation): bool =
  (before.disclosure == Disclosed implies after.disclosure == Disclosed and after.publishedDigest == before.publishedDigest)
  and (after.embargoHistory == before.embargoHistory or after.embargoHistory == before.embargoHistory.append(after.embargoHistory.nthOr(before.embargoHistory.length(), 0)))
pure def sometimesDisclosed(r: Remediation): bool = r.disclosure == Disclosed and r.embargoHistory.length() > 0
pure def sometimesCreditWithdrawn(r: Remediation): bool = r.disclosure == Disclosed and r.recognition == PrivateRecognition
```

### Simulation samples

```quint
pure val byValues = Set(1, 2, 3, 6)
pure val actorValues = Set(6)
pure val checkedEpochValues = Set(1, 2)
pure val snapshotValues = Set({ ...C::staff, epoch: 2, technical: List(3) })
pure val stageValues = Set(Investigating, Fixing)
pure val targetValues = Set(Embargoed, RedactionApproved, Disclosed)
pure val digestValues = Set(0, 1, 2)
pure val testedDigestValues = Set(1, 2)
pure val deployedDigestValues = Set(1, 2)
pure val embargoChangeValues = Set(0, 1)
pure val choiceValues = Set(OptIn, PrivateRecognition)
```
