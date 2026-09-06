# Signer access attestations

This is the read-only authentication component of #333. It verifies an exact
report against an already reviewed monthly Squads instrument. It does not
publish a commitment as accessible, activate payments, merge evidence into the
funding ledger, change an allocation, or authorize a transaction. Those remain
blocked until the append-only lifecycle integration described below is reviewed.

## Authority and evidence

`scripts/verify-signer-access.ts` implements `slop-signer-access:v1`. The
attesters are the instrument's numeric `funderActorId` and its independently
reviewed `stewardGithub.actorId` plus immutable node ID, not a display login,
commit author email, model judgment, or project owner substituted for a signer.
Each role binds its exact reviewed Solana member key. The manifest revision must
already be an ancestor of the operator's fetched `origin/develop`; proposed
head manifests do not establish authority. Fetch current GitHub before use.

Reports bind project, manifest SHA, monthly cycle, complete instrument identity,
role, actor ID, member key, capability, canonical UTC report time, expiry,
bounded public reason, member signature, source repository, and source commit.
The CLI accepts only a bounded regular canonical JSON file; duplicate keys,
extra fields, malformed timestamps, future reports, and altered authority fail.

Both report types require a publicly readable GitHub commit whose verified
signature belongs to the reviewed actor. The exact commit message is returned
by `signerAccessCommitMessage`. It binds all report fields except its own commit
SHA, which cannot be included recursively. GitHub's verified-signature state,
immutable signer identity, exact commit ID, and complete message must agree.
The GitHub signing credential is separate from the Squads member key.

- `lost-access` requires a public reason, `expiresAt: null`, and
  `memberSignature: null`. Authentication does not require the key that was lost.
- `can-sign` additionally requires an Ed25519 signature by the reviewed member
  over the exact UTF-8 bytes returned by `signerCapabilityMessage`. This message
  is domain-separated from transactions and expressly denies payment authority.
  It excludes only its own detached signature and the source commit SHA. The
  signature is canonical padded base64. Positive reports have a maximum
  24-hour lifetime; verification of a historical report is not a claim that
  its capability is still current.

Member proofs use lockfile-pinned Noble Curves strict verification
(`zip215: false`), not permissive consensus verification. A regression covers
identity-point forgeries accepted by Node's native verifier. See the library's
[strict verification contract](https://github.com/paulmillr/noble-curves/tree/2.4.0#consensus-friendliness-vs-e-voting).
Production code imports verification only. Tests generate disposable synthetic
keys; no production key or signer identity is created by this implementation.

## Operator use

The signer uses an external client to obtain the canonical message, optionally
sign the capability message with their existing member key, then create the
GitHub-signed commit with the exact report message. Only the final public report
and public proof are supplied to Slop. Never include private keys, seed phrases,
credentials, private wallet metadata, or private repository contents.

After fetching trusted `develop`, run from the repository root:

```bash
bun install --frozen-lockfile --ignore-scripts
bun scripts/verify-signer-access.ts <reviewed-manifest-sha> <report.json>
```

The command performs read-only Git/GitHub queries and signature verification.
Its output says `paymentAuthorized: false`. A positive result authenticates one
signer's historical report, not both signers, current on-chain configuration,
instrument balance, legal ownership, or a transferable payment approval.

## Lifecycle integration still required before activation

Reports are stored as canonical JSON at
`funding/<project>/signer-access/<sha256-of-canonical-report-bytes>.json`.
The trusted funding PR gate reads the complete proposed Git tree with
`scripts/check-signer-access-transitions.ts`, requires every accepted base blob
to survive unchanged, and authenticates every report against a manifest already
reviewed in the trusted base history. Symlinks, duplicate source commits,
noncanonical bytes, and missing GitHub authority fail the whole read. Working
tree bytes cannot replace committed evidence. `funding:check` performs offline
structural validation only; it is not proof of signer authentication.
Trusted publication reauthenticates the committed history. Before preparing a
new Squads-backed settlement plan, the command fetches current `develop`, reads
its complete history, and requires both current member proofs. This check uses
the actual evaluation time, not the caller's plan timestamp. Lost or expired
capability blocks new plans, but this necessary check does not activate payment,
prove backing, revoke an existing external signature, or replace settlement
reconciliation. The immutable hold overlay and carry integration below remain
required.

The diagnostic reducer accepts only a complete ledger authenticated in-process,
not a caller-selected pair of positive reports. Loss by either signer is
terminal for that instrument; later capability reports cannot undo it. Its
`both-signers-current` result is explicitly not an `accessible` or payable claim.
At the exact expiry timestamp a positive report ceases to count. Positive
accessibility requires both unexpired member proofs plus independently verified
instrument configuration and backing. Expiry returns positive evidence to
unknown, never silently extends it.

Loss must publish the exact reason and instrument/cycle identity and block new
settlement plans for that funding basis. Proposed rows may be held through an
explicit reviewed transition. Approved, scheduled, partially settled, and paid
history must stay immutable: an append-only hold overlay must reconcile exact
remaining principal and prevent both an old intent and a successor cycle from
paying it. Only eligible shared-pool principal carries, exactly once; review
budget does not carry. The successor monthly cycle requires a fresh instrument.

The current unsigned execution-plan schema does not bind `sourceOwner` to the
frozen funding instrument or record a signed transaction's lifetime, nonce, or
Squads proposal retirement. Consequently an issued or partially settled plan
cannot become carry merely because a signer reports loss or time passes.
[Solana durable nonces](https://solana.com/developers/cookbook/transactions/confirmation)
can outlive ordinary blockhash expiration. A reviewed retirement/reconciliation
protocol must establish the exact remaining principal and prevent execution
through both old and successor intents before this carry path can open. No
such retirement proof is implemented here; existing plans and paid history
remain unchanged and this acceptance gate remains unresolved.

Until those gates, complete public readback, and settlement/carry regressions
are in place, the existing `unknown` accessibility and disabled-payment policy
remain unchanged. #333 is not closed by authentication alone. There is no
unilateral recovery, refund, key rotation, signing, broadcasting, or money
movement in this component.
