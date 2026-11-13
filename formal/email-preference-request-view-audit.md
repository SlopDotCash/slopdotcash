### Email preference request safety VIEW experiment

PRD section 12, STATE-05 requires complete finite safety exploration. The
concrete `ui_email_preference_requests` model exceeded its 600-second allowance
with branch-local nondeterminism. This isolated experiment adds a source-bound
TLC VIEW; it changes no model, ordinary action, domain, invariant, named
scenario, runtime source, temporal property or constraint. Its state count is a
quotient count, not the count of complete UI model records.

The observation retains exact generation, life, mounted state, global actor and
cookie, busy/checking/editing, request phases, publication slot and all four
counters. The six bound predicates therefore remain exact. It computes each
request's original `accepted => cookie = actor` truth, including false truth
classes. For the currently indexed publication slot, it also retains the
request generation, the original observed-actor equality and the original
`kind = read or accepted` truth. Mounted state, current generation and the
publication-generation snapshot complete every original publication conjunct.
These observations are retained for any indexed slot, including hypothetical
invalid nonterminal slots; no assumption that publication already satisfies the
invariant is used. Publication generation is erased only while publication is
zero, when no action reads it before replacement.

The following dependency closure is erased together:

| State | Remaining concrete uses | Reason the observation is unchanged |
| --- | --- | --- |
| `draft` | Writes and copies, including draft preservation after errors | No guard or invariant reads it. |
| `key` | Writes and copies, including verification and retry | No guard or invariant reads it. |
| `enabled` and every request `target` | Begin captures enabled into target; a save writes target into enabled | This entire feedback cone has no guard or invariant consumer. |
| `verificationPending` and `error` | Writes only | No guard or invariant reads them. |
| Non-ready `view` labels | Only the comparison `view = ready` is read | Ready remains distinct; every other label has the same successors after projection. |

Editing is retained because it guards `editDraft`. With draft erased, enabled
edit actions are stuttering transitions; the original step already includes
an explicit stuttering action. No browser storage or cookie is rewritten by
this VIEW. The model has no storage adapter: drafts, verification/retry state
and error messages are only abstract component output. Exact output values and
browser persistence are not claims of this reduced safety graph. Global cookie
and every live captured cookie that can affect admission remain exact.

Unused and done requests retain phase, authentication truth and any currently
indexed publication observations; their other payload is erased. Done slots
cannot restart or continue. Unused slots can only begin a request, replacing
its entire record. Begin enabledness reads the retained phase and global state,
not the erased payload. Publication observations for an unused slot remain
available even in a false class; a begin replaces them with the newly known
record. Other slots never read a terminal request payload. Global changes can
clear or replace publication, but cannot silently consume erased terminal data.

Active records keep kind, actor, generation and acceptance exact. Their
remaining phase liveness is:

| Request data | Retained phases | Continuation argument |
| --- | --- | --- |
| Captured cookie | pre, pre-wait, pre-observed, pre-returned, http | Preflight can change a read's actor to zero, so the raw cookie is needed even when its current authentication clause is false. HTTP acceptance reads both nonzero and actor-equality guards. Dispatch overwrites cookie from the exact global cookie. After HTTP, actor and cookie never change; the original authentication truth suffices. |
| Observed actor | pre/post/failure observed and returned phases | Return copies the observation; use compares its exact value. A new observe overwrites it before a later use. The publication equality is retained separately even outside these phases. |
| HTTP status | body and post/post-wait/post-observed/post-returned | Save's 200 and verification's 202 remain separate from other statuses. Other statuses take the same failure branch. Read ignores stored status after HTTP. Failure's 429 distinction writes only erased error text. |
| Target | None | It belongs entirely to the erased enabled/target feedback cone. |

For two states with the same observation, every concrete guard has the same
answer, apart from actions that change only erased outputs and already have a
matching explicit stutter. Request begin, preflight, dispatch, accepted HTTP,
body, postflight, failure, departure and remount successors have the same next
observation. The publication tuple preserves both true and false classes while
another action changes a slot or replaces/clears the selected publication.
Authentication truth survives copies; acceptance sets it true under the exact
cookie guard; actor-to-zero preflight retains its raw cookie. All erased values
are either overwritten before a consumer or affect only their erased output
closure. This is the manual projected-successor argument, not a machine-checked
refinement theorem.

The descriptor and hardcoded loader bind exact model, translated TLA and final
VIEW SHA-256 values, plus the pinned official adapter. The narrow source guard
binds the schema, finite domains, every helper/action/step and invariant.
Mutants for new output reads, terminal reuse, cross-slot reads, cookie/status
reads and early observation consumption require renewed review. Native tiny
TLA controls use the real pinned TLC runner and the reviewed expression. Each
checks one named property alone: all original bounds, accepted-cookie truth
and its false-to-true repair, preflight false authentication before actor-zero,
both HTTP cookie guards, every active observation boundary, save/verification
status classes, publication mounted/generation/indexed generation, observation
and kind/acceptance, including false-class repairs. These controls test the
adapter and observation; they do not establish application conformance.

Full-graph completion remains pending until the frozen run finishes with an
empty queue. Earlier timeouts remain incomplete. No sampling result, timeout,
manual argument or passing native fixture substitutes for that completion;
no liveness or implementation-refinement claim is made.
