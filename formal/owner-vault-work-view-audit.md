# Owner-vault work liveness safety VIEW V1

This is a static candidate for PRD section 11's full trusted main quality gate.
It changes the finite check's representation, not product behavior, funds,
transaction authority, the original model, its seven IDs, actions, scenarios,
sampler, invariants or acceptance requirements. It is not qualified for release.
The original raw 600-second hosted exploration retained 50,131,400 distinct
states and 39,333,320 queued at depth 12. It was incomplete, not a proof or a
counterexample. This candidate does not raise the current 180-second allowance;
a separately reviewed focused diagnostic may use 600 seconds on retained evidence.

## Exact binding and scope

- QNT: `acdadb1e73e178d01c9ac4e3328c0228ff6950a47d0d232def590d96315993d0`
- Complete original TLA: `260030532497e9372369479a7b231515106b4bf73118bc5ee43079abe1de3a64`
- Complete appended VIEW TLA: `8e5c7d1c9cfa30b80d3ff4979d589265ec9898017209ffa668acf90ed26bccad`
- Literal state expression: `dfc13ee095c83777d0778ecdc966ae152d04819f95ce225c52a1a39ffdcb3f1e`

The production translation is from development 7ac9b6e. Its mapped
OwnerVaultSetup.tsx includes PR2570's captured-token formatting and reflow.
That source is different from the older raw-timeout source; no byte-identity
claim is made for that file. The original raw QNT is identical. All four mapped
runtime files are untouched by this candidate:

- `src/OwnerVaultSetup.tsx`: `3debbce1878338cf1e9d7fad4cf537059770b5ecc822f4c40438d1db57694260`
- `src/lib/pending-attempt.ts`: `5a7a4fd958aedbbb8d1c926051decfd60d206e38f7e9997447ca1d7ff5a1e0a0`
- `src/lib/solana-vault-actions.ts`: `8aed25c1187a9da6fe63b315620f3f7cae38f15545520525907a4ea26ab8b3f2`
- `src/lib/use-payout-wallets.ts`: `e5ea6853c0ca309531b7314fd9112abccf83451da5e7ce193760d98e9758c337`

The claimed relation is equality of published invariant truth and labeled
successors on defined typed states. It is a manual source argument, not a
mechanical refinement proof, unbounded theorem, chain correctness claim or
preservation of exact UI strings and historical event-set display. Ordinary
scenarios and the sampler still execute the original concrete model.

## Source argument

The whole original model was read, including early LET expressions, every
writer and every guard. An independent whole-source peer reviewed the proposal
before the literal was prepared.

The output cone error/notice/inputHash has no guard or invariant reader.
The only read of error is an OR into error. All three are canonicalized.
Store and local records remain exact, including id/hash/terms/legacy and all
full-record equality checks. Mounted, global epoch, started, active, connected,
review, prompts, and the actual work-map domain remain exact.

Registered and callbacks have one writer: a successful registerReply adds the
same selected ID to both. The exact difference callbacks minus registered is
retained, including members outside the action ID set. Adding that ID changes
the difference by removing exactly that member. The subset invariant and which
later registration can heal a false member are preserved. Merely retaining the
subset Boolean would be insufficient. No action uses either original set as a
guard or to derive any other field.

A work row remains live for waiting/connect-review-recover,
wallet-check/create, registering/register, and fresh-review, before-send, wallet
or callback with any kind. Every other phase/kind combination is guard-inert
and maps to done. The waiting, wallet-check and registering kinds remain exact;
other kinds have no reader and map to none. Unknown phases/kinds are not assumed
unreachable.

Live rows retain the owns predicate by encoding epoch as the exact global epoch
when mounted, active and equal, otherwise global epoch+1. Inert rows use
epoch+1. A constant zero sentinel would be wrong at the defined global epoch0
false prefix. Only begin/beginRegister can select a row as active; both replace
the whole row and epoch. Depart/changeChoice/remount clear active, and remount
also changes epoch. Thus an old unowned row cannot regain ownership without
replacement. Unknown/inert rows can still be reset by begin: begin has no old
phase guard, so that case is explicitly included.

Wallet/callback captures remain complete even when unowned: walletReply and
callbackSettled can update storage after departure. Valid registering captures
also remain complete for the store equality guard. Other captures are replaced
by empty only while a separate RAW indexed prompt implication is retained for
every actual work-map key. It is computed before masking, in all phases.
Begin and beginRegister may make that implication false by replacing a row;
successful send writes the selected ID and can heal it. BeginRegister may capture
an existing legacy record whose ID differs from the selected action ID. The
new raw observation is recomputed from that actual assigned record.

Connect/review replies preserve their distinct kind guard and owns result.
Wallet checks and fresh review preserve phase/owns; send preserves exact
store/local guards and overwrites capture with its fresh reservation. Wallet
reply retains all late hash/refusal/unknown/storage-failure branches. Register
reply retains full equality, owns and its exact subset-difference update.
Callback settle retains late full-record storage clearing; callback failure
changes only phase and the output error cone. Remount, user confirmation and
legacy loading retain every full-record value and guard. No monetary, signer,
receipt, prompt, acknowledgement or submission precondition is removed.

## Controls and execution limits

The added controller uses a fresh full production translation, checks its exact
pin, then changes only q_init/q_step/q_inv aliases and appends fixture helpers.
It verifies that reversing those alias edits restores the full original module.
Every fixture uses the same pinned adapter and actual complete 80-equals
terminator; no four-equals synthetic module stands in for production parsing.

Source controls include lower/upper/global false-prefix bounds, empty-record
false/healing, exact missing callback members including out-of-domain IDs,
indexed prompts in unused/done and actual map keys, epoch0 ownership, live kinds,
full capture/legacy/terms/hash mismatches, future consumer refusal and actual
late wallet/callback, begin/reset, registration, send and stale-review actions.
RAW/VIEW positive pairs require successful completion with an empty queue and
specified final state counts. The parser uses the last counts, so an early
progress line cannot satisfy a different expected terminal count. Negative controls require a later counterexample and
reject initial-state violation or a parser/resource error. The quotient pairs
require two raw states and one VIEW class. These are test source obligations;
none of the native callbacks has been executed in this static packet.

A single bounded translation-only capture completed in 14.883 seconds with TLC
intercepted before SANY. All 2169 tracked and 531 used tool/binary hashes stayed
stable. The owned process group and temporary directory were audited absent.
The capture is not a model proof. SANY, native controls, ordinary checks and the
full finite graph remain pending reviewed hosted execution. A successful static
apply verifies only exact whole-module assembly, not parsing or exploration.

## Static controller ordering correction

Independent packet review caught fixture helpers inserted at q_init after q_inv.
The controller now inserts all shared predicates and the base record before
q_inv, after the unchanged init, empty and unused dependencies. q_init and
q_step can then use already-defined names. Original action definitions and
the complete production translation remain identical, and reversal of the
three alias replacements still recovers every original byte. No SANY or native
execution is claimed for this source-only correction.

## Static outside-ID correction

Independent whole-source review found that active=0 clearing can re-own a
previously unowned work[0] on a defined map containing that key. The projection
now retains every row whose key is outside the original ids set in full,
including epoch/kind/phase/captured. Only the seven declared action-ID rows
are normalized. This conservative rule preserves all actual map domains and
avoids assuming that extra keys are absent or that global invariant truth
proves a domain premise. A new RAW/VIEW four-state control retains two such
predecessors and their original changeChoice successors. It is defined but
unexecuted; the original QNT, step choices and domains remain unchanged.
