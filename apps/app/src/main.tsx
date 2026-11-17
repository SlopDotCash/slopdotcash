// spec/app/index.md, "Story: Open a page by its address"; spec/frontend/navigation.md, "The browser remembers its requested page independently of authentication"
import "@repo/design-system/fonts";
import { ErrorBoundary, PageAccount, RoutePage, pageRuntime } from "@repo/frontend/app";
import { ManagedRuntime } from "effect";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initial, step } from "../gen/app.ts";
import { App } from "./App.tsx";
import { openingOf } from "./address.ts";
import "./main.css";
import { routes } from "./routes.vibe";

const runtime = ManagedRuntime.make(routes);
const frontend = pageRuntime(step(initial, openingOf(location.pathname, location.search, location.hash)).route);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App
        runtime={runtime}
        path={location.pathname}
        search={location.search}
        hash={location.hash}
        hostname={location.hostname}
        content={(route, frame) => <RoutePage runtime={frontend} route={route} frame={frame} />}
        account={<PageAccount runtime={frontend} />}
      />
    </ErrorBoundary>
  </StrictMode>,
);
