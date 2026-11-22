// spec/app/index.md, "Story: Open a page by its address"; spec/app/index.md, "An old address opens the page that replaced it"; spec/frontend/navigation.md, "The browser remembers its requested page independently of authentication"
import "@repo/design-system/fonts";
import { ErrorBoundary, PageAccount, RegistryBootOf, RoutePage, pageRuntime } from "@repo/frontend/app";
import { ManagedRuntime } from "effect";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { canonicalAddress, openingOf } from "./address.ts";
import "./main.css";
import { opened, routes } from "./routes.vibe";

const replaced = canonicalAddress(location.pathname, location.search, location.hash);
if (replaced !== undefined) history.replaceState(history.state, "", replaced);
document.head.querySelectorAll('link[rel="canonical"], meta[property="og:url"]').forEach((served) => served.remove());

const runtime = ManagedRuntime.make(routes);
const { route } = await runtime.runPromise(opened(openingOf(location.pathname, location.search, location.hash)));
const frontend = pageRuntime(route);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App
        runtime={runtime}
        hostname={location.hostname}
        content={(shown, frame) => <RoutePage runtime={frontend} route={shown} frame={frame} />}
        account={<PageAccount runtime={frontend} />}
        registry={(render) => <RegistryBootOf runtime={frontend}>{render}</RegistryBootOf>}
      />
    </ErrorBoundary>
  </StrictMode>,
);
