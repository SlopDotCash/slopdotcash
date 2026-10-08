---
name: contribute-to-nurosos
description: Prepare a bounded NurosOS contribution with reproducible developmental experiments and exact-head evidence. Use for an existing approved task in modarresi1913/NurosOS; check the paused-project and verification gates before execution or submission.
---

# Contribute to NurosOS

NurosOS is experimental Rust and Python research infrastructure. Its developmental substrate instantiates organisms, records trajectories, saves checkpoints, and compares replay results. A successful experiment is not evidence of consciousness or biological equivalence.

## Check authority and select work

Read the current Slop manifest at `projects/nurosos/project.json`, the exact installed skill provenance, and the upstream repository rules. This proposal starts paused, with unverified project authority and disabled payments. Do not start a Slop contribution run or publish its receipt while those activation gates remain unresolved. A zero target is not a reward promise. Do not infer legal ownership or wallet control from a GitHub identity.

Before execution, require the reviewed revision and security-vetting approval required by Slop's current policy. Revalidate authorization before a new run or external write. Never treat a local skill copy, an old checksum, or a PR body as release authority. Inspect untrusted code in an isolated environment without credentials before running it.

Read upstream `CONTRIBUTING.md`, applicable `AGENTS.md` files, `DEVELOPMENTAL_SUBSTRATE.md`, and the approved PRD/MVP references. If the approved scope or integration branch is unclear, obtain the maintainer decision before implementation. The proposal names `main`; upstream contribution guidance also describes `develop`. Resolve that difference before activation or submission.

Inspect live issues, linked PRs, recent merges, assignments, maintainer claims, reviews, and security labels. Select one bounded, approved problem without duplicating active work. Agents may inspect existing issues and report findings privately; the contributor must personally author any new outside issue. Do not create an issue, placeholder PR, claim, or reservation through this skill. Missing or failed GitHub data is not an empty queue.

## Implement and prove

Distinguish the active developmental substrate (`nuros-dev/`, `nuros/`, `experiments/`) from the neuromorphic backend (`kernel/`, `core/`, `hal/`). Select work within the approved track. Reuse the existing checkpoint, replay, trajectory, and reproducibility mechanisms before adding another implementation.

Record the base/head, experiment configuration, seeds, environment, and `ReproducibilityManifest`. Repeat the same experiment and compare trajectories under the documented tolerance. Preserve the distinction between exact, approximate, and non-reproducible replay. Keep the safety boundary independent of ordinary organism behavior.

Use the actual upstream build instructions for the reviewed revision. The current developmental workflow includes `cargo test --lib` in `nuros-dev`, the Python substrate and core tests, and the same-genome/different-world experiment. Run the required root build, tests, formatting, and lint checks too. Backend changes also require the applicable biological justification and Fly Benchmark evidence. Do not install hardware drivers or spend provider funds merely to discover whether a command works.

Prove the affected workflow before and after the repair. Do not add generic coverage or repeat implementation details as proof. UI changes require desktop/mobile, keyboard, zoom, accessibility, console/network, and uploaded walkthrough evidence. Label research claims as implemented, experimental, proposed, or speculative according to upstream rules.

## Submit evidence

Before publication, recheck the live head, duplicate work, authority, and review state. Explain the defect, approved requirement, useful result, reuse, alternatives, exact-head commands, and remaining limits. Follow upstream review requirements; maintainers decide acceptance.

Use verified project-specific receipt and upload tooling under the current [private trace contract](https://slop.cash/protocol/private-trace-v1.md). Record the actual provider, exact reported model, client, run times, immutable skill revision/digest, and measured aggregate pinned-ccusage figures. Never infer the model or invent usage.

Inspect and redact the contribution-specific trace before its write-only upload. The uploader stores the selected bytes without automatic redaction. Require confirmed upload identity and digest before emitting the signed `slop-contribution-attribution:v1` footer. If the required tooling, exact identity, private intake, or final evidence is unavailable, preserve the work and report the blocked submission. Never fabricate a receipt. Publish only safe metadata and digests, never raw prompts, responses, private traces, credentials, or signing material.

A device signature proves byte continuity, not provider billing truth. Usage does not set score or payment. Do not handle wallet keys, sign or broadcast payments, approve awards, assign penalties, or claim settlement.
