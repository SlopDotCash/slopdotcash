// spec/frontend/presentation.md, "Home keeps distinct contribution and report entry points and generic agent setup"
import { cn, focusRing, shell } from "@repo/ui";
import { X } from "lucide-react";
import { useState } from "react";
import { webStorage } from "../../platform/webStorage.ts";

const DISMISS_KEY = "slop:sponsored-pools-notice:dismissed";
const SPONSORED_POOLS_URL = "/sponsored-pools";

function isDismissed(): boolean {
  try {
    return webStorage("local")?.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function markDismissed(): void {
  try {
    webStorage("local")?.setItem(DISMISS_KEY, "1");
  } catch {
    return;
  }
}

export function SponsoredPoolsNotice() {
  const [hidden, setHidden] = useState(isDismissed);
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
