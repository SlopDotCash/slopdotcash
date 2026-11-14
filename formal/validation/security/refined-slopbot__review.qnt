module slopbot__review { // # Review attempts and provider recovery

// PRD section 5 selects Orbio Claude Sonnet 5.5, then Surplus Claude Sonnet 5.5,
// then Surplus GPT-6.1 Terra. Every Orbio failure goes directly to Surplus.
// Exact attribution and known or unknown actual cost remain in the journal.

// ## Story: Review registered work and preserve incomplete outcomes

// ### The review records provider order and coverage separately

// ```quint
type Provider = OrbioSonnet | SurplusSonnet | SurplusTerra
type ReviewStatus = Queued | InFlight | RetryableFailure | Limited | Complete
type Review = { status: ReviewStatus, provider: Provider, registered: bool, retired: bool, isolated: bool, sourceBound: bool, attempts: int, completed: int, unknownCosts: int, knownCost: int, fullCoverage: bool, finding: bool }
pure val initial: Review = { status: Queued, provider: OrbioSonnet, registered: false, retired: false, isolated: false, sourceBound: false, attempts: 0, completed: 0, unknownCosts: 0, knownCost: 0, fullCoverage: false, finding: false }
pure def canBindSource(r: Review, registered: bool, retired: bool, isolated: bool, sourceBound: bool): bool = r.status == Queued
pure def bindSource(r: Review, registered: bool, retired: bool, isolated: bool, sourceBound: bool): Review = { ...r, registered: registered, retired: retired, isolated: isolated, sourceBound: sourceBound }
pure def canStart(r: Review): bool = r.status == Queued and r.registered and not(r.retired) and r.isolated and r.sourceBound
pure def start(r: Review): Review = { ...r, status: InFlight, attempts: r.attempts + 1 }
// ```

// ### Any failed provider attempt advances directly to the next approved provider

// Attempts are durably recorded before provider calls. The adapter records actual
// cost if known and preserves an unknown cost on failed or interrupted calls.
// Zero cost must be supported by a receipt and cannot replace missing data.

// ```quint
pure def canFailAttempt(r: Review): bool = r.status == InFlight
pure def failAttempt(r: Review): Review = {
  ...r,
  provider: if (r.provider == OrbioSonnet) SurplusSonnet else SurplusTerra,
  status: if (r.provider == SurplusTerra) RetryableFailure else Queued,
  unknownCosts: r.unknownCosts + 1
}
pure def canRetry(r: Review): bool = r.status == RetryableFailure or r.status == Limited
pure def retry(r: Review): Review = { ...r, status: Queued, provider: OrbioSonnet, fullCoverage: false, finding: false }
pure def canFinish(r: Review, fullCoverage: bool, finding: bool, cost: int): bool = r.status == InFlight and cost >= 0
pure def finish(r: Review, fullCoverage: bool, finding: bool, cost: int): Review = { ...r, status: if (fullCoverage) Complete else Limited, fullCoverage: fullCoverage, finding: finding, completed: r.completed + 1, knownCost: r.knownCost + cost }
pure def alwaysAttemptAccounting(r: Review): bool = r.attempts >= r.completed + r.unknownCosts and r.knownCost >= 0
pure def alwaysCompletedCoverage(r: Review): bool = r.status == Complete implies r.fullCoverage and r.registered and not(r.retired) and r.isolated and r.sourceBound
pure def mayEnforce(r: Review): bool = r.status == Complete and r.fullCoverage
pure def alwaysLimitedIsAdvisory(r: Review): bool = r.status == Limited implies not(mayEnforce(r))
pure def sometimesComplete(r: Review): bool = r.status == Complete
pure def sometimesLimited(r: Review): bool = r.status == Limited
pure def sometimesBackup(r: Review): bool = r.provider == SurplusSonnet and r.status == InFlight
pure def sometimesProviderFailure(r: Review): bool = r.status == RetryableFailure
// ```

// A no-findings result remains distinct from limited coverage and provider failure.
// The shell applies effective repository scope, ignore, security and rejection
// rules from the exact approved base. Untrusted code runs only in approved
// isolation without posting credentials or secrets. Large and binary evidence
// requires explicit coverage accounting and cannot silently consume every retry.

// ## Story: Report inference spending without inventing a hard cap

// ### Alerts-only mode crosses each 500 dollar milestone once

// ```quint
pure def crossedMilestone(previousCents: int, nextCents: int): int = if (previousCents >= 0 and nextCents >= previousCents) nextCents / 50000 - previousCents / 50000 else 0
pure def lawNoAlertForUnchangedCost(cents: int): bool = crossedMilestone(cents, cents) == 0
pure def validBudget(mode: str, capCents: int): bool = mode == "alerts_only" or (mode == "capped" and capCents >= 0)
// ```

// Alerts-only mode reserves no fixed monthly or per-attempt cap. Capped mode
// retains explicit numeric reservations. Invalid or missing configuration refuses
// inference. Low Surplus balance and provider failures notify the operator.
// Pre-November subscription imports retain their exact client/provider/model and
// never masquerade as API billing receipts. Historical publication holds remain
// owned by the Points specification.

// ### Simulation samples exercise missing, matching and conflicting evidence

// These input sets bound simulation only. The generated guards accept every
// value allowed by their declared types and product rules.

// ```quint
pure val capCentsValues = Set(-1, 0, 50000)
pure val centsValues = Set(0, 49999, 50000, 50001, 100000)
pure val costValues = Set(0, 1, 2)
pure val modeValues = Set("", "alerts_only", "capped")
pure val nextCentsValues = Set(0, 49999, 50000, 50001, 100000)
pure val previousCentsValues = Set(0, 49999, 50000, 50001, 100000)
// ```

}
