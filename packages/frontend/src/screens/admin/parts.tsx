// spec/frontend/navigation.md, "Administration sections and project selection are parameters of the one Administration page"; spec/frontend/requests.md, "Loading, empty, stale, denied, invalid and unavailable remain distinct"
import { Alert, Button, CopyButton, ExternalLink, StatusIcon } from "@repo/ui";
import { Effect, Exit } from "effect";
import type { MouseEvent, ReactNode } from "react";
import { flushSync } from "react-dom";
import type { PageRuntime, PageServices } from "../../app/runtime.vibe";
import { failureMessage } from "../setup/proposal/run.ts";
import { isWebLink } from "./enforcement.ts";

export const page = "mx-auto flex w-full max-w-(--breakpoint-lg) flex-1 flex-col gap-6 px-4 py-8";

export type Acted<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly message: string; readonly accessLost: boolean };

/** Runs one action and settles it as its value, or its message and whether the account lost access. */
export async function act<A, E extends { readonly _tag: string; readonly message: string }>(runtime: PageRuntime, work: Effect.Effect<A, E, PageServices>, lost: (failure: E) => boolean, fallback: string): Promise<Acted<A>> {
  const exit = await runtime.runPromise(Effect.exit(work));
  if (Exit.isSuccess(exit)) return { ok: true, value: exit.value };
  const failure = Exit.findErrorOption(exit);
  if (failure._tag === "None") return { ok: false, message: failureMessage(exit.cause, fallback), accessLost: false };
  return { ok: false, message: failure.value.message === "" ? fallback : failure.value.message, accessLost: lost(failure.value) };
}

/** Shows another view of this page in place, keeping what the page holds, and adds it to the history. */
export function navigateWithin(href: string) {
  history.pushState({}, "", href);
  flushSync(() => dispatchEvent(new PopStateEvent("popstate")));
}

/** Opens another view of this page in place; a modified click opens it as a link does. */
export function openWithin(href: string) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigateWithin(href);
  };
}

export function Waiting({ children }: { children: ReactNode }) {
  return (
    <p aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
      <StatusIcon icon="Spinner" />
      {children}
    </p>
  );
}

export function LoadFailure({ message, onRetry, retryLabel = "Retry" }: { message: string; onRetry: () => void; retryLabel?: string }) {
  return (
    <Alert
      variant="destructive"
      action={
        <Button variant="outline" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      }
    >
      {message}
    </Alert>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-foreground">
      <StatusIcon icon="Check" className="text-ok" />
      {children}
    </p>
  );
}

export function Facts({ children }: { children: ReactNode }) {
  return <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(10rem,auto)_1fr]">{children}</dl>;
}

export function Fact({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-sm text-muted-foreground">{term}</dt>
      <dd className="min-w-0 text-sm break-words text-foreground">{children}</dd>
    </div>
  );
}

export function Identifier({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2">
      <code className="min-w-0 font-mono text-xs break-all">{value}</code>
      <CopyButton text={value} label={`Copy ${label}`} />
    </span>
  );
}

export function Accounts({ accounts }: { accounts: ReadonlyArray<{ readonly githubLogin: string }> }) {
  return (
    <>
      {accounts.map((account, index) => (
        <span key={account.githubLogin}>
          {index > 0 ? ", " : ""}
          <ExternalLink href={`https://github.com/${encodeURIComponent(account.githubLogin)}`}>@{account.githubLogin}</ExternalLink>
        </span>
      ))}
    </>
  );
}

export function Reference({ value }: { value: string }) {
  return isWebLink(value) ? <ExternalLink href={value}>{value}</ExternalLink> : <>{value}</>;
}

export function Subsection({ title, icon, children }: { title: ReactNode; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground [&_svg]:size-4">
        {icon}
        {title}
      </h4>
      {children}
    </section>
  );
}
