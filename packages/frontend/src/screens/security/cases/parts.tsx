// spec/security/privacy.md, "Read authorization comes from the current case roles and is audited before delivery"
import { Button } from "@repo/ui";
import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import type { SecurityCase } from "./case.schema.ts";

export type RetryProps = {
  record: SecurityCase;
  busy: boolean;
  error: string | null;
  onRetry: () => void;
};

export function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
      <dt className="text-sm font-medium text-muted-foreground sm:w-48 sm:shrink-0">{term}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

export function RetryButton({ busy, label, onRetry }: { busy: boolean; label: string; onRetry: () => void }) {
  return (
    <Button variant="link" className="self-start" disabled={busy} onClick={onRetry}>
      <RotateCcw aria-hidden className="size-4" /> {busy ? "Starting…" : label}
    </Button>
  );
}
