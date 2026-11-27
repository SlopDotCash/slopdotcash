// spec/security/privacy.md, "Read authorization comes from the current case roles and is audited before delivery"
import { Button, Status } from "@repo/ui";
import { Info, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import type { SecurityCase } from "./case.schema.ts";

export type RetryProps = {
  record: SecurityCase;
  busy: boolean;
  error: string | null;
  onRetry: () => void;
};

export function CaseFact({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
      <dt className="text-sm font-medium text-muted-foreground sm:w-48 sm:shrink-0">{term}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

/** An icon control named by what it starts again. */
export function RetryButton({ busy = false, label, onRetry }: { busy?: boolean; label: string; onRetry: () => void }) {
  return (
    <Button variant="ghost" size="icon" className="self-start" aria-label={label} title={label} disabled={busy} onClick={onRetry}>
      <RotateCcw aria-hidden className="size-4" />
    </Button>
  );
}

/** An icon that carries a short explanation as its name and tooltip. */
export function InfoTip({ text }: { text: string }) {
  return (
    <span role="img" aria-label={text} title={text} className="inline-flex text-muted-foreground">
      <Info aria-hidden className="size-3.5" />
    </span>
  );
}

/** A failed refresh: the loaded view stays and is marked stale. */
export function StaleNotice({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <p role="alert" className="flex items-center gap-2">
      <Status title={error} presentation={{ tone: "Caution", icon: "Alert", label: "Stale" }} />
      <span className="sr-only">{error}</span>
      <RetryButton label="Retry" onRetry={onRetry} />
    </p>
  );
}
