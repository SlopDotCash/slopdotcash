# EVM binding consent terminal safety VIEW

This PRD section 12 / STATE-05 source-only experiment starts at
`dabd9d893d2b323746128496d65c49daee308aab`. It changes TLC safety fingerprints
only. The complete concrete model, initializer, helpers, step, domains,
invariant, scenarios, mapped runtime files and resource allowances are unchanged.
No signing, deployment, credentials, network calls or payment behavior changes.

The retained raw 600-second probe at `3be11937ad34b0ffb09d9604a89dca1accc22d33`
(run 43112962636) was incomplete: last progress was 335,566,763 generated,
90,967,774 distinct, 47,520,619 queued and depth 12. Its receipt records exit 1,
the 600,000 ms deadline and unchanged inputs, without a counterexample. The QNT
and all four mapped runtime-source hashes match this packet. It used the raw
concrete step without a VIEW. This resource history is neither a passing proof
nor qualification of the new quotient; the raw graph is not rerun here.

## Exact observation and invariant reconstruction

All globals, including configured state, clock and effective claim, stay exact.
The entire set of stored consent records stays exact: exists, claim, deployment,
version, expiry, signature and created timestamp. In particular, positive
signatures and timestamps are never normalized. Two records with one key but
different signatures or creation timestamps remain different set members and
must still violate the original uniqueness clause. The original stored fold,
including its behavior on hypothetical duplicate/invalid rows, is unchanged.

Request offset and response are globally write-only and normalize to zero and
none. Begin uses its original offset argument to compute expiry; binding reads
expiry minus stamp, never the stored offset field. Respond writes response but
nothing consumes it under step or invariant. The unchanged direct scenarios
continue to inspect their full raw records. The VIEW makes no exact HTTP-output
or diagnostic-output claim.

All other active or unknown-phase request fields remain raw. Only unused,
response and done requests become this ordered tuple, computed before masking:

1. Exact phase.
2. Raw inserted flag.
3. Raw verified flag.
4. Whether raw desired equals 200-authorized.
5. Exact snapshot/deployment/version/expiry key if inserted or desired-authorized;
   otherwise a fixed four-zero tuple.
6. Raw discoveryCalls <= 1.
7. Raw discoveryCalls == 1 implies challenge mode and suppliedVersion == -1.
8. Raw verified implies authorize mode, snapshot == claim, expiry > stamp + 600
   and expiry <= stamp + upper.
9. Raw desired == 200-challenge implies not inserted and expiry == stamp + lifetime.

The four local clauses remain four separate truth values, including every false
class. They depend only on captured request fields and fixed model constants.
No later global update can change them. The inserted and desired-authorized
clauses remain dynamic: exact rows and the retained key reconstruct the original
stored fold; raw verified supplies the other authorization operand. They are
never frozen into terminal truth bits. A later configure can replace all rows,
and another slot's insert can add a matching row; either operation can heal or
break an old obligation while an unrelated local clause stays false. Those
changes remain observable. No invariant is assumed true, and no uniqueness or
valid-signature assumption is used to project rows or lookups.

The global clock/effective/row-count/row-uniqueness clauses remain functions of
raw globals. Local discovery/verified/challenge clauses use their retained raw
truths for terminal slots and full records for live slots. Dynamic stored
obligations use the exact key/rows/flags. Thus related states have the same
complete original invariant truth, including false local and global prefixes.

## Every action and same-parameter successor

| Action | Retained guard and update dependencies |
| --- | --- |
| Configure | Reads exact configured state and the same seed domain. It replaces exact rows, not terminal captures. Dynamic obligations are recomputed through their exact keys and new rows, including false/healing states. |
| Advance, replaceEffective | All read/write globals stay exact; returned captures and local observations carry. |
| Begin | Requires configured and exact unused phase with the unchanged input domains. It replaces the entire record from idle, so old payload and dirty observations cannot survive. The new live record is exactly determined by the original arguments and exact clock. Inserted/verified/desired-authorized reset false; all four local clauses become true. |
| Body | Live body records are exact except the two write-only fields. The original mode/version/input predicate selects the same successor. An early response tuple is computed from the raw carried record. |
| Deployments | Live phase, original deployment class, chosen deployment and rejection label are unchanged. No erased output becomes a guard. |
| Read wallet | Exact captured claim, current effective claim and both original boolean inputs determine the same eligibility/read result and snapshot. |
| Supplied/discovered version | Phase, mode and suppliedVersion remain exact until consumed. Discovery overwrites its count with one exactly as before; every terminal local bit is computed from the actual source values. |
| Binding | Exact mode, expiry and captured clock determine its original margin/slack checks. Challenge sets the same expiry; the unused stored offset has no consumer. |
| Signature | Exact live operands, original signature class and normalized representative determine the same verified flag/signature or refusal. |
| Insert | Exact live request and exact row set feed the original stored fold, same-key check and added predicate. New rows preserve the original signature/timestamp. Existing rows and duplicates are never canonicalized. Other terminal obligations are recomputed from the resulting rows. |
| Insert failure, write reply | Exact live phase and received input select the same carried record. No committed row is rolled back after a lost reply. |
| Readback | Exact live key and exact retained row/signature feed the original result, including missing, invalid, duplicate and failed-read cases. Raw verified and stored key remain available in a new desired-authorized terminal tuple. |
| Respond | Only response phase is enabled. It changes phase to done and writes erased response from desired/delivered. All retained flags/key/local observations carry unchanged; full desired is not otherwise consumed. |
| Explicit stutter | Leaves the entire observation unchanged. |

Done is absorbing; response has only respond; unused has only a full-reset begin.
No other slot consumes a terminal request's payload. Stored rows are the only
cross-slot information and remain raw. If no inserted/authorized obligation is
present, a key cannot gain a future consumer before unused begin overwrites it;
response/done cannot insert, read back or become authorized. Every live-to-terminal
transition computes its tuple from exact consumed source operands. Consequently
related raw states enable the same original action/parameter tuples and produce
the same projected successors, including hypothetical false invariant prefixes.

This is a manual finite safety-quotient argument, not a mechanically checked
congruence or implementation-refinement theorem. No domains, guards, actions,
scenarios, bounds or invariant clauses are narrowed. It claims no liveness,
unbounded behavior, byte/cryptographic proof, fresh live authority, on-chain
binding, executor eligibility, signing or payment acceptance.

## Exact binding and source-only controls

The hardcoded helper and matching descriptor pin the complete QNT, actual full
production TLA, final loader-produced VIEW and official TLC adapter. Actual
bindSafetyView/applySafetyView validate the complete production configuration;
the whole concrete body and full 80-character module terminator are preserved.
Unknown definitions, source/translation/expression/adapter changes and temporal
properties fail closed. The full-file model guard also includes all helpers,
domains, step branches, initializer, invariant and direct scenarios.

The QNT SHA-256 is
`77a1f212e49842ff9698118bd7de9aff3434c30add74e1da73f0a605339bcd19`.
The full production TLA SHA-256 is
`2fe12833903aee5460e0a41769c2531a1b16651c159314801fb98cc9d5b9bbb0`.
Actual loader application produces final VIEW SHA-256
`e5e8218513c4e3d606773c99e5f5f525a2098ab5b3917be552a38354a4f55da3`.
These are source/translation bindings, not passing native or graph receipts.

Source gate mutants cover reuse, new terminal/cross-slot/output consumers,
changed stored keys, row normalization, configure replacement and begin reset.
Under the native flag, controls freshly capture the complete pinned production
translation and validate actual loader application before deriving fixtures.
They keep every production definition intact and replace only test init/step/
invariant aliases, inserting helper predicates and dirty initial records before
first use. Reversing those harness replacements must restore the original full
translation byte for byte. All stored checks use the actual production stored
operator; they do not substitute an existential lookup or assume unique rows.

The 54 observation controls cover each of the four raw clauses and false/healing
classes; exact terminal flags/key and dynamic stored existence/signature;
clock/effective/row-count bounds; same-key duplicates differing only in signature
or created timestamp while another local clause is false; and every live input.
Each named negative property stands alone and requires a noninitial State 2
counterexample. An unrelated false original invariant cannot satisfy it.

Seven additional controls call actual production begin, insert, readback,
respond and configure actions. They check dirty unused full reset; same-key
signature/timestamp retention while a local clause is false; other-slot insert
healing a stored obligation while discovery remains false; authorized readback;
respond carrying a false local clause and dynamic key; and configure healing or
breaking an inserted obligation while another clause remains false. Their named
reachability witnesses alone are checked, with State 2 and no initial violation.

Four raw-two/view-one pairs use q_inv TRUE and require exact state counts. They
vary active write-only outputs, terminal dead payload with no stored obligation,
already-false verified-clause payload, and already-false challenge/stored payload.
They deliberately include false original classes without trusting invariant truth.
These controls test observation sensitivity and loader behavior, not a general
machine-checked proof of successor congruence.

All three repository inventories are regenerated, with checks repeated after
the frozen source commit. Integration must regenerate them for its combined
source. Ignored evidence records actual translation/application, source/tool and
binary hashes, and retained historical receipts separately. Native controls,
ordinary scenarios/sampling and full exploration remain held until actual review
and the coordinated hosted diagnostic. Timeout or cancellation is incomplete;
any completed graph describes this quotient, not a count of raw states.
