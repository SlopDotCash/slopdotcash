# Slopbot

PRD sections 5, 7 and 9 govern registered-repository review, useful outcome
scoring, qualified closure, appeals and the incomplete-assessment Inbox.
Slopbot review remains free.

- [GitHub App installation lifecycle](./installation.md)
- [Repository identity and review scope](./repositoryScope.md)
- [GitHub webhook delivery](./webhookDelivery.md)
- [Job queue retries and dead letters](./jobQueue.md)
- [Review routing and the new-author cap](./routing.md)
- [Review and provider recovery](./review.md)
- [Review claims and late-worker fencing](./reviewLease.md)
- [Provider budget blocks](./budgetBlocks.md)
- [Spending milestones and provider notices](./spendAlerts.md)
- [Value request outcomes and source contention](./valueRequests.md)
- [Work-unit value inference](./valueInference.md)
- [Value history selection](./valueHistory.md)
- [Work units and the joint journal](./workUnits.md)
- [Historical subscription import](./historicalImport.md)
- [Incomplete assessments in the private Inbox](./assessmentInbox.md)
- [Value evidence integrity](./valueEvidence.md)
- [Finding categories and the published penalty table](./categories.md)
- [Closure eligibility](./closure.md)
- [Closure activation and qualification](./closureActivation.md)
- [Close capacity and the reopen breaker](./closeCapacity.md)
- [Close attempts and their recovery](./closeAttempt.md)
- [Maintainer holds of uncertain findings](./maintainerHold.md)
- [Appeals and immutable penalties](./appeals.md)
- [Close, appeal and penalty composition](./composition.md)
- [Value disputes](./valueDisputes.md)
- [Points disputes triage](./pointsDisputes.md)
- [Private reporting refresh runs and repository access](./reportingReadiness.md)
- [Public Slopbot feeds](./publicFeeds.md)

The shell verifies GitHub events, repository identity, exact source, current
roles, isolation and provider receipts. These models never establish model
accuracy or real-case qualification. Closure activation requires its separately
reviewed production evidence.
