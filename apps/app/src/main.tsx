import "@repo/design-system/fonts";
import { ManagedRuntime } from "effect";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./main.css";
import { routes } from "./routes.vibe";

const runtime = ManagedRuntime.make(routes);

createRoot(document.getElementById("root")!).render(
  <StrictMode><App runtime={runtime} path={location.pathname} search={location.search} /></StrictMode>,
);
