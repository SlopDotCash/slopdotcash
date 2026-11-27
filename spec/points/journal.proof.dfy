lemma creditUnit_ensures(l: Ledger, c: UnitCredit)
  ensures (inv(l) ==> canCreditUnit(l, c) ==> alwaysNextIdPositive(creditUnit(l, c)))
  ensures (inv(l) ==> canCreditUnit(l, c) ==> alwaysRevisionsWellFormed(creditUnit(l, c)))
  ensures (inv(l) ==> canCreditUnit(l, c) ==> alwaysDecisionsReconcile(creditUnit(l, c)))
  ensures (inv(l) ==> canCreditUnit(l, c) ==> alwaysNoUpheldDisputeCorrection(creditUnit(l, c)))
  ensures (inv(l) ==> canCreditUnit(l, c) ==> alwaysRecognizedOncePerMonth(creditUnit(l, c)))
  ensures (inv(l) ==> canCreditUnit(l, c) ==> alwaysFrozenPeriodsValid(creditUnit(l, c)))
  ensures (inv(l) ==> canCreditUnit(l, c) ==> stepAppendOnly(l, creditUnit(l, c)))
  ensures (inv(l) ==> canCreditUnit(l, c) ==> stepObservationsAppendNothing(l, "creditUnit", creditUnit(l, c)))
  ensures (inv(l) ==> canCreditUnit(l, c) ==> stepFrozenAcceptedWorkUnchanged(l, creditUnit(l, c)))
  ensures (inv(l) ==> canCreditUnit(l, c) ==> stepChained(l, creditUnit(l, c)))
{
  if inv(l) && canCreditUnit(l, c) {
    var k := unitKey(c.project, c.unit);
    var local_1 := unitOf(l, c.unit);
    var r := noRevision.(id := l.nextId, key := k, amount := local_1.value, occurredAt := c.occurredAt, recordedAt := l.now, rule := c.rule, sourceDigest := c.digest, provisional := c.provisional, recipients := c.recipients, completeLines := c.completeLines, shares := points__allocation_allocatePoints(local_1.value, c.recipients), decision := (if c.decision.basis.Reassessment? then c.decision.(delta := local_1.value) else noDecision));
    assert forall x :: x in l.revisions ==> x.key != k;
    LatestInLedger(l, k);
    assert latest(l, k) == noRevision;
    AppendKeeps(l, r);
    AppendKeepsRecognizedOnce(l, r);
  }
}

lemma credit_ensures(l: Ledger, a: AwardInput, e: SourceEvidence, decision: Decision)
  ensures (inv(l) ==> canCredit(l, a, e, decision) ==> alwaysNextIdPositive(credit(l, a, e, decision)))
  ensures (inv(l) ==> canCredit(l, a, e, decision) ==> alwaysRevisionsWellFormed(credit(l, a, e, decision)))
  ensures (inv(l) ==> canCredit(l, a, e, decision) ==> alwaysDecisionsReconcile(credit(l, a, e, decision)))
  ensures (inv(l) ==> canCredit(l, a, e, decision) ==> alwaysNoUpheldDisputeCorrection(credit(l, a, e, decision)))
  ensures (inv(l) ==> canCredit(l, a, e, decision) ==> alwaysRecognizedOncePerMonth(credit(l, a, e, decision)))
  ensures (inv(l) ==> canCredit(l, a, e, decision) ==> alwaysFrozenPeriodsValid(credit(l, a, e, decision)))
  ensures (inv(l) ==> canCredit(l, a, e, decision) ==> stepAppendOnly(l, credit(l, a, e, decision)))
  ensures (inv(l) ==> canCredit(l, a, e, decision) ==> stepObservationsAppendNothing(l, "credit", credit(l, a, e, decision)))
  ensures (inv(l) ==> canCredit(l, a, e, decision) ==> stepFrozenAcceptedWorkUnchanged(l, credit(l, a, e, decision)))
  ensures (inv(l) ==> canCredit(l, a, e, decision) ==> stepChained(l, credit(l, a, e, decision)))
{
  if inv(l) && canCredit(l, a, e, decision) {
    var r := noRevision.(id := l.nextId, key := a.key, amount := a.amount, occurredAt := a.occurredAt, recordedAt := l.now, rule := a.rule, sourceDigest := a.digest, provisional := a.provisional, decision := (if decision.basis.NoBasis? then noDecision else decision.(delta := a.amount)));
    AppendKeepsRecognizedOnce(l, r);
  }
}

lemma creditEvaluation_ensures(l: Ledger, m: points__evaluations_Manifest)
  ensures (inv(l) ==> canCreditEvaluation(l, m) ==> alwaysNextIdPositive(creditEvaluation(l, m)))
  ensures (inv(l) ==> canCreditEvaluation(l, m) ==> alwaysRevisionsWellFormed(creditEvaluation(l, m)))
  ensures (inv(l) ==> canCreditEvaluation(l, m) ==> alwaysDecisionsReconcile(creditEvaluation(l, m)))
  ensures (inv(l) ==> canCreditEvaluation(l, m) ==> alwaysNoUpheldDisputeCorrection(creditEvaluation(l, m)))
  ensures (inv(l) ==> canCreditEvaluation(l, m) ==> alwaysRecognizedOncePerMonth(creditEvaluation(l, m)))
  ensures (inv(l) ==> canCreditEvaluation(l, m) ==> alwaysFrozenPeriodsValid(creditEvaluation(l, m)))
  ensures (inv(l) ==> canCreditEvaluation(l, m) ==> stepAppendOnly(l, creditEvaluation(l, m)))
  ensures (inv(l) ==> canCreditEvaluation(l, m) ==> stepObservationsAppendNothing(l, "creditEvaluation", creditEvaluation(l, m)))
  ensures (inv(l) ==> canCreditEvaluation(l, m) ==> stepFrozenAcceptedWorkUnchanged(l, creditEvaluation(l, m)))
  ensures (inv(l) ==> canCreditEvaluation(l, m) ==> stepChained(l, creditEvaluation(l, m)))
{
  if inv(l) && canCreditEvaluation(l, m) {
    var r := noRevision.(id := l.nextId, key := evaluationKey(m), amount := points__evaluations_slopPoints(m), occurredAt := m.occurredAt, recordedAt := l.now, rule := SourceRule.ScoreV2, sourceDigest := m.decision);
    AppendKeepsRecognizedOnce(l, r);
  }
}

lemma rescoreUnit_ensures(l: Ledger, s: points__scoringPolicy_Scored, reason: string, digest: string)
  ensures (inv(l) ==> canRescoreUnit(l, s, reason, digest) ==> alwaysNextIdPositive(rescoreUnit(l, s, reason, digest)))
  ensures (inv(l) ==> canRescoreUnit(l, s, reason, digest) ==> alwaysRevisionsWellFormed(rescoreUnit(l, s, reason, digest)))
  ensures (inv(l) ==> canRescoreUnit(l, s, reason, digest) ==> alwaysDecisionsReconcile(rescoreUnit(l, s, reason, digest)))
  ensures (inv(l) ==> canRescoreUnit(l, s, reason, digest) ==> alwaysNoUpheldDisputeCorrection(rescoreUnit(l, s, reason, digest)))
  ensures (inv(l) ==> canRescoreUnit(l, s, reason, digest) ==> alwaysRecognizedOncePerMonth(rescoreUnit(l, s, reason, digest)))
  ensures (inv(l) ==> canRescoreUnit(l, s, reason, digest) ==> alwaysFrozenPeriodsValid(rescoreUnit(l, s, reason, digest)))
  ensures (inv(l) ==> canRescoreUnit(l, s, reason, digest) ==> stepAppendOnly(l, rescoreUnit(l, s, reason, digest)))
  ensures (inv(l) ==> canRescoreUnit(l, s, reason, digest) ==> stepObservationsAppendNothing(l, "rescoreUnit", rescoreUnit(l, s, reason, digest)))
  ensures (inv(l) ==> canRescoreUnit(l, s, reason, digest) ==> stepFrozenAcceptedWorkUnchanged(l, rescoreUnit(l, s, reason, digest)))
  ensures (inv(l) ==> canRescoreUnit(l, s, reason, digest) ==> stepChained(l, rescoreUnit(l, s, reason, digest)))
{
  if inv(l) && canRescoreUnit(l, s, reason, digest) {
    var prior := latest(l, unitKey(s.project, s.unit));
    var r := noRevision.(id := l.nextId, previous := prior.id, key := unitKey(s.project, s.unit), amount := s.points, priorAmount := prior.amount, occurredAt := prior.occurredAt, recordedAt := l.now, rule := SourceRule.ValueV1, sourceDigest := digest, decision := (if s.phase.LegacyScored? then noDecision else Decision(rescoreBasis(s), l.now, reason, (s.points - prior.amount), digest, true)), recipients := prior.recipients, completeLines := prior.completeLines, shares := points__allocation_allocatePoints(s.points, prior.recipients));
    assert rescoreUnit(l, s, reason, digest) == l.(revisions := l.revisions + [r], nextId := l.nextId + 1);
    assert lastRevision(rescoreUnit(l, s, reason, digest)) == r;
    assert unitAllocation(r);
    AppendKeeps(l, r);
    AppendKeepsRecognizedOnce(l, r);
  }
}

lemma reallocateUnit_ensures(l: Ledger, project: string, unit: int, recipients: seq<points__allocation_Recipient>, completeLines: bool, reason: string, digest: string, pullRequest: string)
  ensures (inv(l) ==> canReallocateUnit(l, project, unit, recipients, completeLines, reason, digest, pullRequest) ==> alwaysNextIdPositive(reallocateUnit(l, project, unit, recipients, completeLines, reason, digest, pullRequest)))
  ensures (inv(l) ==> canReallocateUnit(l, project, unit, recipients, completeLines, reason, digest, pullRequest) ==> alwaysRevisionsWellFormed(reallocateUnit(l, project, unit, recipients, completeLines, reason, digest, pullRequest)))
  ensures (inv(l) ==> canReallocateUnit(l, project, unit, recipients, completeLines, reason, digest, pullRequest) ==> alwaysDecisionsReconcile(reallocateUnit(l, project, unit, recipients, completeLines, reason, digest, pullRequest)))
  ensures (inv(l) ==> canReallocateUnit(l, project, unit, recipients, completeLines, reason, digest, pullRequest) ==> alwaysNoUpheldDisputeCorrection(reallocateUnit(l, project, unit, recipients, completeLines, reason, digest, pullRequest)))
  ensures (inv(l) ==> canReallocateUnit(l, project, unit, recipients, completeLines, reason, digest, pullRequest) ==> alwaysRecognizedOncePerMonth(reallocateUnit(l, project, unit, recipients, completeLines, reason, digest, pullRequest)))
  ensures (inv(l) ==> canReallocateUnit(l, project, unit, recipients, completeLines, reason, digest, pullRequest) ==> alwaysFrozenPeriodsValid(reallocateUnit(l, project, unit, recipients, completeLines, reason, digest, pullRequest)))
  ensures (inv(l) ==> canReallocateUnit(l, project, unit, recipients, completeLines, reason, digest, pullRequest) ==> stepAppendOnly(l, reallocateUnit(l, project, unit, recipients, completeLines, reason, digest, pullRequest)))
  ensures (inv(l) ==> canReallocateUnit(l, project, unit, recipients, completeLines, reason, digest, pullRequest) ==> stepObservationsAppendNothing(l, "reallocateUnit", reallocateUnit(l, project, unit, recipients, completeLines, reason, digest, pullRequest)))
  ensures (inv(l) ==> canReallocateUnit(l, project, unit, recipients, completeLines, reason, digest, pullRequest) ==> stepFrozenAcceptedWorkUnchanged(l, reallocateUnit(l, project, unit, recipients, completeLines, reason, digest, pullRequest)))
  ensures (inv(l) ==> canReallocateUnit(l, project, unit, recipients, completeLines, reason, digest, pullRequest) ==> stepChained(l, reallocateUnit(l, project, unit, recipients, completeLines, reason, digest, pullRequest)))
{
  if inv(l) && canReallocateUnit(l, project, unit, recipients, completeLines, reason, digest, pullRequest) {
    var k := unitKey(project, unit);
    var prior := latest(l, k);
    var valDec := latestValueDecision(l, k);
    LatestValueDecisionSourceNonEmpty(l, k);
    var r := noRevision.(id := l.nextId, previous := prior.id, key := k, amount := prior.amount, priorAmount := prior.amount, occurredAt := prior.occurredAt, recordedAt := l.now, rule := SourceRule.ValueV1, sourceDigest := digest, decision := Decision(Basis.Reallocation, l.now, reason, 0, (if valDec.valued then valDec.source else pullRequest), valDec.valued), recipients := recipients, completeLines := completeLines, shares := points__allocation_allocatePoints(prior.amount, recipients));
    assert reallocateUnit(l, project, unit, recipients, completeLines, reason, digest, pullRequest) == l.(revisions := l.revisions + [r], nextId := l.nextId + 1);
    assert lastRevision(reallocateUnit(l, project, unit, recipients, completeLines, reason, digest, pullRequest)) == r;
    assert unitAllocation(r);
    AppendKeeps(l, r);
    AppendKeepsRecognizedOnce(l, r);
  }
}

lemma rescoreSource_ensures(l: Ledger, a: AwardInput, e: SourceEvidence, decision: Decision)
  ensures (inv(l) ==> canRescoreSource(l, a, e, decision) ==> alwaysNextIdPositive(rescoreSource(l, a, e, decision)))
  ensures (inv(l) ==> canRescoreSource(l, a, e, decision) ==> alwaysRevisionsWellFormed(rescoreSource(l, a, e, decision)))
  ensures (inv(l) ==> canRescoreSource(l, a, e, decision) ==> alwaysDecisionsReconcile(rescoreSource(l, a, e, decision)))
  ensures (inv(l) ==> canRescoreSource(l, a, e, decision) ==> alwaysNoUpheldDisputeCorrection(rescoreSource(l, a, e, decision)))
  ensures (inv(l) ==> canRescoreSource(l, a, e, decision) ==> alwaysRecognizedOncePerMonth(rescoreSource(l, a, e, decision)))
  ensures (inv(l) ==> canRescoreSource(l, a, e, decision) ==> alwaysFrozenPeriodsValid(rescoreSource(l, a, e, decision)))
  ensures (inv(l) ==> canRescoreSource(l, a, e, decision) ==> stepAppendOnly(l, rescoreSource(l, a, e, decision)))
  ensures (inv(l) ==> canRescoreSource(l, a, e, decision) ==> stepObservationsAppendNothing(l, "rescoreSource", rescoreSource(l, a, e, decision)))
  ensures (inv(l) ==> canRescoreSource(l, a, e, decision) ==> stepFrozenAcceptedWorkUnchanged(l, rescoreSource(l, a, e, decision)))
  ensures (inv(l) ==> canRescoreSource(l, a, e, decision) ==> stepChained(l, rescoreSource(l, a, e, decision)))
{
  if inv(l) && canRescoreSource(l, a, e, decision) {
    LatestInLedger(l, a.key);
    var prior := latest(l, a.key);
    assert prior in l.revisions && prior.key == a.key;
    assert validKey(a.key);
    var r := noRevision.(id := l.nextId, previous := prior.id, key := a.key, amount := a.amount, priorAmount := prior.amount, occurredAt := prior.occurredAt, recordedAt := l.now, rule := a.rule, sourceDigest := a.digest, provisional := a.provisional, decision := (if decision.basis.NoBasis? then noDecision else decision.(delta := (a.amount - prior.amount))));
    AppendKeeps(l, r);
    AppendKeepsRecognizedOnce(l, r);
  }
}

lemma decideEvaluation_ensures(l: Ledger, k: AwardKey, d: points__evaluations_LaterDecision)
  ensures (inv(l) ==> canDecideEvaluation(l, k, d) ==> alwaysNextIdPositive(decideEvaluation(l, k, d)))
  ensures (inv(l) ==> canDecideEvaluation(l, k, d) ==> alwaysRevisionsWellFormed(decideEvaluation(l, k, d)))
  ensures (inv(l) ==> canDecideEvaluation(l, k, d) ==> alwaysDecisionsReconcile(decideEvaluation(l, k, d)))
  ensures (inv(l) ==> canDecideEvaluation(l, k, d) ==> alwaysNoUpheldDisputeCorrection(decideEvaluation(l, k, d)))
  ensures (inv(l) ==> canDecideEvaluation(l, k, d) ==> alwaysRecognizedOncePerMonth(decideEvaluation(l, k, d)))
  ensures (inv(l) ==> canDecideEvaluation(l, k, d) ==> alwaysFrozenPeriodsValid(decideEvaluation(l, k, d)))
  ensures (inv(l) ==> canDecideEvaluation(l, k, d) ==> stepAppendOnly(l, decideEvaluation(l, k, d)))
  ensures (inv(l) ==> canDecideEvaluation(l, k, d) ==> stepObservationsAppendNothing(l, "decideEvaluation", decideEvaluation(l, k, d)))
  ensures (inv(l) ==> canDecideEvaluation(l, k, d) ==> stepFrozenAcceptedWorkUnchanged(l, decideEvaluation(l, k, d)))
  ensures (inv(l) ==> canDecideEvaluation(l, k, d) ==> stepChained(l, decideEvaluation(l, k, d)))
{
  if inv(l) && canDecideEvaluation(l, k, d) {
    var prior := latest(l, k);
    var r := noRevision.(id := l.nextId, previous := prior.id, key := k, amount := (30 * d.points), priorAmount := prior.amount, occurredAt := prior.occurredAt, recordedAt := l.now, rule := SourceRule.ScoreV2, sourceDigest := d.decision, decision := Decision(Basis.ManifestDecision, l.now, d.reason, ((30 * d.points) - prior.amount), d.decision, false));
    AppendKeepsRecognizedOnce(l, r);
  }
}

lemma recordRetirementBatch_ensures(l: Ledger, k: AwardKey)
  ensures (inv(l) ==> canRecordRetirementBatch(l, k) ==> alwaysNextIdPositive(recordRetirementBatch(l, k)))
  ensures (inv(l) ==> canRecordRetirementBatch(l, k) ==> alwaysRevisionsWellFormed(recordRetirementBatch(l, k)))
  ensures (inv(l) ==> canRecordRetirementBatch(l, k) ==> alwaysDecisionsReconcile(recordRetirementBatch(l, k)))
  ensures (inv(l) ==> canRecordRetirementBatch(l, k) ==> alwaysNoUpheldDisputeCorrection(recordRetirementBatch(l, k)))
  ensures (inv(l) ==> canRecordRetirementBatch(l, k) ==> alwaysRecognizedOncePerMonth(recordRetirementBatch(l, k)))
  ensures (inv(l) ==> canRecordRetirementBatch(l, k) ==> alwaysFrozenPeriodsValid(recordRetirementBatch(l, k)))
  ensures (inv(l) ==> canRecordRetirementBatch(l, k) ==> stepAppendOnly(l, recordRetirementBatch(l, k)))
  ensures (inv(l) ==> canRecordRetirementBatch(l, k) ==> stepObservationsAppendNothing(l, "recordRetirementBatch", recordRetirementBatch(l, k)))
  ensures (inv(l) ==> canRecordRetirementBatch(l, k) ==> stepFrozenAcceptedWorkUnchanged(l, recordRetirementBatch(l, k)))
  ensures (inv(l) ==> canRecordRetirementBatch(l, k) ==> stepChained(l, recordRetirementBatch(l, k)))
{
  hide *;
  if inv(l) && canRecordRetirementBatch(l, k) {
    RetirementFacts();
    reveal recordRetirementBatch, appendRevision, canRecordRetirementBatch;
    var prior := latest(l, k);
    var d := points__evaluations_retirementZeroDigest;
    var reas := "retired evaluator batch";
    var r := noRevision.(id := l.nextId, previous := prior.id, key := k, amount := 0, priorAmount := prior.amount, occurredAt := prior.occurredAt, recordedAt := l.now, rule := SourceRule.ScoreV2, sourceDigest := d, decision := Decision(Basis.RetirementBatch, l.now, reas, (0 - prior.amount), d, false));
    assert recordRetirementBatch(l, k) == l.(revisions := l.revisions + [r], nextId := l.nextId + 1);
    RecordRetirementHelper(l, k, prior, r);
  }
}

lemma RetirementFacts()
  ensures points__evaluations_retirementZeroDigest != ""
  ensures "retired evaluator batch" != ""
  ensures points__evaluations_retiredAt <= points__evaluations_retirementZeroedAt
  ensures amountAllowed(Category.Evaluated, 0)
  ensures noRevision.provisional == false && noRevision.tableVersion == 0 && noRevision.debit == 0 && noRevision.reversed == false && noRevision.recipients == [] && noRevision.shares == []
{
  assert |points__evaluations_retirementZeroDigest| > 0;
  assert |"retired evaluator batch"| > 0;
}

lemma RecordRetirementHelper(l: Ledger, k: AwardKey, prior: Revision, r: Revision)
  requires inv(l) && canRecordRetirementBatch(l, k)
  requires prior == latest(l, k) && prior.recordedAt <= l.now && amountAllowed(k.category, 0)
  requires r.id == l.nextId && r.previous == prior.id && r.key == k && r.amount == 0 && r.priorAmount == prior.amount
  requires r.occurredAt == prior.occurredAt && r.recordedAt == l.now && r.rule.ScoreV2?
  requires r.sourceDigest != "" && !r.provisional && r.tableVersion == 0 && r.debit == 0 && !r.reversed
  requires r.recipients == [] && r.shares == []
  requires r.decision.basis.RetirementBatch? && r.decision.effectiveAt == l.now && r.decision.reason != ""
  requires r.decision.delta == 0 - prior.amount && r.decision.source != "" && !r.decision.valued
  ensures var after := l.(revisions := l.revisions + [r], nextId := l.nextId + 1);
    alwaysNextIdPositive(after)
    && alwaysRevisionsWellFormed(after)
    && alwaysDecisionsReconcile(after)
    && alwaysNoUpheldDisputeCorrection(after)
    && alwaysRecognizedOncePerMonth(after)
    && alwaysFrozenPeriodsValid(after)
    && stepAppendOnly(l, after)
    && stepObservationsAppendNothing(l, "recordRetirementBatch", after)
    && stepFrozenAcceptedWorkUnchanged(l, after)
    && stepChained(l, after)
{
  hide *;
  reveal inv, canRecordRetirementBatch, alwaysNextIdPositive, alwaysFrozenPeriodsValid, stepAppendOnly, stepObservationsAppendNothing, stepFrozenAcceptedWorkUnchanged, stepChained, chainsTo, frozenKeeps, lastRevision, unitAllocation, ruleAllowed, decisionRule, validKey;
  var after := l.(revisions := l.revisions + [r], nextId := l.nextId + 1);
  assert lastRevision(after) == r;
  assert unitAllocation(r);
  assert ruleAllowed(r.key.category, r.rule);
  assert decisionRule(r.key.category, r.rule);
  AppendKeeps(l, r);
  AppendKeepsRecognizedOnce(l, r);
}

lemma recoverIncident_ensures(l: Ledger, k: AwardKey, reason: string)
  ensures (inv(l) ==> canRecoverIncident(l, k, reason) ==> alwaysNextIdPositive(recoverIncident(l, k, reason)))
  ensures (inv(l) ==> canRecoverIncident(l, k, reason) ==> alwaysRevisionsWellFormed(recoverIncident(l, k, reason)))
  ensures (inv(l) ==> canRecoverIncident(l, k, reason) ==> alwaysDecisionsReconcile(recoverIncident(l, k, reason)))
  ensures (inv(l) ==> canRecoverIncident(l, k, reason) ==> alwaysNoUpheldDisputeCorrection(recoverIncident(l, k, reason)))
  ensures (inv(l) ==> canRecoverIncident(l, k, reason) ==> alwaysRecognizedOncePerMonth(recoverIncident(l, k, reason)))
  ensures (inv(l) ==> canRecoverIncident(l, k, reason) ==> alwaysFrozenPeriodsValid(recoverIncident(l, k, reason)))
  ensures (inv(l) ==> canRecoverIncident(l, k, reason) ==> stepAppendOnly(l, recoverIncident(l, k, reason)))
  ensures (inv(l) ==> canRecoverIncident(l, k, reason) ==> stepObservationsAppendNothing(l, "recoverIncident", recoverIncident(l, k, reason)))
  ensures (inv(l) ==> canRecoverIncident(l, k, reason) ==> stepFrozenAcceptedWorkUnchanged(l, recoverIncident(l, k, reason)))
  ensures (inv(l) ==> canRecoverIncident(l, k, reason) ==> stepChained(l, recoverIncident(l, k, reason)))
{
  if inv(l) && canRecoverIncident(l, k, reason) {
    var prior := latest(l, k);
    var retained := revisionById(l, prior.previous);
    var r := noRevision.(id := l.nextId, previous := prior.id, key := k, amount := retained.amount, priorAmount := prior.amount, occurredAt := prior.occurredAt, recordedAt := l.now, rule := SourceRule.ScoreV2, sourceDigest := "retired-evaluator-recovery-v1", decision := Decision(Basis.IncidentRecovery, l.now, reason, (retained.amount - prior.amount), "retired-evaluator-recovery-v1", false));
    AppendKeepsRecognizedOnce(l, r);
  }
}

lemma recordPenalty_ensures(l: Ledger, p: PenaltyEvidence)
  ensures (inv(l) ==> canRecordPenalty(l, p) ==> alwaysNextIdPositive(recordPenalty(l, p)))
  ensures (inv(l) ==> canRecordPenalty(l, p) ==> alwaysRevisionsWellFormed(recordPenalty(l, p)))
  ensures (inv(l) ==> canRecordPenalty(l, p) ==> alwaysDecisionsReconcile(recordPenalty(l, p)))
  ensures (inv(l) ==> canRecordPenalty(l, p) ==> alwaysNoUpheldDisputeCorrection(recordPenalty(l, p)))
  ensures (inv(l) ==> canRecordPenalty(l, p) ==> alwaysRecognizedOncePerMonth(recordPenalty(l, p)))
  ensures (inv(l) ==> canRecordPenalty(l, p) ==> alwaysFrozenPeriodsValid(recordPenalty(l, p)))
  ensures (inv(l) ==> canRecordPenalty(l, p) ==> stepAppendOnly(l, recordPenalty(l, p)))
  ensures (inv(l) ==> canRecordPenalty(l, p) ==> stepObservationsAppendNothing(l, "recordPenalty", recordPenalty(l, p)))
  ensures (inv(l) ==> canRecordPenalty(l, p) ==> stepFrozenAcceptedWorkUnchanged(l, recordPenalty(l, p)))
  ensures (inv(l) ==> canRecordPenalty(l, p) ==> stepChained(l, recordPenalty(l, p)))
{
  if inv(l) && canRecordPenalty(l, p) {
    var prior := latest(l, p.key);
    var amount := penaltyAmount(l, p);
    var r := noRevision.(id := l.nextId, previous := prior.id, key := p.key, amount := amount, priorAmount := prior.amount, occurredAt := p.occurredAt, recordedAt := l.now, rule := SourceRule.PenaltyTable, tableVersion := p.tableVersion, sourceDigest := p.digest, debit := p.requested, reversed := p.reversed, decision := Decision(Basis.PenaltyChange, p.effectiveAt, p.reason, (amount - prior.amount), p.digest, false));
    AppendKeepsRecognizedOnce(l, r);
  }
}

lemma zeroRetainedOmission_ensures(l: Ledger, k: AwardKey, batch: RetainedBatch)
  ensures (inv(l) ==> canZeroRetainedOmission(l, k, batch) ==> alwaysNextIdPositive(zeroRetainedOmission(l, k, batch)))
  ensures (inv(l) ==> canZeroRetainedOmission(l, k, batch) ==> alwaysRevisionsWellFormed(zeroRetainedOmission(l, k, batch)))
  ensures (inv(l) ==> canZeroRetainedOmission(l, k, batch) ==> alwaysDecisionsReconcile(zeroRetainedOmission(l, k, batch)))
  ensures (inv(l) ==> canZeroRetainedOmission(l, k, batch) ==> alwaysNoUpheldDisputeCorrection(zeroRetainedOmission(l, k, batch)))
  ensures (inv(l) ==> canZeroRetainedOmission(l, k, batch) ==> alwaysRecognizedOncePerMonth(zeroRetainedOmission(l, k, batch)))
  ensures (inv(l) ==> canZeroRetainedOmission(l, k, batch) ==> alwaysFrozenPeriodsValid(zeroRetainedOmission(l, k, batch)))
  ensures (inv(l) ==> canZeroRetainedOmission(l, k, batch) ==> stepAppendOnly(l, zeroRetainedOmission(l, k, batch)))
  ensures (inv(l) ==> canZeroRetainedOmission(l, k, batch) ==> stepObservationsAppendNothing(l, "zeroRetainedOmission", zeroRetainedOmission(l, k, batch)))
  ensures (inv(l) ==> canZeroRetainedOmission(l, k, batch) ==> stepFrozenAcceptedWorkUnchanged(l, zeroRetainedOmission(l, k, batch)))
  ensures (inv(l) ==> canZeroRetainedOmission(l, k, batch) ==> stepChained(l, zeroRetainedOmission(l, k, batch)))
{
  if inv(l) && canZeroRetainedOmission(l, k, batch) {
    LatestInLedger(l, k);
    var prior := latest(l, k);
    assert prior in l.revisions && prior.key == k;
    var r := noRevision.(id := l.nextId, previous := prior.id, key := k, amount := 0, priorAmount := prior.amount, occurredAt := prior.occurredAt, recordedAt := l.now, rule := SourceRule.ScoreV2, sourceDigest := batch.digest, provisional := prior.provisional);
    AppendKeeps(l, r);
    AppendKeepsRecognizedOnce(l, r);
  }
}

lemma zeroSuperseded_ensures(l: Ledger, k: AwardKey, snapshot: Supersession)
  ensures (inv(l) ==> canZeroSuperseded(l, k, snapshot) ==> alwaysNextIdPositive(zeroSuperseded(l, k, snapshot)))
  ensures (inv(l) ==> canZeroSuperseded(l, k, snapshot) ==> alwaysRevisionsWellFormed(zeroSuperseded(l, k, snapshot)))
  ensures (inv(l) ==> canZeroSuperseded(l, k, snapshot) ==> alwaysDecisionsReconcile(zeroSuperseded(l, k, snapshot)))
  ensures (inv(l) ==> canZeroSuperseded(l, k, snapshot) ==> alwaysNoUpheldDisputeCorrection(zeroSuperseded(l, k, snapshot)))
  ensures (inv(l) ==> canZeroSuperseded(l, k, snapshot) ==> alwaysRecognizedOncePerMonth(zeroSuperseded(l, k, snapshot)))
  ensures (inv(l) ==> canZeroSuperseded(l, k, snapshot) ==> alwaysFrozenPeriodsValid(zeroSuperseded(l, k, snapshot)))
  ensures (inv(l) ==> canZeroSuperseded(l, k, snapshot) ==> stepAppendOnly(l, zeroSuperseded(l, k, snapshot)))
  ensures (inv(l) ==> canZeroSuperseded(l, k, snapshot) ==> stepObservationsAppendNothing(l, "zeroSuperseded", zeroSuperseded(l, k, snapshot)))
  ensures (inv(l) ==> canZeroSuperseded(l, k, snapshot) ==> stepFrozenAcceptedWorkUnchanged(l, zeroSuperseded(l, k, snapshot)))
  ensures (inv(l) ==> canZeroSuperseded(l, k, snapshot) ==> stepChained(l, zeroSuperseded(l, k, snapshot)))
{
  if inv(l) && canZeroSuperseded(l, k, snapshot) {
    LatestInLedger(l, k);
    var prior := latest(l, k);
    assert prior in l.revisions && prior.key == k;
    var r := noRevision.(id := l.nextId, previous := prior.id, key := k, amount := 0, priorAmount := prior.amount, occurredAt := prior.occurredAt, recordedAt := l.now, rule := SourceRule.ScoreV2, sourceDigest := snapshot.snapshotDigest, provisional := prior.provisional, decision := supersedingDecision(snapshot, prior), recipients := prior.recipients, completeLines := prior.completeLines, shares := points__allocation_allocatePoints(0, prior.recipients));
    assert unitAllocation(r) by {
      if !k.category.MergedWork? {
        assert |prior.recipients| == 0;
        assert |points__allocation_allocatePoints(0, prior.recipients)| == 0;
      }
    }
    AppendKeeps(l, r);
    AppendKeepsRecognizedOnce(l, r);
  }
}

lemma lawProtectedGroupHeld_ensures(priorOrdinaryPool: bool)
  ensures (lawProtectedGroupHeld(priorOrdinaryPool) == true)
{
  HoldSampleFacts();
  var g := protectedGroups(holdSample);
  assert g == ["g1"];
  assert holdSample.reviewed[1] in holdSample.reviewed;
  assert holdSample.reviewed[1].recordDigest == "r1" && holdSample.reviewed[1].workUnit == 2 && holdSample.reviewed[1].groupId in g;
  assert reviewedUnitHeld(holdSample, "r1", 2);
  assert 1 in holdSample.protectedSources;
}

lemma lawIndependentReviewedUnitScores_ensures(priorOrdinaryPool: bool)
  ensures (lawIndependentReviewedUnitScores(priorOrdinaryPool) == true)
{
  HoldSampleFacts();
  assert protectedGroups(holdSample) == ["g1"];
  assert protectedMemberships(holdSample) == [AssessedSource(1, "r1")];
  assert heldRecords(holdSample) == [];
  assert !sharedRecordHeld(holdSample, 3);
  assert !unassessedSourceHeld(holdSample, 3);
  assert !reviewedUnitHeld(holdSample, "r1", 3);
  assert !reviewedSourceHeld(holdSample, 3);
}

lemma lawWithoutMembershipTheRecordIsHeld_ensures(priorOrdinaryPool: bool)
  ensures (lawWithoutMembershipTheRecordIsHeld(priorOrdinaryPool) == true)
{
  var h := holdSample.(reviewed := []);
  var p1 := (u: ReviewedUnit) => (u.source in h.protectedSources);
  ProtectedMembershipsBridge(h);
  ProofLib.FilterNil(p1, h.reviewed);
  var memberships := protectedMemberships(h);
  assert memberships == [];
  var p2 := (a: AssessedSource) => ((a.source in h.protectedSources) && !((a in memberships)));
  HeldRecordsBridge(h);
  ProofLib.FilterCons(p2, h.assessed);
  assert h.assessed[0] == AssessedSource(1, "r1");
  assert p2(h.assessed[0]);
  assert h.assessed[1..] == [AssessedSource(3, "r1")];
  ProofLib.FilterCons(p2, h.assessed[1..]);
  assert !p2(h.assessed[1..][0]);
  ProofLib.FilterNil(p2, h.assessed[1..][1..]);
  assert heldRecords(h) == ["r1"];
  assert h.assessed[1] in h.assessed && h.assessed[1].source == 3 && h.assessed[1].recordDigest in heldRecords(h);
  assert sharedRecordHeld(h, 3);
}

lemma retireDuplicate_ensures(l: Ledger, project: string, unit: int, retirement: points__reviewedHistory_Retirement, packetRun: points__reviewedHistory_PacketRun, reason: string, digest: string)
  ensures (inv(l) ==> canRetireDuplicate(l, project, unit, retirement, packetRun, reason, digest) ==> alwaysNextIdPositive(retireDuplicate(l, project, unit, retirement, packetRun, reason, digest)))
  ensures (inv(l) ==> canRetireDuplicate(l, project, unit, retirement, packetRun, reason, digest) ==> alwaysRevisionsWellFormed(retireDuplicate(l, project, unit, retirement, packetRun, reason, digest)))
  ensures (inv(l) ==> canRetireDuplicate(l, project, unit, retirement, packetRun, reason, digest) ==> alwaysDecisionsReconcile(retireDuplicate(l, project, unit, retirement, packetRun, reason, digest)))
  ensures (inv(l) ==> canRetireDuplicate(l, project, unit, retirement, packetRun, reason, digest) ==> alwaysNoUpheldDisputeCorrection(retireDuplicate(l, project, unit, retirement, packetRun, reason, digest)))
  ensures (inv(l) ==> canRetireDuplicate(l, project, unit, retirement, packetRun, reason, digest) ==> alwaysRecognizedOncePerMonth(retireDuplicate(l, project, unit, retirement, packetRun, reason, digest)))
  ensures (inv(l) ==> canRetireDuplicate(l, project, unit, retirement, packetRun, reason, digest) ==> alwaysFrozenPeriodsValid(retireDuplicate(l, project, unit, retirement, packetRun, reason, digest)))
  ensures (inv(l) ==> canRetireDuplicate(l, project, unit, retirement, packetRun, reason, digest) ==> stepAppendOnly(l, retireDuplicate(l, project, unit, retirement, packetRun, reason, digest)))
  ensures (inv(l) ==> canRetireDuplicate(l, project, unit, retirement, packetRun, reason, digest) ==> stepObservationsAppendNothing(l, "retireDuplicate", retireDuplicate(l, project, unit, retirement, packetRun, reason, digest)))
  ensures (inv(l) ==> canRetireDuplicate(l, project, unit, retirement, packetRun, reason, digest) ==> stepFrozenAcceptedWorkUnchanged(l, retireDuplicate(l, project, unit, retirement, packetRun, reason, digest)))
  ensures (inv(l) ==> canRetireDuplicate(l, project, unit, retirement, packetRun, reason, digest) ==> stepChained(l, retireDuplicate(l, project, unit, retirement, packetRun, reason, digest)))
{
  if inv(l) && canRetireDuplicate(l, project, unit, retirement, packetRun, reason, digest) {
    var prior := latest(l, unitKey(project, unit));
    var r := noRevision.(id := l.nextId, previous := prior.id, key := unitKey(project, unit), amount := 0, priorAmount := prior.amount, occurredAt := prior.occurredAt, recordedAt := l.now, rule := SourceRule.ScoreV2, sourceDigest := digest, decision := Decision(Basis.DuplicateRetirement, l.now, reason, (0 - prior.amount), digest, false), recipients := prior.recipients, completeLines := prior.completeLines, shares := points__allocation_allocatePoints(0, prior.recipients));
    AppendKeepsRecognizedOnce(l, r);
  }
}

lemma correctRecipients_ensures(l: Ledger, project: string, unit: int, correction: points__reviewedHistory_RecipientCorrection, packetRun: points__reviewedHistory_PacketRun, reason: string, digest: string)
  ensures (inv(l) ==> canCorrectRecipients(l, project, unit, correction, packetRun, reason, digest) ==> alwaysNextIdPositive(correctRecipients(l, project, unit, correction, packetRun, reason, digest)))
  ensures (inv(l) ==> canCorrectRecipients(l, project, unit, correction, packetRun, reason, digest) ==> alwaysRevisionsWellFormed(correctRecipients(l, project, unit, correction, packetRun, reason, digest)))
  ensures (inv(l) ==> canCorrectRecipients(l, project, unit, correction, packetRun, reason, digest) ==> alwaysDecisionsReconcile(correctRecipients(l, project, unit, correction, packetRun, reason, digest)))
  ensures (inv(l) ==> canCorrectRecipients(l, project, unit, correction, packetRun, reason, digest) ==> alwaysNoUpheldDisputeCorrection(correctRecipients(l, project, unit, correction, packetRun, reason, digest)))
  ensures (inv(l) ==> canCorrectRecipients(l, project, unit, correction, packetRun, reason, digest) ==> alwaysRecognizedOncePerMonth(correctRecipients(l, project, unit, correction, packetRun, reason, digest)))
  ensures (inv(l) ==> canCorrectRecipients(l, project, unit, correction, packetRun, reason, digest) ==> alwaysFrozenPeriodsValid(correctRecipients(l, project, unit, correction, packetRun, reason, digest)))
  ensures (inv(l) ==> canCorrectRecipients(l, project, unit, correction, packetRun, reason, digest) ==> stepAppendOnly(l, correctRecipients(l, project, unit, correction, packetRun, reason, digest)))
  ensures (inv(l) ==> canCorrectRecipients(l, project, unit, correction, packetRun, reason, digest) ==> stepObservationsAppendNothing(l, "correctRecipients", correctRecipients(l, project, unit, correction, packetRun, reason, digest)))
  ensures (inv(l) ==> canCorrectRecipients(l, project, unit, correction, packetRun, reason, digest) ==> stepFrozenAcceptedWorkUnchanged(l, correctRecipients(l, project, unit, correction, packetRun, reason, digest)))
  ensures (inv(l) ==> canCorrectRecipients(l, project, unit, correction, packetRun, reason, digest) ==> stepChained(l, correctRecipients(l, project, unit, correction, packetRun, reason, digest)))
{
  if inv(l) && canCorrectRecipients(l, project, unit, correction, packetRun, reason, digest) {
    var k := unitKey(project, unit);
    var prior := latest(l, k);
    var r := noRevision.(id := l.nextId, previous := prior.id, key := k, amount := prior.amount, priorAmount := prior.amount, occurredAt := prior.occurredAt, recordedAt := l.now, rule := SourceRule.ScoreV2, sourceDigest := digest, decision := Decision(Basis.Reallocation, l.now, reason, 0, digest, false), recipients := correction.recipients, completeLines := true, shares := points__reviewedHistory_correctedShares(correction));
    assert correctRecipients(l, project, unit, correction, packetRun, reason, digest) == l.(revisions := l.revisions + [r], nextId := l.nextId + 1);
    assert lastRevision(correctRecipients(l, project, unit, correction, packetRun, reason, digest)) == r;
    assert r.shares == points__allocation_allocatePoints(r.amount, r.recipients);
    assert unitAllocation(r);
    AppendKeeps(l, r);
    AppendKeepsRecognizedOnce(l, r);
  }
}

lemma recognize_ensures(l: Ledger, paid: points__payoutRecognition_PaidRecipient)
  ensures (inv(l) ==> canRecognize(l, paid) ==> alwaysNextIdPositive(recognize(l, paid)))
  ensures (inv(l) ==> canRecognize(l, paid) ==> alwaysRevisionsWellFormed(recognize(l, paid)))
  ensures (inv(l) ==> canRecognize(l, paid) ==> alwaysDecisionsReconcile(recognize(l, paid)))
  ensures (inv(l) ==> canRecognize(l, paid) ==> alwaysNoUpheldDisputeCorrection(recognize(l, paid)))
  ensures (inv(l) ==> canRecognize(l, paid) ==> alwaysRecognizedOncePerMonth(recognize(l, paid)))
  ensures (inv(l) ==> canRecognize(l, paid) ==> alwaysFrozenPeriodsValid(recognize(l, paid)))
  ensures (inv(l) ==> canRecognize(l, paid) ==> stepAppendOnly(l, recognize(l, paid)))
  ensures (inv(l) ==> canRecognize(l, paid) ==> stepObservationsAppendNothing(l, "recognize", recognize(l, paid)))
  ensures (inv(l) ==> canRecognize(l, paid) ==> stepFrozenAcceptedWorkUnchanged(l, recognize(l, paid)))
  ensures (inv(l) ==> canRecognize(l, paid) ==> stepChained(l, recognize(l, paid)))
{
  if inv(l) && canRecognize(l, paid) {
    var k := recognitionKey(paid);
    var r := noRevision.(id := l.nextId, key := k, amount := points__payoutRecognition_recognitionAmount(paid), occurredAt := paid.settledAt, recordedAt := l.now, rule := SourceRule.VerifiedPayoutV1, sourceDigest := paid.settlementDigest);
    assert forall x :: x in l.revisions ==> x.key != k;
    LatestInLedger(l, k);
    assert latest(l, k) == noRevision;
    AppendKeepsRecognizedOnce(l, r);
  }
}

lemma recognizeVaultPayment_ensures(l: Ledger, v: points__payoutRecognition_VaultPayment)
  ensures (inv(l) ==> canRecognizeVaultPayment(l, v) ==> alwaysNextIdPositive(recognizeVaultPayment(l, v)))
  ensures (inv(l) ==> canRecognizeVaultPayment(l, v) ==> alwaysRevisionsWellFormed(recognizeVaultPayment(l, v)))
  ensures (inv(l) ==> canRecognizeVaultPayment(l, v) ==> alwaysDecisionsReconcile(recognizeVaultPayment(l, v)))
  ensures (inv(l) ==> canRecognizeVaultPayment(l, v) ==> alwaysNoUpheldDisputeCorrection(recognizeVaultPayment(l, v)))
  ensures (inv(l) ==> canRecognizeVaultPayment(l, v) ==> alwaysRecognizedOncePerMonth(recognizeVaultPayment(l, v)))
  ensures (inv(l) ==> canRecognizeVaultPayment(l, v) ==> alwaysFrozenPeriodsValid(recognizeVaultPayment(l, v)))
  ensures (inv(l) ==> canRecognizeVaultPayment(l, v) ==> stepAppendOnly(l, recognizeVaultPayment(l, v)))
  ensures (inv(l) ==> canRecognizeVaultPayment(l, v) ==> stepObservationsAppendNothing(l, "recognizeVaultPayment", recognizeVaultPayment(l, v)))
  ensures (inv(l) ==> canRecognizeVaultPayment(l, v) ==> stepFrozenAcceptedWorkUnchanged(l, recognizeVaultPayment(l, v)))
  ensures (inv(l) ==> canRecognizeVaultPayment(l, v) ==> stepChained(l, recognizeVaultPayment(l, v)))
{
  if inv(l) && canRecognizeVaultPayment(l, v) {
    var k := vaultKey(v);
    var r := noRevision.(id := l.nextId, key := k, amount := points__payoutRecognition_vaultRecognitionAmount(v), occurredAt := v.indexedAt, recordedAt := l.now, rule := SourceRule.VerifiedPayoutV1, sourceDigest := v.digest);
    assert forall x :: x in l.revisions ==> x.key != k;
    LatestInLedger(l, k);
    assert latest(l, k) == noRevision;
    AppendKeepsRecognizedOnce(l, r);
  }
}

lemma AppendKeeps(l: Ledger, r: Revision)
  requires alwaysRevisionsWellFormed(l) && alwaysDecisionsReconcile(l) && alwaysNoUpheldDisputeCorrection(l)
  requires r.id == l.nextId && r.id > 0 && r.previous >= 0 && r.previous < r.id && validKey(r.key)
  requires amountAllowed(r.key.category, r.amount) && ruleAllowed(r.key.category, r.rule) && unitAllocation(r)
  requires r.recordedAt >= r.occurredAt && r.occurredAt >= 0 && r.recordedAt <= l.now && r.sourceDigest != ""
  requires (!(r.provisional) || (r.key.category.MergedWork? || r.key.category.Review?))
  requires (r.key.category.Penalty? ==> (!(r.provisional) && r.tableVersion > 0 && r.debit > 0 && 0 - r.amount <= r.debit && (r.reversed ==> r.amount == 0) && !r.decision.basis.NoBasis?))
  requires (!(r.key.category.Penalty?) ==> (r.tableVersion == 0 && r.debit == 0 && !(r.reversed)))
  requires (r.previous == 0 ==> r.priorAmount == 0) && (r.decision.basis.NoBasis? ==> r.decision == noDecision)
  requires (!r.decision.basis.NoBasis? ==> (r.decision.delta == r.amount - r.priorAmount && r.decision.reason != "" && r.decision.effectiveAt <= r.recordedAt && r.decision.source != "" && decisionRule(r.key.category, r.rule)))
  requires !r.decision.basis.DisputeUpheld?
  ensures alwaysRevisionsWellFormed(l.(revisions := l.revisions + [r], nextId := l.nextId + 1))
  ensures alwaysDecisionsReconcile(l.(revisions := l.revisions + [r], nextId := l.nextId + 1))
  ensures alwaysNoUpheldDisputeCorrection(l.(revisions := l.revisions + [r], nextId := l.nextId + 1))
{
  var after := l.(revisions := l.revisions + [r], nextId := l.nextId + 1);
  forall x | x in after.revisions
    ensures x.id > 0 && x.id < after.nextId && x.recordedAt <= after.now
  {
    if x in l.revisions { } else { assert x == r; }
  }
}

lemma RecognizedFilterBridge(l: Ledger)
  ensures alwaysRecognizedOncePerMonth(l) == !((exists r :: r in l.revisions && !((!(r.key.category.PayoutReceived?) || (|ProofLib.Filter((o: Revision) => (((o.key.category.PayoutReceived? && (o.key.project == r.key.project)) && (o.key.source == r.key.source)) && (o.key.actor == r.key.actor)), l.revisions)| == 1)))))
{
}

lemma AppendKeepsRecognizedOnce(l: Ledger, r: Revision)
  requires alwaysRecognizedOncePerMonth(l)
  requires !r.key.category.PayoutReceived? || !recognizedIn(l, r.key.project, r.key.source, r.key.actor)
  ensures alwaysRecognizedOncePerMonth(l.(revisions := l.revisions + [r], nextId := l.nextId + 1))
{
  var after := l.(revisions := l.revisions + [r], nextId := l.nextId + 1);
  RecognizedFilterBridge(l);
  RecognizedFilterBridge(after);
  forall x | x in after.revisions && x.key.category.PayoutReceived?
    ensures |ProofLib.Filter((o: Revision) => (((o.key.category.PayoutReceived? && (o.key.project == x.key.project)) && (o.key.source == x.key.source)) && (o.key.actor == x.key.actor)), after.revisions)| == 1
  {
    var p := (o: Revision) => (((o.key.category.PayoutReceived? && (o.key.project == x.key.project)) && (o.key.source == x.key.source)) && (o.key.actor == x.key.actor));
    ProofLib.FilterAppend(p, l.revisions, r);
    if x in l.revisions {
      assert !p(r);
    } else {
      assert x == r;
      assert p(r);
      assert forall i :: 0 <= i < |l.revisions| ==> !p(l.revisions[i]);
      ProofLib.FilterNone(p, l.revisions);
    }
  }
}

lemma LatestFoldResult(rs: seq<Revision>, k: AwardKey, init: Revision)
  ensures var res := Std.Collections.Seq.FoldLeft((acc: Revision, r: Revision) => (if (r.key == k) then r else acc), init, rs); res == init || (res in rs && res.key == k)
  ensures (forall x :: x in rs ==> x.key != k) ==> Std.Collections.Seq.FoldLeft((acc: Revision, r: Revision) => (if (r.key == k) then r else acc), init, rs) == init
  decreases |rs|
{
  if |rs| > 0 {
    var next := if rs[0].key == k then rs[0] else init;
    LatestFoldResult(rs[1..], k, next);
  }
}

lemma LatestInLedger(l: Ledger, k: AwardKey)
  ensures latest(l, k) == noRevision || (latest(l, k) in l.revisions && latest(l, k).key == k)
  ensures (forall x :: x in l.revisions ==> x.key != k) ==> latest(l, k) == noRevision
{
  LatestFoldResult(l.revisions, k, noRevision);
}

lemma LatestValueDecisionFold(rs: seq<Revision>, k: AwardKey, init: Decision)
  ensures var res := Std.Collections.Seq.FoldLeft((acc: Decision, r: Revision) => (if ((r.key == k) && r.decision.valued) then r.decision else acc), init, rs); res == init || (exists r :: r in rs && r.key == k && r.decision.valued && res == r.decision)
  decreases |rs|
{
  if |rs| > 0 {
    var next := if rs[0].key == k && rs[0].decision.valued then rs[0].decision else init;
    LatestValueDecisionFold(rs[1..], k, next);
    if next != init {
      assert rs[0] in rs && rs[0].key == k && rs[0].decision.valued && next == rs[0].decision;
    }
  }
}

lemma LatestValueDecisionSourceNonEmpty(l: Ledger, k: AwardKey)
  requires alwaysDecisionsReconcile(l)
  ensures latestValueDecision(l, k).valued ==> latestValueDecision(l, k).source != ""
{
  LatestValueDecisionFold(l.revisions, k, noDecision);
  var d := latestValueDecision(l, k);
  if d.valued {
    assert d != noDecision;
    var r :| r in l.revisions && r.key == k && r.decision.valued && d == r.decision;
    assert !r.decision.basis.NoBasis?;
    assert r.decision.source != "";
  }
}

lemma ProtectedGroupsBridge(h: JointHoldInput)
  ensures protectedGroups(h) == (var s_map := ProofLib.Filter((u: ReviewedUnit) => (u.source in h.protectedSources), h.reviewed); seq(|s_map|, i_map requires 0 <= i_map < |s_map| => var u := s_map[i_map]; u.groupId))
{
}

lemma ProtectedMembershipsBridge(h: JointHoldInput)
  ensures protectedMemberships(h) == (var s_map := ProofLib.Filter((u: ReviewedUnit) => (u.source in h.protectedSources), h.reviewed); seq(|s_map|, i_map requires 0 <= i_map < |s_map| => var u := s_map[i_map]; AssessedSource(u.source, u.recordDigest)))
{
}

lemma HeldRecordsBridge(h: JointHoldInput)
  ensures heldRecords(h) == (var local_27 := protectedMemberships(h); (var s_map := ProofLib.Filter((a: AssessedSource) => ((a.source in h.protectedSources) && !((a in local_27))), h.assessed); seq(|s_map|, i_map requires 0 <= i_map < |s_map| => var a := s_map[i_map]; a.recordDigest)))
{
}

lemma HoldSampleFacts()
  ensures protectedGroups(holdSample) == ["g1"]
  ensures protectedMemberships(holdSample) == [AssessedSource(1, "r1")]
  ensures heldRecords(holdSample) == []
{
  var p1 := (u: ReviewedUnit) => (u.source in holdSample.protectedSources);
  ProtectedGroupsBridge(holdSample);
  ProtectedMembershipsBridge(holdSample);
  var rs := holdSample.reviewed;
  ProofLib.FilterCons(p1, rs);
  assert p1(rs[0]);
  ProofLib.FilterCons(p1, rs[1..]);
  assert !p1(rs[1..][0]);
  ProofLib.FilterCons(p1, rs[1..][1..]);
  assert !p1(rs[1..][1..][0]);
  ProofLib.FilterNil(p1, rs[1..][1..][1..]);
  assert ProofLib.Filter(p1, rs) == [protectedUnit];
  var memberships := protectedMemberships(holdSample);
  assert memberships == [AssessedSource(1, "r1")];
  var p2 := (a: AssessedSource) => ((a.source in holdSample.protectedSources) && !((a in memberships)));
  HeldRecordsBridge(holdSample);
  var as_ := holdSample.assessed;
  ProofLib.FilterCons(p2, as_);
  assert !p2(as_[0]);
  ProofLib.FilterCons(p2, as_[1..]);
  assert !p2(as_[1..][0]);
  ProofLib.FilterNil(p2, as_[1..][1..]);
}
