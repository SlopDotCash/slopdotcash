# Slop protocol identity migration

This document is the binding migration design for public identities that
predate the Slop name. The migration version is `slop-identity-v1`. It separates
immutable historical interpretation from authority to create a new artifact or
authorize a mutable transition.

## Invariants

- Historical bytes are never rewritten, re-signed, or silently relabeled.
- A legacy identifier can explain an immutable historical record; it cannot
  authorize a new mutable event after activation.
- New writers switch once. They never dual-write Slop and legacy identities.
- Readers identify the schema before validation and apply that schema's exact
  rules. They never accept a value merely because a domain redirects.
- Score-rule names preserve scoring semantics. A rename cannot make two rule
  versions equivalent or change a closed cycle.
- Installer source bytes remain independently authenticated against GitHub.
  Domain compatibility is not a trust root.

## Namespace map

| Artifact | Historical identity accepted for old bytes | Slop identity for new writes |
| --- | --- | --- |
| Contribution marker | `eliza-computer-attribution:v1`, `elizaos-contribution-attribution:v1`, `elizaos-contribution-attribution:v2` | `slop-contribution-attribution:v1` |
| Score rule | `gitarmy-v1` | `slop-score-v1` |
| Wallet marker | `gitarmy-wallet:v1` | `slop-wallet:v1` |
| Advisory review | fenced `gitarmy-review` | fenced `slop-review` with `schemaVersion: "1"` |
| Release-candidate label | `gitarmy-release-candidate` | `slop-release-candidate` |
| Installer authorization receipt | `.gitarmy-authorization.json`, repository `elizaOS/army` | `.slop-authorization.json`, repository `elizaOS/slopdotcash` |
| Local measured-run state | `gitarmy` configuration directory | `slop` configuration directory |
| Public source repository | `elizaOS/army` | `elizaOS/slopdotcash` |
| Compatibility web authority | `eliza.army` | `slop.cash` and `slop.tech` |

## Activation record

Activation is one atomic repository change. It adds an append-only
`protocol/identity-v1.json` record containing:

- `schemaVersion: "1"` and `identityVersion: "slop-identity-v1"`;
- the exact 40-character activation commit;
- the activation UTC timestamp;
- the final legacy score snapshot digest and source cutoff;
- the final accepted legacy release-label event identity;
- the first Slop score rule and writer versions;
- every legacy and Slop identifier in the table above.

The record is invalid unless the named commit contains every new writer,
dual-reader, schema validator, compatibility test, and public document. An
activation record cannot point to its own uncommitted bytes, so the activation
uses two deterministic commits: the first lands all migration code and a hash
of its tree; the second records the first commit and becomes the only activation
boundary. The second commit changes no writer logic.

Until that record exists, readers and writers remain on the current historical
identity set. This avoids an unrecorded partial migration.

## Reader rules after activation

Immutable legacy artifacts remain readable when all of these are true:

1. their bytes validate under the exact historical schema;
2. their source event, snapshot cutoff, cycle source, or installer entry
   receipt predates the activation boundary;
3. their repository and project join is exact;
4. the artifact is not replayed into a new cycle, identity, device, or source;
5. no field asks the reader to grant current mutable authority.

New Slop artifacts validate only under the Slop schema. A legacy marker wrapped
inside a new Slop object is invalid rather than recursively trusted.

Mutable release authorization is stricter. A historical
`gitarmy-release-candidate` label is recognized only when its exact label event
and exact PR-head commit are recorded before activation. Relabeling, force
pushing, restoring, or changing the head after activation removes that legacy
authorization. Only a fresh `slop-release-candidate` event after the exact
current-head event can authorize a new candidate.

## Writer rules after activation

After activation, every shipped writer emits only the Slop identity:

- contributor receipts and final markers;
- wallet-marker UI and documentation;
- reviewer-skill output;
- live score snapshots and new cycle proposals;
- release-candidate instructions and authorization receipts;
- local run-state paths and user-agent names;
- generated manifests, raw source links, and archive provenance.

Writers refuse a configured legacy output name. Compatibility aliases are
reader-only and cannot be selected by an environment variable, manifest, pull
request, or remote response.

## Score and money continuity

Closed cycles keep their original `gitarmy-v1` scoring-rule identity and exact
source bytes forever. The last pre-activation rolling snapshot is frozen by
digest. `slop-score-v1` starts a new live snapshot lineage and declares whether
its scoring semantics are identical or changed; readers do not infer this from
the name. Cross-boundary aggregation deduplicates by immutable GitHub event ID
and replaces a rolling project-month bucket with its closed cycle exactly as it
does today. Activation cannot reopen review, change an allocation, move a
wallet, or increase a cap.

## Verification gates

Activation fails unless tests prove all of the following:

- every historical fixture remains readable and byte-stable;
- every new writer emits no Army, gitarmy, or eliza-computer identity;
- a post-activation legacy label, marker, receipt, or wallet record is rejected;
- current and retained installer versions verify across the repository rename;
- rollback reauthorizes the requested bytes under current GitHub state;
- score, wallet, review, receipt, and cycle joins reject cross-namespace replay;
- generated archives and raw Markdown use `elizaOS/slopdotcash` and Slop public
  authorities;
- production evidence byte-compares both the final legacy snapshot and first
  Slop snapshot to their recorded digests.

The compatibility window has no automatic deletion date. Removing a legacy
reader requires a separate versioned proposal proving that no retained public
artifact still depends on it.
