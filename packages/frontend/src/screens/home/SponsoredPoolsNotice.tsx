// spec/frontend/presentation.md, "Home keeps distinct contribution and report entry points and generic agent setup"
import { cn, focusRing, shell } from "@repo/ui";
import { X } from "lucide-react";
import { useState } from "react";
import { webStorage } from "../../platform/webStorage.ts";

export const SPONSORED_POOLS_NOTICE_ENDS = Date.parse("2026-12-08T00:00:00Z");
export const SPONSORED_POOLS_NOTICE_KEY = "slop:notice:sponsored-pools-2026";
const SPONSORED_POOLS_URL = "/sponsored-pools";

/** @throws {never} */
export function sponsoredPoolsNoticeActive(now: number): boolean {
  return Number.isFinite(now) && now < SPONSORED_POOLS_NOTICE_ENDS;
}

function isDismissed(): boolean {
  try {
    return webStorage("local")?.getItem(SPONSORED_POOLS_NOTICE_KEY) === "dismissed";
  } catch {
    return false;
  }
}

function markDismissed(): void {
  try {
    webStorage("local")?.setItem(SPONSORED_POOLS_NOTICE_KEY, "dismissed");
  } catch {
    return;
  }
}

export function SponsoredPoolsNotice() {
  const [hidden, setHidden] = useState(() => !sponsoredPoolsNoticeActive(Date.now()) || isDismissed());
  if (hidden) return null;
  return (
    <aside aria-label="Sponsored pools" className="border-b border-border bg-card">
      <div className={cn(shell, "flex items-center justify-between gap-4 py-3 text-sm text-muted-foreground")}>
        <p>
          <strong className="font-semibold text-foreground">Maintainers:</strong> enter your open-source repo for a treasury-funded pool. Holders vote in early December.{" "}
          <a href={SPONSORED_POOLS_URL} className="text-primary underline underline-offset-4">
            How to enter
          </a>
        </p>
        <button
          aria-label="Dismiss sponsored pools notice"
          title="Dismiss"
          type="button"
          onClick={() => {
            markDismissed();
            setHidden(true);
          }}
          className={cn(focusRing, "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground")}
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
    </aside>
  );
}
