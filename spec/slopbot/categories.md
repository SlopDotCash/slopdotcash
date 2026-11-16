# Slopbot finding categories and the published penalty table

PRD sections 5 and 7 publish one table of finding actions and Point debits.
Source `workers/slopbot/contracts.ts` (`CATEGORIES`, `UNIVERSAL_CATEGORIES`,
`NEVER_CLOSE`, `SECURITY_CATEGORIES`), `workers/slopbot/penalties.ts`
(`PENALTY_TABLE`, `slopbot-penalties-v1`) and `workers/verified-policy.ts`
(`penaltyDebit`) define the vocabulary that the model verdict schema
returns. The closure decision, the penalty journal, appeals and disputes
import this one library so the category, its permitted action and its debit
cannot disagree between areas.

## Story: One category vocabulary governs action, debit and escalation

### The verdict schema has ten categories and the PRD table names their actions

The PRD row "Clear violation of a quoted project rule" is the verdict
categories `busywork` and `gaming`; a quoted rule must be found verbatim in
the reviewed policy before either can act. `empty` closes without a debit,
like `duplicate`. `none` is the no-findings outcome. `missing_evidence` and
`out_of_scope` are label-only whatever a repository file configures. Only
`scam` is a confirmed-malicious result that adds the moderator label, the
moderator account-review notice and mandatory appeal escalation. The four
universal categories (`spam`, `scam`, `empty`, `duplicate`) need no
repository guidance; every other finding needs a verbatim quoted rule.
Security-only review acts on `scam` alone.

```quint
type Category = NoFinding | Spam | Scam | EmptyItem | Duplicate | OutOfScope | Busywork |
  MissingEvidence | Gaming | LowQuality
type PermittedAction = NoAction | LabelOnly | CloseAllowed
pure def permittedAction(category: Category): PermittedAction =
  if (category == NoFinding) NoAction
  else if (category == OutOfScope or category == MissingEvidence) LabelOnly
  else CloseAllowed
pure def neverCloses(category: Category): bool = permittedAction(category) != CloseAllowed
pure def universal(category: Category): bool =
  category == Spam or category == Scam or category == EmptyItem or category == Duplicate
pure def requiresQuotedRule(category: Category): bool = category != NoFinding and not(universal(category))
pure def requiresObjectiveVerifier(category: Category): bool = category == LowQuality
pure def confirmedMalicious(category: Category): bool = category == Scam
pure def securityCategory(category: Category): bool = category == Scam
pure def lawNoFindingTakesNoAction(category: Category): bool =
  category == NoFinding implies permittedAction(category) == NoAction
pure def lawLabelOnlyCategoriesNeverClose(category: Category): bool =
  (category == OutOfScope or category == MissingEvidence or category == NoFinding) implies neverCloses(category)
pure def lawOnlyScamIsMalicious(category: Category): bool = confirmedMalicious(category) iff category == Scam
pure def lawSecurityActsOnlyOnScam(category: Category): bool = securityCategory(category) implies category == Scam
```

### Debits are whole Points fixed by the table version in force when the debit is recorded

The published table is `slopbot-penalties-v1`: spam 30, scam or malicious
240, quoted-rule violation 10, and 0 for every other category. Source units
are thirds (3, 24, 1); one third is ten Points. A debit row records its table
version, so a later table applies prospectively and never re-prices an
existing row. Only version 1 exists; an unknown version has no debit and the
recording guard refuses it.

```quint
pure val currentTableVersion = 1
pure def knownTableVersion(version: int): bool = version == 1
pure def debitFor(version: int, category: Category): int =
  if (not(knownTableVersion(version))) 0
  else if (category == Spam) 30
  else if (category == Scam) 240
  else if (category == Busywork or category == Gaming) 10
  else 0
pure def moderatorReview(category: Category): bool = confirmedMalicious(category)
pure val escalationDebit = 240
pure def lawPublishedDebits(category: Category): bool = {
  val d = debitFor(currentTableVersion, category)
  d == 0 or d == 10 or d == 30 or d == 240
}
pure def lawLabelOnlyHasNoDebit(version: int, category: Category): bool =
  neverCloses(category) implies debitFor(version, category) == 0
pure def lawUnknownVersionHasNoDebit(version: int, category: Category): bool =
  not(knownTableVersion(version)) implies debitFor(version, category) == 0
pure def lawScamDebitEscalates(category: Category): bool =
  debitFor(currentTableVersion, category) >= escalationDebit iff category == Scam
```

### Confidence uses hundredths and closure requires at least ninety

Source `CLOSE_CONFIDENCE = 0.9`. Model confidences are carried as integer
hundredths from 0 to 100. The same threshold escalates an appeal or dispute
whose draft is below it.

```quint
pure val closeConfidence = 90
pure def validConfidence(confidenceHundredths: int): bool =
  confidenceHundredths >= 0 and confidenceHundredths <= 100
pure def confident(confidenceHundredths: int): bool =
  validConfidence(confidenceHundredths) and confidenceHundredths >= closeConfidence
pure def lawConfidenceBound(confidenceHundredths: int): bool =
  confident(confidenceHundredths) implies confidenceHundredths >= 90 and confidenceHundredths <= 100
```
