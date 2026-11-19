// spec/frontend/registry.md, "A page that acts on a project manifest needs a current registry and other pages show the last good registry labelled stale"; spec/frontend/registry.md, "A failed live registry read installs the last published registry labelled stale with its sync time, and both failing shows the error"; spec/frontend/requests.md, "Empty and denied never display retained rows as current data"
import { Alert, Button, Logo, Spinner } from "@repo/ui";
import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import type { RouteKind } from "../../gen/app.ts";
import { type RegistryFreshness, registryBlocked, registryPolicy, staleBannerShown } from "../../gen/frontend__registry.ts";
import { pageOf } from "../../gen/frontend__routes.ts";
import { formatDateTime } from "./format.ts";
import type { Frame } from "./pages.ts";

export type RegistryGateProps = {
  kind: RouteKind;
  freshness: RegistryFreshness | undefined;
  frame: Frame;
  onRetry: () => void;
  children?: ReactNode;
};

export function RegistryGate({ kind, freshness, frame, onRetry, children }: RegistryGateProps) {
  if (freshness === undefined) {
    return (
      <p role="status" aria-label="Loading" title="Loading" className="flex items-center justify-center gap-2 py-12">
        <Logo size="lg" label="" aria-hidden />
        <Spinner aria-hidden />
      </p>
    );
  }
  const policy = registryPolicy(pageOf(kind));
  if (registryBlocked(policy, freshness)) {
    return frame(
      <div className="flex flex-col items-start gap-4">
        <Alert variant="destructive" action={<Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>}>
          {freshness.tag === "RegistryFailed" ? "Projects unavailable" : "This page needs current project data."}
        </Alert>
        <p className="text-sm text-muted-foreground">
          <a href="/login">Sign in</a> · <a href="/account">Account</a>
        </p>
      </div>,
      "Projects are unavailable",
    );
  }
  return (
    <>
      {freshness.tag === "RegistryStale" && staleBannerShown(policy, freshness) ? (
        <aside aria-label="Project data status">
          <Alert
            variant="warn"
            announcement="Polite"
            action={
              <Button variant="ghost" size="icon" aria-label="Try again" title="Try again" onClick={onRetry}>
                <RotateCcw aria-hidden className="size-4" />
              </Button>
            }
          >
            Projects stale · {formatDateTime(freshness.syncedAt)}
          </Alert>
        </aside>
      ) : null}
      {children}
    </>
  );
}
