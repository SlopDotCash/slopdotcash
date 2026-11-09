import { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { usePendingWalletAttempt } from "../src/lib/use-pending-wallet-attempt";

const key = "slop:test:pending-wallet-lifetime";
const state = { committedRemoval: false, sends: 0 };
Object.assign(window, { walletLifetime: state });

function WalletAttempt() {
  const { mounted, remember } = usePendingWalletAttempt<{
    hash: string | null;
    attemptId?: string;
  }>(
    key,
    (raw) => JSON.parse(raw),
    () => "Unreadable request",
  );
  useLayoutEffect(() => {
    return () => {
      state.committedRemoval = true;
      // A consumer's final pre-send callback may run at committed removal,
      // before passive cleanup. It must observe the retired request lifetime.
      if (mounted.current) {
        state.sends += 1;
        remember({ hash: null });
      }
    };
  }, [mounted, remember]);
  return <p>Wallet request open</p>;
}

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(false)}>
        Leave wallet
      </button>
      {open ? <WalletAttempt /> : <p>Wallet closed</p>}
    </>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(<Harness />);
