# Direct project funding records

Slop does not receive, control, sign for, or recover project funds. A project
may publish reviewed receiving addresses in `projects/<project>/project.json`.
Transfers go directly from the sender's wallet to the project-controlled
address.

Public evidence is append-only under:

```text
funding/<project>/<network>/<transaction-id>/<record-id>.json
```

Every record uses `project-funding` schema version `1` and binds the exact
project-manifest commit, network, asset, transaction ID, active recipient,
integer minor-unit amount, observation time, attribution choice, finality, and
verifier version. A correction appends a new record that names the prior record
in `supersedes`; committed records are never edited in place.

An authenticated GitHub user reports a transfer by opening a pull request that
adds the first record at this path. The pull request is the public human review;
GitHub authentication identifies the author but does not prove control of the
sending or receiving wallet. Never put private keys, seed phrases, private
wallet metadata, or signing material in a record or pull request.

The public states are deliberately separate:

- `self-reported`: a donor or project supplied the transaction ID; Slop has not
  independently confirmed it.
- `verified-on-chain`: a deterministic network verifier confirmed the exact
  recipient, asset, amount, success, and required finality.
- `disputed`: later evidence conflicts, including a reorg or invalidated
  recipient/asset observation.

Duplicate transactions, wrong recipients, unsupported assets, invalid or
non-final transactions, and broken correction chains fail closed. Verified and
self-reported totals are never added into one displayed number. GitHub identity
and repository authority do not prove control of any wallet.

Project payout plans remain unsigned and are executed outside Slop by the
declared project settler. A transaction signature is only reported evidence;
the cycle remains unpaid until deterministic finalized balance deltas reconcile
every contributor intent. The separately sent 1% platform fee is outstanding
until a signature is reported, reported until the same verification succeeds,
and verified only with finalized exact recipient and amount evidence. Slop does
not deduct, sweep, enforce, sign, or broadcast the fee.
