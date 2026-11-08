# Local Quint verification

The repository runner translates Quint through the pinned Apalache parser,
then runs TLC. It does not start an Apalache server. Use `formal:verify` or
`scripts/check-formal.mjs --verify` so this transport and its checks apply.

## Confirmed defects

Quint 0.33.1 starts Apalache 0.62.4 with a port but no binding address. A local
process inspection confirmed `TCP *:20507 (LISTEN)` despite the runner's
`localhost:20507` client address. The server also reports the upstream
[protobuf generated-code advisory](https://github.com/protocolbuffers/protobuf/security/advisories/GHSA-h4h5-3hr4-j3g2).
Changing the client address or suppressing that warning does not remove the
listening server. These are verifier concerns, not application dependencies.

The replacement uses Apalache's existing `parse` command with a typed
`.qnt.json` file and a TLA output filename matching the original module. An
explicit empty configuration prevents discovery of user or local config.
Quint's parser, initial-state conversion, postprocessor, TLC configuration and
result handling remain in use. No installed package or shared JAR is edited.

An independent in-process `Cmd.TLA` oracle compared the original RPC command
implementation with this CLI path, without constructing an RPC server. Output
matched byte for byte for `acceptance_run` (4,886 bytes), `ui_review_pool`
(8,177 bytes, nested folds) and `ui_time_boundary` (1,881 bytes, temporal
property). These examples support transport equivalence; they are not a proof
for every future Quint program.

The original RPC command's fold-normalization expression also rewrites matching
text inside TLA strings. A real TLC regression showed that it could accept an
intentionally false invariant after changing its initial string value.
`quint-tla-normalization.mjs` identifies code tokens, preserves strings and
comments, and matches nested LET/IN expressions before moving a fold argument.
The committed literal/fold fixtures distinguish a required initial-state
counterexample from successful checks. Matching the original RPC output alone
would have preserved this defect.

## Tool identity and process lifecycle

The adapter requires Quint 0.33.1 and Apalache 0.62.4. It checks the Apalache JAR
before and after both translation and TLC against SHA-256
`e5223915507b65cc5f1638bd037ede60f8a4fc1644aff46355779f9b05df9262`.
An independent download from the official
[v0.62.4 release](https://github.com/apalache-mc/apalache/releases/tag/v0.62.4)
confirmed this JAR inside `apalache.tgz`, whose archive SHA-256 is
`8ac8488422c30d552735bae11b92a2d014d8e02e8608702acc08f9a2d8a9abb2`.
The runner requires Java 21 and records its version, lockfile, runner, adapter,
normalizer and TLC configuration hashes with the model and source hashes.

The earlier parent-only timeout left a Java child running in an isolated
reproduction. The runner now reuses the browser phase process-group supervisor
for every model stage. Timeout, output limit and caught cancellation fail the
stage and stop its process group. It waits for closed pipes and exited group
members. The parent owns each stage's temporary directory and removes it after
the supervised phase returns. A cleanup failure remains a failed result.
SIGKILL, out-of-memory termination and machine loss of the supervisor itself
are outside this caught-cancellation guarantee.

The local listener probe observed 11 Java process samples and no listening
socket during a complete translated TLC check. Independent timeout and abort
probes confirmed that the test Java descendants exited. Exact commands,
digests, comparison outputs and process evidence belong under ignored
`evidence/`; interrupted earlier runs are not complete passes.

`formal_translation.qnt` models version refusal, parse failure, checking,
cleanup and publication. `formal_process.qnt` models an inherited child,
launcher exit, cancellation, group cleanup and failure reporting. Their bounds
do not establish source refinement or universal operating-system behavior.

The implementation was checked against the pinned upstream
[input format selection](https://github.com/apalache-mc/apalache/blob/v0.62.4/tla-io/src/main/scala/at/forsyte/apalache/io/InputSource.scala),
[parser command](https://github.com/apalache-mc/apalache/blob/v0.62.4/mod-tool/src/main/scala/at/forsyte/apalache/tla/tooling/opt/ParseCmd.scala)
and [RPC command](https://github.com/apalache-mc/apalache/blob/v0.62.4/shai/src/main/scala/at/forsyte/apalache/shai/v1/CmdExecutorService.scala).
