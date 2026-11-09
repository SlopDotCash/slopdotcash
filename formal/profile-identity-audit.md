# Public profile identity and wallet lookup

This source-only model follows the current-development alignment at
`6c63d6fae`. No runtime behavior changed. The generic resource and public-X
models did not describe the identity selection in `currentProfileActor` or
the wallet lookup key in `useCurrentWallet`.

The profile waits for the ledger, directory and session observation. A known
own membership can supply the member while its public membership lookup is
pending. Otherwise that pending lookup blocks selection. The member, ledger
and directory must not disagree about the requested login or a renamed ID.
A unique directory record can supply an inactive contributor. An unavailable
private membership service does not itself erase an otherwise consistent
public identity. A visitor-entered path alone never supplies an actor ID.

The wallet request uses the resolved numeric GitHub ID. Its result must have
valid bounded metadata and match that ID. The stored lookup key includes the
login and actor, so a cached wallet from an earlier key stays hidden before
the new effect runs. A null claim remains different from an invalid or failed
claim. Effect cleanup prevents a departed reply from updating its successor.
Historical cycle wallets remain a separate, explicitly labelled fallback;
this model does not turn one into a current claim.

`ui_profile_identity` has 20 named scenarios. Fourteen source representatives
cover pending, compatible, absent, renamed and conflicting identity sources;
two immutable actor IDs, two request slots and two component lifetimes bound
the wallet sequence. The model records the identity-source representative at
dispatch and requires that every wallet request came from a selected actor.
Cached ready state needs a completed request with the same actor. Render
visibility separately requires the current actor key.

The source representatives reduce complete ledgers and directories to the
selector's relevant branches. They do not enumerate all possible record
combinations, prove parser correctness, establish live GitHub identity, or
prove wallet control. Response validation is an external predicate. The
existing `tests/e2e/profile-rename.spec.ts` workflows are mapped as conformance
references, not newly executed evidence. No tests, browser, parser, simulator,
verifier or application checks ran for this model.

The direct-transfer hook was also inspected. It has less explicit path gating
than the vault-payment hook, but its current project and profile callers use
keyed or identity-gated parents. No supported same-instance wrong-recipient
trace was established, so that inspection did not justify a runtime change.
