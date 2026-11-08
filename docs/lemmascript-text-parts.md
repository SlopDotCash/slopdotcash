# Complete inventory text partitioning

This follow-up starts at review-batching commit `a9117b6cb` and verifies the
actual text splitter used by repository acquisition and oversized review
items. PRD section 8 requires complete inspected content without a repository
size cap. No model, admission, size or permission policy changes.

## Runtime and theorem

`bounded-scan.ts:textParts` retains its original `Buffer.from(text)` conversion
and its single-part early return. For a larger input it consumes the exact end
positions returned by `textPartEnds`, then constructs the original native
UTF-8 string parts from contiguous buffer views.

The two new production functions in `verified-text-parts.ts` prove:

- Every selected end is strictly after the start, no farther than the byte
  array end, and within the requested width.
- The selected position equals the defined existing policy: take the full
  window; prefer its last newline strictly after the start; then back up over
  UTF-8 continuation bytes while retaining the original one-byte fallback.
- The complete list has strictly increasing ends, finishes at the full input
  length and uses that same policy at every step. Consecutive parts therefore
  cover every input byte exactly once, with no gaps, overlap or reordering.
- An empty byte sequence has no generated ends. The public wrapper still
  returns the original one-element string array for an empty/small input.

`PartMatches` contains the exact end equality and positive width bound in one
well-formed predicate. Its guarded start range lets the compiler check every
call to the partial end-selection definition. The separate proof block also
establishes the width property for all emitted parts. This avoids relying on
the order of repeated postcondition declarations; the bound is retained.

The pinned check passes 205 isolated obligations with zero errors. Generated
method headers and executable bodies are unchanged. Additional definitions
and proof blocks are checked; no assumptions or external function axioms are
used. The integrity gate checks both selected runtime functions.

## Preserved byte and input boundaries

The theorem describes the original cut policy, not an arbitrary byte decoder.
Native `Buffer.from` and `Buffer.toString` remain runtime boundaries. For real
UTF-8 input and the production widths, cuts preserve complete characters.
The legacy fallback for very small widths, and native replacement of lone
surrogates during encoding, are deliberately preserved; this change does not
claim arbitrary malformed bytes or width-one decoding is lossless Unicode.

The contract requires a positive integer width. Actual direct inventory
calls use the 256 KiB constant. Review batches calculate an integer width
from a limit of at least 300,000 bytes and their envelope framing. Source tree
paths are bounded to 1,024 characters by acquisition; captured filesystem
paths are bounded to 2,048 UTF-8 bytes. Their generated item suffixes fit the
existing framing allowance. Those source/schema boundaries, native buffer
lengths and the fixed batch limits keep index arithmetic exact in JavaScript.
The proof does not assert termination for invalid zero/negative widths passed
to the exported wrapper by arbitrary external JavaScript.

The newline search now stops at the current part's start. The old native
`lastIndexOf` searched the entire earlier prefix even though a newline there
could not affect this part. Both choose the same end. This bounds each search
to the relevant window and removes repeated scans of old content.

## Evidence and measured cost

Bun 1.3.14, Node 24.15.0, LemmaScript 0.6.6 and Dafny 4.11.0 were pinned.
The existing complete review-planner workflow passes 15 tests and 1,388
assertions with zero failures. It includes oversized files, full review
coverage, spillover aliases, exact serialized limits, failed calls and cached
recovery. Provider responses are controlled, not live model-quality evidence.
Full type checking passes.

Differential checks match 4,000 arbitrary byte/width end lists and 1,500
Unicode/text-part outputs against the original code. Cases include newlines,
continuation bytes, all byte values, surrogate pairs, lone surrogates, empty
inputs and widths from one through 150. Complete large outputs also match
before/after timing runs.

Two warmups and seven alternating timing pairs used 64 KiB parts. Median
milliseconds for the actual public text splitter were:

| Input | Before | After |
| --- | ---: | ---: |
| 1 MiB without newlines | 0.362 | 0.437 |
| 16 MiB without newlines | 49.270 | 16.478 |
| About 16 MiB with frequent newlines | 1.214 | 0.983 |
| Repeated Unicode lines | 2.270 | 2.317 |

These are host measurements, not a general production latency guarantee.
The descriptor array adds a small allocation, and smaller/no-newline input
has measurable overhead. Large newline-free input benefits from no longer
rescanning the earlier prefix. Logs, hashes and raw samples remain ignored
under `evidence/text-parts/`.

```sh
lsc check --backend=dafny --time-limit=30 --extra-flags=--isolate-assertions \
  workers/vetting/verified-text-parts.ts
bun test --timeout 30000 workers/vetting/review-plan.test.ts
bun run typecheck
```
