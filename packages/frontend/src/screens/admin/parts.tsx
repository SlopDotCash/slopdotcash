// spec/frontend/navigation.md, "Administration sections and project selection are parameters of the one Administration page"; spec/frontend/requests.md, "Loading, empty, stale, denied, invalid and unavailable remain distinct"
import { Alert, Button, CopyButton, cn, ExternalLink, StatusIcon, type StatusProps } from "@repo/ui";
import { Effect, Exit } from "effect";
import type { MouseEvent, ReactNode } from "react";
import { pageShellClass } from "../../app/PageShell.tsx";
import type { PageRuntime, PageServices } from "../../app/runtime.vibe";
import { navigateWithin } from "../../app/useAddress.ts";
import { failureMessage } from "../setup/proposal/run.ts";
import { isWebLink } from "./enforcement.ts";

export { navigateWithin };

export const page = pageShellClass("lg", "6");

export type Acted<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly message: string; readonly accessLost: boolean };

/** Runs one action and settles it as its value, or its message and whether the account lost access. */
export async function act<A, E extends { readonly _tag: string; readonly message: string }>(runtime: PageRuntime, work: Effect.Effect<A, E, PageServices>, lost: (failure: E) => boolean, fallback: string): Promise<Acted<A>> {
  const exit = await runtime.runPromise(Effect.exit(work));
  if (Exit.isSuccess(exit)) return { ok: true, value: exit.value };
  const failure = Exit.findErrorOption(exit);
  if (failure._tag === "None") return { ok: false, message: failureMessage(exit.cause, fallback), accessLost: false };
  return { ok: false, message: failure.value.message === "" ? fallback : failure.value.message, accessLost: lost(failure.value) };
}

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

export type ChipTone = StatusProps["presentation"]["tone"];

const chipTones: Readonly<Record<ChipTone, string>> = {
  Neutral: "text-muted-foreground",
  Emphasis: "text-primary",
  Positive: "text-ok",
  Caution: "text-warn",
  Negative: "text-destructive",
  Notice: "text-info",
};

/** A short state or count in its tone, with what it stands for in its title. */
export function Chip({ tone = "Neutral", icon, title, children }: { tone?: ChipTone; icon?: ReactNode; title?: string; children: ReactNode }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium [&_svg]:size-3.5 [&_svg]:shrink-0", chipTones[tone])}>
      {icon}
      {children}
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
