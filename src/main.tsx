/**
 * Boots the static contribution-compute surface in the browser.
 */

import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "@fontsource/poppins/800.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Deck } from "./Deck";
import { ErrorBoundary } from "./ErrorBoundary";
import "./brand-tokens.css";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("[Slop] #root is missing");
}

const isDeck =
  window.location.hostname === "deck.slop.cash" ||
  window.location.pathname === "/deck" ||
  window.location.pathname.startsWith("/deck/");

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>{isDeck ? <Deck /> : <App />}</ErrorBoundary>
  </StrictMode>,
);
