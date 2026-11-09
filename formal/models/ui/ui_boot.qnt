// @source src/lib/browser-deployment.ts
// @source src/lib/projects.mjs
// @source src/main.tsx
// @source src/ErrorBoundary.tsx
// @source src/lib/project-registry-boot.ts
// @source src/lib/project-registry.runtime.mjs
// Live registry failure may select validated published data; app import failure is distinct.
module ui_boot {
  var s: { phase: str, liveFailed: bool, validRegistry: bool, stale: bool, loadedApp: bool, failedRender: bool }
  action init = s' = { phase: "loading", liveFailed: false, validRegistry: false, stale: false, loadedApp: false, failedRender: false }
  action liveSuccess = all { s.phase == "loading", s' = s.with("validRegistry", true).with("phase", "import") }
  action liveFailure = all { s.phase == "loading", s' = s.with("liveFailed", true).with("phase", "fallback") }
  action fallback = all { s.phase == "fallback", s' = s.with("validRegistry", true).with("stale", true).with("phase", "import") }
  action unavailable = all { s.phase == "fallback", s' = s.with("phase", "import") }
  action importApp = all { s.phase == "import", s' = s.with("loadedApp", true).with("phase", "ready") }
  action importFailure = all { s.phase == "import", s' = s.with("phase", "error") }
  action renderFailure = all { s.loadedApp, s' = s.with("failedRender", true) }
  action step = any { liveSuccess, liveFailure, fallback, unavailable, importApp, importFailure, renderFailure, s' = s }
  val invariant = all { s.stale implies s.liveFailed and s.validRegistry, s.phase == "ready" implies s.loadedApp }
  run cachedRegistryTest = init.then(liveFailure).then(fallback).then(importApp).expect(s.stale)
  run accountWithoutRegistryTest = init.then(liveFailure).then(unavailable).then(importApp).expect(s.loadedApp and not(s.validRegistry))
  run chunkFailureTest = init.then(liveSuccess).then(importFailure).expect(s.phase == "error" and not(s.loadedApp))
}
