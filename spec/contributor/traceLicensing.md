# Trace licensing consent records

Design 2026-11-22, contract version 2 (`private-trace-v2`). A port of main PR #3274 (development copy #3290) for issue #3295. The reference model is `formal/models/api/api_trace_licensing.qnt` on main, cut to contract version 2 here: the model confirms only under `private-trace-v2`, with no confirm-again rule and no reconfirmation. The `terms_version` CHECKs already admit `private-trace-v3`, so a future v3 confirmation needs no further migration. The confirmation version is the latest enabled event's `terms_version`; the confirm-again refusal is handler work, not modelled here. Version 3 belongs to #3326 (PR #3335) and is not ported here. See [Server-side trace run and progress events](./traceServer.md) and the [private trace privacy contract v2](../../apps/contributor/docs/private-trace-v1.md#private-trace-privacy-contract-v2). The product rule is `docs/slop-product-requirements.md`, § Trace licensing, on main.

A contributor licenses Slop traces for pay. Licensing is a separate yes from uploading: upload alone never licenses a trace, and the setting is off by default. By turning licensing on, the contributor confirms that the terms of the model provider used in each run allow them to license that run's output. The contributor receives 50% of what the buyer pays for a sale, split evenly across the traces in that sale. Only a trace joined to a merged or closed pull request whose outcome Slop has recorded may be offered.

The setting is one row per account. Each trace keeps its own licence and an append-only licence history, and every change to the setting writes an append-only account event in the same batch. Migration `0148_trace_licensing.sql` adds `terms_version` to `trace_runs` (v1, v2 or v3, v1 backfill), `trace_licensing_settings`, `trace_licensing_events`, `trace_licences` and `trace_licence_events`, and the inbox kind `trace_licensing_available`.

Not in this port: the handlers behind the routes, the settings section, the one-time notice and the Dafny proof. They are follow-ups listed in the pull request.

## Story: the account setting

The setting is off until the contributor turns it on and confirms the provider terms. Turning it on writes an `enabled` account event, which records the terms version, so the account's confirmation version is the terms version of the latest enabled event; turning it off writes a `disabled` account event with the number of licences withdrawn. A flip to the state already in force writes nothing. Enabling is refused when the account is closed or banned. Disabling is allowed for a banned account. The setting shows on or off and the last change.

## Story: a licence

A run finalizes once. A missing client version reads as v1. A v2 run finalized while the setting is on, and the account is not banned, gets a licence with basis `upload`, written together with its granted event. A banned account never gets an upload licence and never opts in. A v1 run gets no upload licence: it is licensed only when the contributor opts that trace in explicitly, one by one. Opt-in needs the setting on and the account neither closed nor banned. A bulk opt-in whose expected count differs from the eligible count (finalized, not currently licensed) is refused and writes nothing, so a refusal never re-licenses a withdrawn trace. Turning the setting off withdraws every licence with reason `setting_off`. Closing the account withdraws every licence and turns the setting off, writing the `account_closed` event only when the setting was on or a licence existed. Reopening restores neither the setting nor any licence. Banning an account changes no licence and writes no account event: the licences stay, the setting stays on, and the account can still turn it off. A licence exists only where the trace's latest event is a grant (after any withdrawal), the account is not closed and the setting is on.

## Story: the routes

Three signed-in routes, declared in `apps/contributor/src/client/licensing.vibe`:

- `GET /api/v1/traces/me` lists the account's finalized traces with id, state, terms version and current licence, and the setting.
- `PUT /api/v1/traces/licensing` flips the setting and confirms the provider terms. It answers with the setting and the number of licences withdrawn. A flip refused inside the batch answers `setting_changed` when the setting moved under the caller.
- `POST /api/v1/traces/licences` opts traces in, either a chosen list of run ids or every eligible trace with an expected count. It answers with the number licensed. A bulk opt-in whose count moved answers `count_changed`. The opt-in payload is a discriminated union: a chosen list (`kind: "chosen"`, `runIds`) or the whole account (`kind: "all"`, `expectedCount`); the handler must reject a chosen opt-in with more than MAX_RUN_IDS runIds.

The issue writes the setting route as `/api/v1/trace-licensing`; the shipped path on main is `/api/v1/traces/licensing`, and this port uses the shipped path.

The settings section on the Points page under account settings lists the traces with id, state, terms version and current licence, shows the setting on or off and the last change, and includes the provider terms confirmation. The settings section and the handlers behind these routes are follow-ups; this port declares the routes and registers their tables.

## Story: the notice

One inbox notice tells every account with at least one finalized trace, not participation-banned and not closed, that licensing is available. Its event key is `trace-licensing:available-2026-11`, its kind is `trace_licensing_available`, it is sent once, and it links to `/account#trace-licensing`:

"You can now choose to license your Slop traces for pay. You get 50% of each sale. Nothing is licensed unless you turn it on."

The notifier and the hand-run announce script are follow-ups; the migration already admits the kind.

## Quint model

### The setting is one row per account

```quint
// @source migrations/0148_trace_licensing.sql
// @source backend/trace-licensing/handler.ts
// @source src/lib/trace-licensing.ts
// @source src/TraceLicensing.tsx
// @source backend/trace/cloudflare-persistence.ts
// @source backend/trace/handler.ts
// @source backend/points/handler.ts
// @source scripts/announce-trace-licensing.ts
// @evidence backend/trace-licensing/handler.test.ts
// @evidence backend/trace-licensing/upload-licence.test.ts
// @evidence backend/trace-licensing/announce.test.ts
// @evidence backend/trace-licensing/closure.test.ts
// @evidence backend/trace-licensing/migration.test.ts
// @evidence tests/e2e/trace-licensing.spec.ts
// The reference model's enable (v3) and enableUnderV2 collapse into one
// enable here, confirming under v2. A trace version is 1 or 2. A
// confirmation is 0 (never) or 2. A licence state is 0 (none), 1 (licensed)
// or 2 (withdrawn). A licence event is 0 (none), 1 (granted) or 2
// (withdrawn). A licence basis is 0 (none), 1 (upload) or 2 (opt-in).
// wrote is true when the last step wrote an account event.

type Trace = {
  final: bool,
  v: int,
  lic: int,
  ev: int,
  basis: int,
}

type TraceLicensing = {
  on: bool,
  conf: int,
  closed: bool,
  banned: bool,
  traces: int -> Trace,
  wrote: bool,
}

pure val emptyTrace: Trace = { final: false, v: 1, lic: 0, ev: 0, basis: 0 }

pure val empty: TraceLicensing = {
  on: false,
  conf: 0,
  closed: false,
  banned: false,
  traces: Map(1 -> emptyTrace, 2 -> emptyTrace),
  wrote: false,
}

pure def licensedCount(s: TraceLicensing): int =
  s.traces.values().filter(t => t.lic == 1).size()

pure def eligible(s: TraceLicensing, i: int): bool =
  s.traces.contains(i) and s.traces.get(i).final and s.traces.get(i).lic != 1

pure def eligibleCount(s: TraceLicensing): int =
  s.traces.keys().filter(i => eligible(s, i)).size()

pure def withdrawAll(s: TraceLicensing): TraceLicensing =
  s.with("traces", s.traces.mapValues(t =>
    if (t.lic == 1) t.with("lic", 2).with("ev", 2) else t))

```

### A finalized run keeps one permanent exact trace

```quint

pure def finalize(s: TraceLicensing, i: int, v: int): TraceLicensing =
  if (not(s.traces.contains(i)) or s.traces.get(i).final) s.with("wrote", false)
  else if (s.on and not(s.banned) and v == 2)
    s.with("traces", s.traces.set(i, { final: true, v: v, lic: 1, ev: 1, basis: 1 })).with("wrote", false)
  else
    s.with("traces", s.traces.set(i, s.traces.get(i).with("final", true).with("v", v))).with("wrote", false)

```

### Enabling licensing records the setting and withdraws nothing

```quint

pure def enable(s: TraceLicensing): TraceLicensing =
  if (s.closed or s.banned or s.on) s.with("wrote", false)
  else s.with("on", true).with("conf", 2).with("wrote", true)

pure def noopToggle(s: TraceLicensing): TraceLicensing =
  if (s.closed) s.with("wrote", false)
  else s.with("wrote", false)

pure def disable(s: TraceLicensing): TraceLicensing =
  if (s.closed or not(s.on)) s.with("wrote", false)
  else withdrawAll(s.with("on", false).with("wrote", true))

```

### Opting in licences chosen traces, or the whole account

```quint

pure def optIn(s: TraceLicensing, i: int): TraceLicensing =
  if (not(s.on) or s.closed or s.banned or not(eligible(s, i))) s.with("wrote", false)
  else s.with("traces", s.traces.set(i, s.traces.get(i).with("lic", 1).with("ev", 1).with("basis", 2))).with("wrote", true)

pure def optInAll(s: TraceLicensing, expected: int): TraceLicensing =
  if (not(s.on) or s.closed or s.banned or expected != eligibleCount(s) or expected == 0) s.with("wrote", false)
  else s.with("traces", s.traces.keys().mapBy(i =>
    if (eligible(s, i)) s.traces.get(i).with("lic", 1).with("ev", 1).with("basis", 2) else s.traces.get(i))).with("wrote", true)

// A refused bulk opt-in changes nothing and writes nothing: its expected
// count differs from the eligible count, or the setting is off, or the
// account is closed or banned.
pure def optInRefused(s: TraceLicensing, expected: int): TraceLicensing = s

```

### Closing an account withdraws every licence and hides the account

```quint

pure def close(s: TraceLicensing): TraceLicensing =
  if (s.closed) s.with("wrote", false)
  else withdrawAll(s.with("closed", true).with("on", false).with("wrote", s.on or licensedCount(s) > 0))

pure def reopen(s: TraceLicensing): TraceLicensing =
  if (not(s.closed)) s.with("wrote", false)
  else s.with("closed", false).with("wrote", false)

pure def ban(s: TraceLicensing): TraceLicensing =
  if (s.banned) s.with("wrote", false)
  else s.with("banned", true).with("wrote", false)

```

### Every licence is backed by a granted event on a finalized trace

```quint

law lawLicenceBacked(s: TraceLicensing): bool =
  s.traces.values().forall(t => t.lic != 1 or (t.ev == 1 and t.final))

law lawGrantBacked(s: TraceLicensing): bool =
  s.traces.values().forall(t => t.ev != 1 or t.lic == 1)

law lawLicensedNeedsConsent(s: TraceLicensing): bool =
  s.traces.values().forall(t => t.lic != 1 or (s.on and not(s.closed)))

law lawUploadBasisIsV2(s: TraceLicensing): bool =
  s.traces.values().forall(t => t.basis != 1 or t.v == 2)

law lawClosedHoldsNothing(s: TraceLicensing): bool =
  not(s.closed) or (not(s.on) and licensedCount(s) == 0)
```

## Simulation samples

These samples cover both trace versions, both settings, the ban and the close, and the boundaries where a step writes nothing.

### The samples cover both versions, both settings, the ban and the close

```quint
val uploadWhileOnSample = finalize(finalize(enable(empty), 1, 2), 2, 1)
val turnOffWithdrawsSample = optInRefused(disable(finalize(enable(empty), 1, 2)), 1)
val closeWithdrawsSample = reopen(close(finalize(enable(empty), 1, 2)))
val staleCountSample = optInRefused(finalize(finalize(enable(empty), 1, 1), 2, 1), 1)
val staleCountLicensedSample = optInAll(staleCountSample, 2)
val staleCountOptInAllSample = optInAll(finalize(finalize(enable(empty), 1, 1), 2, 1), 1)
val bannedTurnsOffSample = optInRefused(disable(ban(finalize(enable(empty), 1, 2))), 1)
val banKeepsLicenceSample = ban(finalize(enable(empty), 1, 2))
val noopWritesNothingSample = noopToggle(enable(empty))
val closeNothingToWithdrawSample = close(empty)
val closeWithLicenceWritesSample = close(enable(empty))
val optInWritesSample = optIn(finalize(enable(empty), 1, 1), 1)

test uploadWhileOnTest = {
  assert(uploadWhileOnSample.traces.get(1).lic == 1)
  assert(uploadWhileOnSample.traces.get(1).basis == 1)
  assert(uploadWhileOnSample.traces.get(2).lic == 0)
  assert(uploadWhileOnSample.traces.get(2).v == 1)
}

test turnOffWithdrawsTest = {
  assert(turnOffWithdrawsSample.traces.get(1).lic == 2)
  assert(turnOffWithdrawsSample.traces.get(1).ev == 2)
  assert(not(turnOffWithdrawsSample.on))
}

test closeWithdrawsTest = {
  assert(not(closeWithdrawsSample.closed))
  assert(not(closeWithdrawsSample.on))
  assert(closeWithdrawsSample.traces.get(1).lic == 2)
}

test staleCountRefusedTest = {
  assert(licensedCount(staleCountSample) == 0)
  assert(not(staleCountSample.wrote))
  assert(licensedCount(staleCountLicensedSample) == 2)
  assert(staleCountLicensedSample.wrote)
}
test staleCountOptInAllTest = {
  assert(not(staleCountOptInAllSample.wrote))
  assert(licensedCount(staleCountOptInAllSample) == 0)
}

test bannedTurnsOffTest = {
  assert(bannedTurnsOffSample.banned)
  assert(bannedTurnsOffSample.traces.get(1).lic == 2)
}

test banKeepsLicenceTest = {
  assert(banKeepsLicenceSample.traces.get(1).lic == 1)
  assert(banKeepsLicenceSample.on)
  assert(banKeepsLicenceSample.banned)
  assert(not(banKeepsLicenceSample.wrote))
}

test noopWritesNothingTest = {
  assert(not(noopWritesNothingSample.wrote))
  assert(noopWritesNothingSample.on)
}

test closeNothingToWithdrawTest = {
  assert(not(closeNothingToWithdrawSample.wrote))
  assert(closeNothingToWithdrawSample.closed)
}

test closeWithLicenceWritesTest = {
  assert(closeWithLicenceWritesSample.wrote)
  assert(not(closeWithLicenceWritesSample.on))
}

test optInWritesTest = {
  assert(optInWritesSample.wrote)
  assert(optInWritesSample.traces.get(1).lic == 1)
  assert(optInWritesSample.traces.get(1).basis == 2)
}

pure val weight_finalize = 6
pure val weight_enable = 4
pure val weight_noopToggle = 1
pure val weight_disable = 2
pure val weight_optIn = 4
pure val weight_optInAll = 2
pure val weight_optInRefused = 2
pure val weight_close = 2
pure val weight_reopen = 1
pure val weight_ban = 1
```
