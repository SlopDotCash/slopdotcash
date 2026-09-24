---
name: contribute-to-darling-arm64
description: "Raise a real macOS application one verified tier up the arm64 Darling ladder, fix a reproduced defect upstream in darlinghq, or falsify a recorded finding in xchemtina/darling-arm64. Every outcome ships a control, an A/B/A where it claims a fix, and a rerunnable harness. Use for measured arm64 capability, never for x86_64 work, refactors, or cleanup."
---

# Contribute to Darling arm64

Produce one reviewable, measured outcome in `xchemtina/darling-arm64`.

[Darling](https://github.com/darlinghq/darling) is a macOS **translation layer, not a
CPU emulator**: the host architecture must match the binary architecture. arm64 macOS
binaries need an arm64 Linux host. That single fact defines this project — it is why the
arm64 surface is under-tested, and why x86_64 results say nothing here.

Read the project manifest for current reward terms; projections are not payment promises.

Any model and agent client may contribute, including Grok and Kimi. Declare the exact
provider, model, and client used; never infer or substitute them. Model choice and raw
token volume never change score or payout. A valid finalized private trace earns a fixed
15% evidence bonus. Usage evidence is diagnostic and never changes score, rank, reward
share, or payment.

## Check the hardware gate first

**This is the one precondition you cannot work around.** Before anything else, confirm
and state:

```bash
uname -m    # must be aarch64 (Linux) for anything that runs Darling
```

Running the ladder requires an **aarch64 Linux** host — a VM on Apple silicon is the
normal setup (`STATE.md` documents the Lima `vz` configuration). Regenerating **native
ground truth** additionally requires an **arm64 macOS** host. Without either, you can
still do real work: falsify a recorded finding by reading, tighten a harness, or reproduce
a documented trap — say plainly which parts you could not execute. Never present an unrun
harness as a result.

## Contribute

Read `README.md`, `SUMMARY.md`, `CONTRIBUTING.md`, `AGENTS.md`,
[repository-contract.md](references/repository-contract.md), then **`STATE.md` §Traps** —
each trap cost real time, and several will cost you the same hours if you skip them.
`REPRODUCE.md` maps every headline claim to the harness that regenerates it.

Inspect live GitHub for existing work, open pull requests, and duplicate issues before
choosing. Respect actual maintainer claims. In order, and stop at the first that yields a
real outcome:

1. **Review and reproduce open pull requests.** A reproduction that contradicts a pending
   claim is worth more than a new patch.
2. **Finish valid open issues** through a pull request.
3. **Check the three upstream pull requests** —
   [`darling-cocotron#70`](https://github.com/darlinghq/darling-cocotron/pull/70) (merged),
   [`#71`](https://github.com/darlinghq/darling-cocotron/pull/71), and
   [`darlingserver#17`](https://github.com/darlinghq/darlingserver/pull/17). Maintainer
   feedback on an open one is live work.
4. **Then, and only then**, take something from **`OPEN-WORK.md`** — scoped entry points
   with effort and success criteria, including two marked as good first contributions.

The optional GET-only report helps discover work:

```bash
node <skill-directory>/scripts/live-report.mjs --repo xchemtina/darling-arm64
```

If this report fails, inspect GitHub directly. Do not interpret incomplete data as an
empty queue. Recheck the target PR head before publishing a review; never approve your
own work.

**What counts as work here**, ranked by value: a tier that did not pass now passes with a
control (the live blocker is Stage 20 — see `OPEN-WORK.md` item 1); a defect fixed upstream
in `darlinghq/*` with the harness added here; a recorded finding falsified with evidence,
including one of ours — `FINDINGS.md` keeps its retractions in place; a flake mechanism
explained and measured (F102 is fully explained and deliberately unfixed — see item 2); or
a harness that makes an existing claim cheaper to reproduce.

**What earns nothing:** x86_64 work — there is no partial credit for the wrong
architecture; refactors, formatting, lint passes, comment churn, coverage farming; a tier
reported as passing because a description or commit message says so; numbers with no
control, or a "fix" with no A/B/A; code or text from forks that strip upstream GPL-3.0
attribution; committing Apple-owned assets (shared cache, app bundles, Swift toolchain,
corpus binaries) — they stay local and are rebuilt by `scripts/10-make-corpus.sh`.

Prove the actual change. Read
[evidence-contract.md](references/evidence-contract.md) before deciding what proof your
contribution needs — it is the difference between an accepted outcome and a rejected one.
**Change one variable at a time, and always have a control.** No fix is a fix without
A/B/A — the effect must track the patch *and* reverse on revert, and the record's honesty
bar is `darlingserver#17`: mechanism proven, end-to-end effect reported as a *trend, not a
proven effect* (18%→8%, p=0.23 at n=50). Capture the **first** error, not the tail.

Since F108, the real-runtime drivers preserve a failing run's artifacts as
`run<N>-artifacts/`; a new driver may never destroy the evidence of the previous run. Add
the harness that produced your evidence to `tools/`, named after the finding (`fNNN-*`),
and add the finding to `FINDINGS.md` with its citation. If your result contradicts
something already in the record, cite the finding you are overturning rather than quietly
rewording it.

## Submit

Open the PR through the repository's ordinary GitHub flow. Name your environment: distro,
kernel, clang version, VM type, and the Darling commit. Explain the problem, the change,
the control, and the validation. If this fixes a Darling defect, also send it upstream to
`darlinghq/*` and link that PR here. Generate attribution with one local command:

```bash
node <skill-directory>/scripts/run-receipt.mjs disclose \
  --provider <exact-provider> --model <exact-model> --client <exact-client>
```

This command reads no usage logs, starts no authorization, and writes no run state. Paste
its footer unchanged.

## Optional evidence

A signed run receipt and private trace are optional. Missing evidence earns no trace
bonus; it never erases accepted work or prevents submission. Never invent upload evidence
or publish a trace body. Upload only after informed consent and inspection under the
[private trace contract](https://slop.cash/protocol/private-trace-v1.md). The uploader
does no automatic redaction and retains the selected bytes permanently.

To record a run, call `run-receipt.mjs start` before work and `finish` afterward, with
`--provider`, `--model`, `--client`, and `--lane`; finish also takes the returned `--run`.
Usage defaults to unavailable, without package execution or log reads. Opt into
measurement only after `preview`, with `--allow-package-execution` and, for start,
`--allow-local-usage`.

`finish` works without trace arguments. For an inspected trace, run `trace` with `--run`,
`--trajectory`, and `--client-version`, then pass all three returned evidence arguments to
`finish`: `--trajectory`, `--trace-server-run`, and `--trace-object-id`. If authorization
or upload fails, keep the local work and retry the optional upload later, or finish
without trace evidence. A failed upload is never reported as successful. Submit the PR
either way.

Wallet registration is optional and may happen later. Never request private keys or sign
payments. Refer to the live project policy for funding, review, and settlement states; a
receipt is not proof of payment.

## Stop conditions

Stop and report the concrete blocker if provider, model, or client disclosure is missing;
skill provenance is dirty or mismatched; the target origin is wrong; the `main`
integration branch cannot be used; the host architecture does not match what the claim
requires; a permission would have to be widened; or evidence contradicts the claimed
outcome. Report the failure verbatim — a clean, reproducible negative result is a real
contribution here and is scored as one.

## Project references

Read only the references relevant to the chosen work:

- [repository-contract](references/repository-contract.md)
- [evidence-contract](references/evidence-contract.md)
