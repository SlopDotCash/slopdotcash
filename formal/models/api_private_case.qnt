// @source migrations/0026_private_security_cases.sql
// @source migrations/0028_security_case_related_party.sql
// @source migrations/0061_security_automatic_intake.sql
// @source backend/security/handler.ts
// @source backend/security/analysis.ts
// @source backend/security/report-analysis.ts
// @source backend/security/project-access.ts
// @source backend/security/award-asset.ts
module api_private_case {
  var s: {receipt: str, award: str, related: bool, relatedApproved: bool, appeal: bool, remediation: str, redaction: int, disclosed: int, revision: int}
  action init = s' = {receipt: "received", award: "pending", related: false, relatedApproved: false, appeal: false, remediation: "investigating", redaction: 0, disclosed: 0, revision: 1}
  action decide(confirmed: bool, related: bool): bool = all { s.award == "pending", s.revision < 4,
    s' = s.with("receipt", if(confirmed) "confirmed" else "rejected").with("related", s.related or related).with("revision", s.revision + 1) }
  action approveRelated(independent: bool): bool = all { independent, s.related, s.receipt == "confirmed", s' = s.with("relatedApproved", true) }
  action award = all { s.receipt == "confirmed", not(s.appeal), not(s.related) or s.relatedApproved, s' = s.with("award", "approved") }
  action appeal = all { s.receipt == "rejected", s' = s.with("appeal", true) }
  action returnAppeal(independent: bool): bool = all { independent, s.appeal, s' = s.with("appeal", false).with("receipt", "received") }
  action resolve(evidence: bool): bool = all { evidence, s' = s.with("remediation", "resolved") }
  action mitigate(evidence: bool): bool = all { evidence, s.remediation == "resolved", s' = s.with("remediation", "mitigation-verified") }
  action approveRedaction = s' = s.with("redaction", 1)
  action disclose(digest: int): bool = all { digest == s.redaction, digest != 0, s' = s.with("disclosed", digest) }
  action step = any { decide(true,false), decide(true,true), decide(false,false), approveRelated(true), approveRelated(false), award,
    appeal, returnAppeal(true), returnAppeal(false), resolve(true), resolve(false), mitigate(true), mitigate(false), approveRedaction, disclose(1), disclose(2), s' = s }
  val invariant = all { s.award == "approved" implies (s.receipt == "confirmed" and (not(s.related) or s.relatedApproved)), s.disclosed != 0 implies s.disclosed == s.redaction }
  run relatedAwardTest = init.then(decide(true,true)).then(approveRelated(true)).then(award).expect(s.award == "approved")
  run disclosureTest = init.then(resolve(true)).then(mitigate(true)).then(approveRedaction).then(disclose(1)).expect(s.disclosed == 1)
  run appealTest = init.then(decide(false,false)).then(appeal).then(returnAppeal(true)).expect(s.receipt == "received")
}
