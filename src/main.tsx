/**
 * Boots the contribution surface in the browser. The project registry lives
 * in D1, so it loads before the app module and its project lookups evaluate.
 */

import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import { type ComponentType, StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./ErrorBoundary";
import {
  installProjectRegistry,
  loadProjectRegistry,
  loadPublishedProjectRegistry,
  type StaleProjectRegistry,
} from "./lib/project-registry-boot";
import "./brand-tokens.css";
import "./styles.css";
import "./design-system.css";
import "./route-design.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("[Slop] #root is missing");
}

type BootState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; App: ComponentType };

function RegistryBoot() {
  const [state, setState] = useState<BootState>({ status: "loading" });
  useEffect(() => {
    let active = true;
    void (async () => {
      let projects: unknown[];
      let registryError: string | undefined;
      let staleRegistry: StaleProjectRegistry | undefined;
      try {
        projects = await loadProjectRegistry();
      } catch {
        try {
          // PRD section 9: keep the last good registry with a stale label.
          const published = await loadPublishedProjectRegistry();
          projects = published.projects;
          staleRegistry = { syncedAt: published.syncedAt };
        } catch {
          // error-policy:J3 no last good registry; project routes show the
          // failure and account routes remain available.
          projects = [];
          registryError = "Project data could not load.";
        }
      }
      if (!active) return;
      globalThis.__SLOP_PROJECT_REGISTRY_ERROR__ = registryError;
      globalThis.__SLOP_PROJECT_REGISTRY_STALE__ = staleRegistry;
      installProjectRegistry(projects);
      try {
        const { App } = await import("./App");
        if (active) setState({ status: "ready", App });
      } catch {
        // A failed app chunk is not a registry outage.
        if (active) setState({ status: "error" });
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  if (state.status === "ready") return <state.App />;
  return (
    <main className="shell route-main boot-state">
      {state.status === "loading" ? (
        <p role="status">Loading projects…</p>
      ) : (
        <div role="alert">
          <h1>Slop could not load.</h1>
          <button
            className="button primary-button"
            onClick={() => window.location.reload()}
            type="button"
          >
            Try again
          </button>
        </div>
      )}
    </main>
  );
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <RegistryBoot />
    </ErrorBoundary>
  </StrictMode>,
);
