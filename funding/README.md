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
