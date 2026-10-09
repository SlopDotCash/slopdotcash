/**
 * Boots the static contribution-compute surface in the browser.
 */

import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import "./brand-tokens.css";
import "./styles.css";
import "./design-system.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("[Slop] #root is missing");
}

// The fundraising deck was retired on 10 Sep 2026. The reviewed
// deck.slop.cash Pages domain still serves this bundle, so send visitors home.
if (window.location.hostname === "deck.slop.cash") {
  window.location.replace("https://slop.cash/");
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
