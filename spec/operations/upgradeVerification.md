# EVM upgrade preservation verification

PRD section 11, Activation gates and evidence. The pinned sources are
`scripts/escrow-acceptance/upgrade-verify.ts`, `upgrade-verification.ts`,
`upgrade-payments.ts` and `upgrade-qualification.ts`, and the legacy model
`formal/models/contracts/evm_upgrade_qualification.qnt`. Contract-side
upgrade custody is [the EVM escrow's](../contracts/evmEscrow.md); executing an
upgrade plan is the [qualification ledger's](./escrowQualification.md). This
machine is the read-only verifier that qualifies an already executed upgrade
plan on a public test network: it reads the chain and the stored plan and
writes one new report, and it holds no key.

The evidence fields are the verdicts of the verifier's own reads, at the
preservation block (the latest finalized block of the plan's successful
steps) and at the current finalized block; none is a caller flag.

## Story: Qualify an executed EVM upgrade from finalized evidence without signing

### An EVM upgrade verification passes only when every preserved slot, award and later payment reconciles, and it never signs

The plan input must be the exact reviewed bytes (its digest and source
commit), and its schema, network, chain, factory and test network must match.
Every planned step needs a successful finalized receipt. At the preservation
block the factory and vault template are the reviewed implementations with
the reviewed code, the factory proxy code, slots other than the template
slot, initializer version and roles (upgrade authority, registrar, identity
authority, fee recipient) are unchanged, every vault of the plan is still in
the finalized creation history, every vault runs the reviewed implementation
with the version 2 monthly reserve, and each planned vault keeps its proxy
code, initializer version, slots and mappings. Later activity on the factory
and the planned vaults may only be new vault creations and payments; each
later payment must pay a frozen, unpaid award of a live binding with the
award's actor, gross and stored fee, the binding's destination and version,
appear once, and move exactly the token balances it claims. At the current
finalized block the same code, slots and roles hold, every preserved vault
is still listed, every listed vault verifies as a deployment with the
version 2 reserve, and each preserved vault equals its preserved state
changed only by those payments. An outsider's factory upgrade, vault upgrade
and factory re-initialization must all revert. The original plan bytes and
the verifier's own source must be unchanged when it finishes. Anything else
refuses the verification and writes no report.

The verifier sends only reads (chain ID, blocks, receipts, storage, code,
logs and calls); any other request is refused before it reaches the network
and fails the verification, and nothing it does can persist a transaction.
The report is a new file, never an overwrite.

```quint
type RpcMethod = ChainIdRead | BlockRead | ReceiptRead | StorageRead | CodeRead | LogsRead | CallRead
  | SendRawTransaction | SendTransaction | SignTransaction
type LaterActivity = NoLaterActivity | ExactLaterPayments | UnqualifiedActivity
type UpgradeEvidence = { exactPlanBytes: bool, planIdentity: bool, testNetwork: bool, stepsFinalized: bool,
  reviewedImplementations: bool, factoryPreserved: bool, rolesPreserved: bool, inventoryComplete: bool,
  vaultsUpgraded: bool, vaultsPreserved: bool, laterActivity: LaterActivity, laterPaymentsReconciled: bool,
  currentStateReconciled: bool, outsiderRefused: bool, planUnchanged: bool, sourceUnchanged: bool }
type VerifyPhase = Verifying | Verified | VerificationRefused
type UpgradeVerification = { phase: VerifyPhase, forwarded: List[RpcMethod], refusedRequests: int, reports: int }
pure val initial: UpgradeVerification = { phase: Verifying, forwarded: List(), refusedRequests: 0, reports: 0 }
pure def readOnly(method: RpcMethod): bool = method == ChainIdRead or method == BlockRead or method == ReceiptRead
  or method == StorageRead or method == CodeRead or method == LogsRead or method == CallRead
pure def upgradePreserved(evidence: UpgradeEvidence): bool = evidence.exactPlanBytes and evidence.planIdentity
  and evidence.testNetwork and evidence.stepsFinalized and evidence.reviewedImplementations
  and evidence.factoryPreserved and evidence.rolesPreserved and evidence.inventoryComplete
  and evidence.vaultsUpgraded and evidence.vaultsPreserved
  and (evidence.laterActivity == NoLaterActivity
    or (evidence.laterActivity == ExactLaterPayments and evidence.laterPaymentsReconciled))
  and evidence.currentStateReconciled and evidence.outsiderRefused and evidence.planUnchanged and evidence.sourceUnchanged
pure def canRequest(v: UpgradeVerification, method: RpcMethod): bool = v.phase == Verifying
pure def request(v: UpgradeVerification, method: RpcMethod): UpgradeVerification =
  if (readOnly(method)) { ...v, forwarded: v.forwarded.append(method) }
  else { ...v, phase: VerificationRefused, refusedRequests: v.refusedRequests + 1 }
pure def canConclude(v: UpgradeVerification, evidence: UpgradeEvidence): bool = v.phase == Verifying
pure def conclude(v: UpgradeVerification, evidence: UpgradeEvidence): UpgradeVerification =
  if (upgradePreserved(evidence)) { ...v, phase: Verified, reports: v.reports + 1 } else { ...v, phase: VerificationRefused }
pure def alwaysOnlyReadsReachTheNetwork(v: UpgradeVerification): bool = v.forwarded.every(m => readOnly(m))
pure def alwaysRefusedRequestFails(v: UpgradeVerification): bool =
  (v.refusedRequests > 0 implies v.phase == VerificationRefused) and v.refusedRequests <= 1
pure def alwaysOneReportOnlyWhenVerified(v: UpgradeVerification): bool =
  (v.phase == Verified iff v.reports == 1) and v.reports <= 1
pure def lawUnqualifiedActivityNeverPasses(evidence: UpgradeEvidence): bool =
  evidence.laterActivity == UnqualifiedActivity implies not(upgradePreserved(evidence))
pure def lawChangedPlanNeverPasses(evidence: UpgradeEvidence): bool =
  not(evidence.planUnchanged and evidence.exactPlanBytes) implies not(upgradePreserved(evidence))
pure def sometimesVerifiedAfterReads(v: UpgradeVerification): bool = v.phase == Verified and v.forwarded.length() > 0
pure def sometimesSigningRequestRefused(v: UpgradeVerification): bool = v.phase == VerificationRefused and v.refusedRequests == 1
pure def sometimesMismatchRefused(v: UpgradeVerification): bool = v.phase == VerificationRefused and v.refusedRequests == 0
pure val passingEvidence: UpgradeEvidence = { exactPlanBytes: true, planIdentity: true, testNetwork: true, stepsFinalized: true,
  reviewedImplementations: true, factoryPreserved: true, rolesPreserved: true, inventoryComplete: true,
  vaultsUpgraded: true, vaultsPreserved: true, laterActivity: ExactLaterPayments, laterPaymentsReconciled: true,
  currentStateReconciled: true, outsiderRefused: true, planUnchanged: true, sourceUnchanged: true }
pure val evidenceValues = Set(passingEvidence).union(Set({ ...passingEvidence, laterActivity: UnqualifiedActivity }))
  .union(Set({ ...passingEvidence, laterActivity: NoLaterActivity })).union(Set({ ...passingEvidence, planUnchanged: false }))
  .union(Set({ ...passingEvidence, laterPaymentsReconciled: false }))
pure val weight_request = 6
```
