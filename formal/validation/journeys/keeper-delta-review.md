# Operator keeper source comparison

This comparison covers the two keeper models added after the migration snapshot
at Slop main `8d14a9692b998ee3f4479725b6323125f11f11be`. The retained source
files and their seed-812 test results are indexed in [`main-model-delta.json`](../main-model-delta.json).

| Legacy model | Successor | Transition comparison |
| --- | --- | --- |
| `operator_keeper_rpc.qnt` | [RPC selection](../../../spec/settlement/keeperRpc.md) | `choose`, `resolve` and `preflight` have counterparts. The successor checks exact environments within a chain family and binds preflight to the selected endpoint and request identity. The configuration, signer, budget, project selection, registry, object and journal identities remain stable. Provider unavailability has its own refusal state. |
| `operator_keeper_diagnostics.qnt` | [Reconciliation stages](../../../spec/settlement/keeperScan.md) and [diagnostic projection](../../../spec/settlement/keeperDiagnostics.md) | `begin`, `advance`, `beginReceipt`, `verifiedReceipt`, `indexedReceipt`, `recordFailure` and `complete` map to staged verification. The callback may repeat for additional receipts. `addFixture` and `publish` correspond to classification and a pure aggregation over supplied outcomes. The diagnostic schema contains fixed labels and counts. The prior stage survives failure, and logging does not convert failure into success. |

The directed witnesses cover source scenarios, same-family wrong-chain refusal,
stale preflight and the scan gate that binds the ready RPC observation to the
same keeper, endpoint, selection and reviewed deployment. The scan output feeds
the same typed diagnostic projection as other result rows.
[Directed witnesses](keeper-delta-directed.json)

The simulation and proof report binds each check to the current spec bytes.
[Focused verification](keeper-delta-final.json)

The original bounds of one callback and two result rows are test bounds.
Hosts still need conformance for HTTPS parsing, exact configured chain or cluster
identity, stale callbacks, EVM subclass precedence, exact registry-message
classification, stable JSON sorting, log privacy, fixed private status, and
scheduled exception propagation. Storage and journal behavior need the same
SQLite namespace and retained attempts across an endpoint rotation.
