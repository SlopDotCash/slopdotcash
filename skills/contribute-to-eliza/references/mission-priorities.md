# Eliza contribution mission

The contribution program exists to make the primary Eliza product work better,
not to maximize issue, pull-request, commit, line, test, or token counts. Use
this gate before claiming, implementing, reviewing, or validating work.

## Pass all three gates

### 1. Authorized demand

Proceed only when at least one source authorizes the outcome:

- the operator explicitly requests it;
- an open issue carries the exact `mission-ready` repository label; or
- the operator explicitly identifies a maintainer-owned release or verification
  gate and the failing behavior to address.

An unlabeled issue, Project card, other label, PR-title mirror, agent-generated
backlog item, speculative idea, or self-authored issue is not authorization by
itself. Typing `mission-ready` in a title, body, comment, pull request, or
Discussion has no effect. Do not apply, request, or automate the label, and do
not manufacture demand by opening an issue. If the need is real but not
authorized, reproduce it locally and ask the operator or maintainer before any
GitHub write.

### 2. Primary mission

The outcome must materially advance at least one surface, in this order:

1. **Eliza app**: make the shipped web, desktop, or mobile experience usable,
   reliable, understandable, accessible, and complete from onboarding through
   running and managing an agent.
2. **Eliza Cloud**: make authentication, deployment, model routing, storage,
   billing boundaries, observability, and app-to-cloud flows reliable for the
   shipped product.
3. **Core agent runtime**: make the agent loop, model layer, memory and state,
   tools, actions, providers, services, evaluators, permissions, error
   propagation, and plugin loading work correctly end to end.
4. **Primary capabilities**: repair an existing model, connector, storage,
   browser, coding, document, media, voice, or automation integration only when
   it is already part of a shipped/default product path or a maintainer-approved
   launch path.
5. **Release infrastructure**: repair CI, build, packaging, deployment, or test
   infrastructure only when its failure blocks one of the surfaces above or
   makes their verification falsely pass or fail.

New niche plugins, toy agents, isolated examples, experimental connectors, and
capabilities with no approved product consumer are outside the mission. Do not
add a new plugin merely because an API exists. A leaf-package bug qualifies
only when its issue identifies the primary user path or maintainer-approved
release path it breaks.

### 3. Material outcome

The contribution must fix a reproduced failure, complete a user-visible flow,
restore a required capability, remove a demonstrated reliability or security
risk, or produce evidence that changes a concrete engineering decision. It
must have observable acceptance criteria and a real verification path.

Reject work whose primary value is any of the following:

- formatting, renaming, comment churn, generic cleanup, or style-only changes;
- documentation that does not unblock a real user or operator path;
- tests that only increase counts or restate implementation details;
- speculative refactors, abstractions, migrations, or performance work without
  a reproduced problem and measurable target;
- routine dependency bumps, generated-file churn, or CI edits unrelated to a
  primary mission failure;
- duplicate fixes, already-owned work, broad epics, or work requiring an
  unavailable human/product decision;
- splitting one outcome into multiple issues or pull requests;
- any work selected because it is quick, scoreable, token-heavy, or likely to
  increase leaderboard position.

## Selection note

Record this privately before starting:

```text
Authorized demand: <operator request, triaged issue/card, or release gate>
Primary user path: <who is blocked and what they are trying to do>
Observed need: <reproduction, missing capability, or decision to validate>
Mission surface: <app, cloud, runtime, primary capability, or blocking infra>
Acceptance proof: <real behavior and artifacts that will prove completion>
Duplication check: <active issue/PR/owner search and why this is not duplicate>
```

If any line is vague, stop and clarify. Do not post a claim to buy time. Keep one
active contribution at a time and consolidate all work required for its outcome.

## Review application

Apply the same gates to reviews. Do not review a low-value PR merely because it
is open. For a mission-relevant PR, determine whether it solves the authorized
need completely, adds unrelated scope, or creates activity without product
value. Recommend closure rather than repairs when the premise fails the mission
gate.
