import { X } from "lucide-react";
import { useState } from "react";
import {
  dismissNotice,
  noticeDismissed,
  SPONSORED_POOLS_URL,
  sponsoredPoolsNoticeActive,
} from "./lib/sponsored-pools-notice";

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function SponsoredPoolsNotice() {
  const [hidden, setHidden] = useState(
    () => !sponsoredPoolsNoticeActive(Date.now()) || noticeDismissed(storage()),
  );
  if (hidden) return null;
  return (
    <aside aria-label="Sponsored pools" className="sponsored-pools-notice">
      <div className="shell sponsored-pools-notice-inner">
        <p>
          <strong>Maintainers:</strong> enter your open-source repo for a
          treasury-funded pool. Holders vote in early December.{" "}
          <a href={SPONSORED_POOLS_URL}>How to enter</a>
        </p>
        <button
          aria-label="Dismiss sponsored pools notice"
          onClick={() => {
            dismissNotice(storage());
            setHidden(true);
          }}
          title="Dismiss"
          type="button"
        >
          <X aria-hidden="true" size={16} />
        </button>
      </div>
    </aside>
  );
}
