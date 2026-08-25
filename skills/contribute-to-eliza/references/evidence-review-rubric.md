# Evidence and review rubric

Proof must let a reviewer confirm real behavior without reading the implementation. Attach evidence inline to the issue or PR; do not commit it to the repository. Capture first, then open and inspect every artifact yourself.

## Evidence by surface

| Change surface | Minimum proof |
| --- | --- |
| UI | Before and after full-page desktop and mobile screenshots, an MP4 walkthrough of the full flow, frontend console and network logs, backend logs when a server path fires, and the repository-required OCR/visual review |
| Agent, action, provider, prompt, or model | A live-model trajectory containing inputs, context, raw output, tool/action calls, and results; name the exact provider and model |
| Native, mobile, desktop, or device | Current-build proof plus per-platform screenshots, recordings, logs, and device or simulator output |
| Server/runtime | Structured logs showing the real path end to end and resulting state or domain artifacts |
| Data/domain | The actual DB rows, memories, scheduled tasks, generated files, wallet balances, transaction hashes, audio, or device output |
| Documentation-only or non-runtime metadata | Focused validation output; mark unrelated template rows `N/A - <specific reason>` |

Keep all seven stable PR-template rows: before screenshots, after screenshots, walkthrough video, backend logs, frontend logs, real-LLM trajectory, and domain artifacts. A checked box alone is not evidence. A bare `N/A`, placeholder, or link to an unrelated page is not evidence. Rendered UI changes require concrete visual media even when labels are missing.

Useful repository commands include:

```bash
bun run evidence:doctor -- --strict
packages/scenario-runner/bin/eliza-scenarios run <scenario> --report <out.json>
bun run test:e2e:record:review
bun run test:matrix:review
bun run --cwd packages/app audit:app
```

Follow package-local capture commands for native platforms. Upload screenshots as JPG where practical, videos as MP4, and long logs in a `<details>` block. Re-run and re-capture after a behavior-changing rebase.

## Verification hierarchy

Acceptance requires proof from a real working product path on a real operating
system. Run the applicable E2E flow first, then an Eliza scenario against the
actual agent/model/tool path, then a benchmark when the change makes a quality,
performance, reliability, latency, or resource claim. Exercise every relevant
platform; do not infer desktop, mobile, native, browser, or server behavior from
another platform.

Unit tests are not acceptance evidence. Do not request or add one unless an
actual material failure is already reproduced, real-system evidence proves the
fix, and the unit test is useful only as a supplemental regression guard over
production code and a real contract. Reject mocks, fakes, snapshots, stubbed
collaborators, implementation-detail assertions, and coverage-only additions
that can remain green while the product path fails. Formatting, lint, typecheck,
build, and broad test-suite results are hygiene, not proof that Eliza works.

## Anti-slop review gate

Demand a causal chain from a reproduced supported-path failure to the smallest
production change, real-system proof, and only then a minimal regression test.
Missing coverage, mutation counts, exhaustive inputs, and passing automation do
not establish need or impact.

Reject tests that mirror constants, manifests, exports, wording, fallback
precedence, straightforward helpers, private branches, or behavior already
known to conflict with the intended contract. Reject speculative guards and
sanitizers where invalid input cannot reach the function. Invalid data must not
become plausible success. Reject lossy caps, compaction, bounded reads, and
short deadlines unless an exact external contract or measured resource failure
requires them and the chosen value preserves supported large or slow work.

Reject one-PR-per-file coverage farming and “no same-named test” justifications,
including helper, hook, barrel, schema, type, constant, and test-infrastructure
suites. Existence, type, finiteness, array length, literal metadata, export
identity, and mock-call assertions are shape smoke unless they protect a
demonstrated semantic failure. Copied or mismatched PR descriptions invalidate
the claimed evidence.

A burst of identical defensive patches means the wrong layer is being changed.
Do not reward module-by-module NaN comparator fallbacks, CE year 0–99 support,
placeholder-key/config-shape lists, or Unicode truncation refinements. Require
one reachable canonical boundary and real-path proof.
Do not convert an uncovered parser, lookup, regex, word-boundary, or fallback
branch into a micro-fix merely because coverage work discovered it.

Real security, authorization, protocol, and resource boundaries require
proportional enforcement and real-path proof. Prefer typed rejection, lossless
chunking, explicit pagination, and explicit cancellation/configuration over
silent loss. Close PRs that fail this gate instead of requesting more bloat;
they earn no accepted-outcome score and may be penalized or excluded from
reward review. Apply the same quality judgment to reviews.

## Implementation completion rubric

- Acceptance criteria map to code, tests, and proof with no hidden scope expansion.
- Required DTO values and collaborators remain required; failed or missing data does not become a healthy empty or zero state.
- Inner failures throw typed errors; only designated boundaries translate them. Any retained handler follows the repository's documented J1–J7 policy.
- E2E runs, Eliza scenarios, and applicable benchmarks drive the real system
  through success, failure, empty/invalid input, permissions, concurrency, and
  adversarial behavior where relevant; no mock or unit-only proof substitutes
  for them.
- Formatting, typecheck, build, focused tests, and repository verification run on the final synced head.
- Documentation and package-local guidance match the shipped behavior.
- No TODO, stub, mock standing in for the changed behavior, committed evidence bundle, or unrelated cleanup remains.

## Independent PR review rubric

1. Confirm the PR's scope matches its linked issue and the diff contains no unrelated behavior.
2. Trace changed data across boundaries; check validation, authorization, secret handling, SSRF/file handling, error propagation, and observable failure states.
3. Read every affected package guide and verify the implementation follows its architecture.
4. Reproduce the old failure or stated need, then exercise the changed path independently.
5. Reproduce the real product path on the relevant operating systems. Inspect
   E2E, scenario, and benchmark evidence for meaningful assertions and missing
   negative, role, concurrency, and integration cases. Treat unit tests only as
   supplemental and block unit-only or mock-only acceptance claims.
6. Verify the branch is current with `origin/develop` and checks were run after sync.
7. Open every attached trajectory, log, screenshot, recording, and domain artifact. Compare it to the acceptance criteria and look for stale builds, hidden errors, clipped states, or mismatched model identity.
8. Audit the PR template: every evidence row is concrete or carries an allowed specific `N/A` reason, and the PR body plus every contribution comment discloses the exact provider/model.
9. Separate blocking findings from optional suggestions. Cite the smallest relevant line range and state the consequence plus a verifiable repair.
10. Require another reviewer for repairs you authored. Never self-approve or self-merge.
