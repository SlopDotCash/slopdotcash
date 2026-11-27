# Slopbot runtime metadata readback

Development at df21e37b7 reads back the deployed Slopbot Worker's runtime
settings from a protected, main-only workflow step:
`scripts/inspect-slopbot-runtime.ts` and its tests, the readback selection of
`.github/workflows/fee-worker-bindings.yml`, and development's own model
`formal/models/release/slopbot_runtime_metadata.qnt` (commits 09a94cbad,
4431af9bf and 57ff359e1). It makes three fixed TLS reads of the Cloudflare
API for `slop-slopbot`, each with a 20 second timeout, no redirect, no retry
and at most 1 MiB of JSON with `success: true`: the active deployment, its
version, and the deployment again. This machine is one such readback.

What it may keep is five fields: the source commit, the version ID, the CPU
limit, the usage model and whether the deployment stayed the same. It never
keeps a raw response, a binding or a credential, never writes to Cloudflare,
and never widens its selection. Metadata is not evidence of a Paid
entitlement, of readiness, of an import or of any workflow having run.

## Story: Observe the Slopbot runtime only from three agreeing reads of the expected source

### A readback is selected alone, for an exact source, before any credential is used

The credential-free selection step refuses an expected source that is not an
exact lowercase 40-hex commit and a selection that mixes the readback with
fee probes or rotations. Only then are the API authority, the expected
source and TLS checked, and only then does the first read happen.

```quint
type RuntimePhase = Selecting | Authorizing | ReadingDeployment | ReadingVersion | RereadingDeployment
  | RuntimeObserved | RuntimeUnavailable
type UsageModel = Standard | Bundled | Unbound | OtherUsage
type RuntimeReadback = { phase: RuntimePhase, selected: bool, authorized: bool, expectedSource: bool, calls: int,
  deploymentValid: bool, coherent: bool, sourceMatches: bool, cpuMs: int, usage: UsageModel, stable: bool, observed: bool }
pure val maxCpuMs = 300000
pure val maxCalls = 3
pure val initial: RuntimeReadback = { phase: Selecting, selected: false, authorized: false, expectedSource: false, calls: 0,
  deploymentValid: false, coherent: false, sourceMatches: false, cpuMs: 0, usage: OtherUsage, stable: false, observed: false }
pure def validRuntime(cpuMs: int, usage: UsageModel): bool =
  cpuMs >= 1 and cpuMs <= maxCpuMs and (usage == Standard or usage == Bundled or usage == Unbound)
pure def canSelectReadback(r: RuntimeReadback, exactSource: bool, readbackOnly: bool): bool = r.phase == Selecting
pure def selectReadback(r: RuntimeReadback, exactSource: bool, readbackOnly: bool): RuntimeReadback =
  { ...r, selected: exactSource and readbackOnly, phase: if (exactSource and readbackOnly) Authorizing else RuntimeUnavailable }
pure def canAdmit(r: RuntimeReadback, authority: bool, expected: bool, tls: bool): bool = r.phase == Authorizing
pure def admit(r: RuntimeReadback, authority: bool, expected: bool, tls: bool): RuntimeReadback =
  { ...r, authorized: authority, expectedSource: expected,
    phase: if (authority and expected and tls) ReadingDeployment else RuntimeUnavailable }
pure def alwaysNoReadBeforeAdmission(r: RuntimeReadback): bool =
  (r.authorized implies r.selected) and (r.calls > 0 implies r.selected and r.authorized and r.expectedSource)
    and r.calls >= 0 and r.calls <= maxCalls
    and ((r.phase == Selecting or r.phase == Authorizing) implies r.calls == 0 and not(r.authorized))
    and (r.phase == Authorizing implies r.selected)
    and ((r.phase == ReadingDeployment or r.phase == ReadingVersion or r.phase == RereadingDeployment
      or r.phase == RuntimeObserved) implies r.selected and r.authorized and r.expectedSource)
pure def sometimesMixedSelectionRefused(r: RuntimeReadback): bool =
  r.phase == RuntimeUnavailable and not(r.selected) and r.calls == 0
```

### An observation needs one 100% version of the expected source, a valid runtime and an unchanged deployment

Each deployment read must name exactly one version at 100% of traffic. The
version must be coherent with that deployment, carry the expected source in
its `workers/tag`, a CPU limit from 1 to 300,000 ms and the usage model
`standard`, `bundled` or `unbound`. The second deployment read must name the
same deployment and version. Any other answer, a malformed response or a
refused call makes the readback unavailable with no observation.

```quint
pure def reading(r: RuntimeReadback): bool =
  r.phase == ReadingDeployment or r.phase == ReadingVersion or r.phase == RereadingDeployment
pure def canReadDeployment(r: RuntimeReadback, valid: bool): bool = r.phase == ReadingDeployment
pure def readDeployment(r: RuntimeReadback, valid: bool): RuntimeReadback =
  { ...r, calls: 1, deploymentValid: valid, phase: if (valid) ReadingVersion else RuntimeUnavailable }
pure def canReadVersion(r: RuntimeReadback, coherent: bool, matches: bool, cpuMs: int, usage: UsageModel): bool =
  r.phase == ReadingVersion
pure def readVersion(r: RuntimeReadback, coherent: bool, matches: bool, cpuMs: int, usage: UsageModel): RuntimeReadback =
  { ...r, calls: 2, coherent: coherent, sourceMatches: matches, cpuMs: cpuMs, usage: usage,
    phase: if (coherent and matches and validRuntime(cpuMs, usage)) RereadingDeployment else RuntimeUnavailable }
pure def canRereadDeployment(r: RuntimeReadback, valid: bool, unchanged: bool): bool = r.phase == RereadingDeployment
pure def rereadDeployment(r: RuntimeReadback, valid: bool, unchanged: bool): RuntimeReadback =
  { ...r, calls: 3, stable: valid and unchanged, observed: valid and unchanged,
    phase: if (valid and unchanged) RuntimeObserved else RuntimeUnavailable }
pure def canRefuseCall(r: RuntimeReadback): bool = reading(r)
pure def refuseCall(r: RuntimeReadback): RuntimeReadback = { ...r, calls: r.calls + 1, phase: RuntimeUnavailable }
pure def alwaysObservedFromThreeAgreeingReads(r: RuntimeReadback): bool =
  (r.observed iff r.phase == RuntimeObserved)
    and (r.observed implies r.calls == maxCalls and r.deploymentValid and r.coherent and r.sourceMatches
      and validRuntime(r.cpuMs, r.usage) and r.stable)
    and (r.phase == ReadingDeployment implies r.calls == 0)
    and (r.phase == ReadingVersion implies r.calls == 1 and r.deploymentValid)
    and (r.phase == RereadingDeployment implies r.calls == 2 and r.deploymentValid and r.coherent and r.sourceMatches
      and validRuntime(r.cpuMs, r.usage))
pure def stepUnavailableIsFinal(before: RuntimeReadback, after: RuntimeReadback): bool =
  (before.phase == RuntimeUnavailable or before.phase == RuntimeObserved) implies after == before
pure def sometimesObserved(r: RuntimeReadback): bool = r.phase == RuntimeObserved
pure def sometimesWrongSourceRefused(r: RuntimeReadback): bool =
  r.phase == RuntimeUnavailable and r.calls == 2 and not(r.sourceMatches)
pure def sometimesDeploymentDrifted(r: RuntimeReadback): bool =
  r.phase == RuntimeUnavailable and r.calls == maxCalls and not(r.stable)
pure val cpuMsValues = Set(-1, 0, 1, 300000, 300001)
pure val eval_witness_sometimesMixedSelectionRefused = ("selectReadback", true, false)
pure val eval_witness_sometimesWrongSourceRefused = (
  ("selectReadback", true, true),
  ("admit", true, true, true),
  ("readDeployment", true),
  "refuseCall")
pure val eval_witness_sometimesDeploymentDrifted = (
  ("selectReadback", true, true),
  ("admit", true, true, true),
  ("readDeployment", true),
  ("readVersion", true, true, 1, Standard),
  ("rereadDeployment", true, false))
pure val eval_witness_sometimesObserved = (
  ("selectReadback", true, true),
  ("admit", true, true, true),
  ("readDeployment", true),
  ("readVersion", true, true, 1, Standard),
  ("rereadDeployment", true, true))
```
