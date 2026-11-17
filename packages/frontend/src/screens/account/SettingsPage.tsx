// spec/frontend/presentation.md, "Settings keeps wallet and email controls expanded without account navigation tabs"; spec/frontend/navigation.md, "A signed-out private destination keeps its URL and shows sign-in in place with private reads disabled"
import { PageHeader } from "@repo/ui";
import { UserRound } from "lucide-react";
import type { ReactNode } from "react";
import type { PageProps } from "../../app/pages.ts";
import { loginHrefFor, useSession } from "../../app/useSession.ts";
import { writeClipboard } from "../../platform/navigatorClipboard.ts";
import { ReferralSection } from "../../referrals/index.ts";
import { EmailPreferences } from "./EmailPreferences.tsx";
import {
  type AccountRuntime,
  accountRuntime,
  confirmWalletChange,
  connectWallet,
  editEmail,
  keepSavedWallet,
  reloadEmail,
  reloadWallets,
  requestEmailVerification,
  toggleEmail,
  watchEmail,
  watchOffers,
  watchWallets,
} from "./runtime.vibe";
import { useView } from "./useView.ts";
import { walletPanelOpened } from "./walletPanel.vibe";
import { WalletManagement } from "./WalletManagement.tsx";

export const walletsAddress = "/account#wallets";
export const notificationsAddress = "/account#notifications";

/** Whether Settings renders at `address` for a visitor who is not signed in: only its wallet section does. */
export function settingsShownSignedOut(address: string): boolean {
  return new URL(address, "https://slop.invalid").hash === "#wallets";
}

function SettingsSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="flex flex-col gap-4">
      <h2 id={`${id}-heading`} className="text-xl font-semibold text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** The Settings page's frame: its heading, then its sections, all expanded. */
export function SettingsView({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-(--breakpoint-md) flex-1 flex-col gap-12 px-4 py-12">
      <PageHeader title="Settings" icon={<UserRound className="size-6" />} />
      {children}
    </main>
  );
}

function run(section: AccountRuntime) {
  return (work: Parameters<AccountRuntime["runFork"]>[0]) => {
    section.runFork(work);
  };
}

function Wallets({ section, signInHref }: { section: AccountRuntime; signInHref: string }) {
  const panel = useView(section, watchWallets) ?? walletPanelOpened;
  const offers = useView(section, watchOffers) ?? [];
  const send = run(section);
  return (
    <SettingsSection id="wallets" title="Wallets">
      <WalletManagement
        panel={panel}
        offers={offers}
        signInHref={signInHref}
        onReload={() => send(reloadWallets())}
        onConnect={(offer, family) => send(connectWallet(offer, family))}
        onConfirmChange={() => send(confirmWalletChange())}
        onKeepSaved={() => send(keepSavedWallet())}
        onCopy={writeClipboard}
      />
    </SettingsSection>
  );
}

function Email({ section, signInHref, localMailHref }: { section: AccountRuntime; signInHref: string; localMailHref: string | undefined }) {
  const panel = useView(section, watchEmail);
  const send = run(section);
  return (
    <SettingsSection id="notifications" title="Email preferences">
      {panel ? (
        <EmailPreferences
          panel={panel}
          signInHref={signInHref}
          localMailHref={localMailHref}
          onToggle={(field) => send(toggleEmail(field))}
          onEdit={() => send(editEmail())}
          onRequest={(enrollment) => send(requestEmailVerification(enrollment))}
          onRetry={() => send(reloadEmail())}
        />
      ) : (
        <p role="status">Checking your account…</p>
      )}
    </SettingsSection>
  );
}

export function SettingsPage({ runtime }: PageProps) {
  const shown = useSession(runtime);
  if (shown === undefined) return null;
  const section = accountRuntime(runtime);
  const signedIn = shown.view.status === "signedIn";
  const local = shown.deployment.localBackendOrigin;
  return (
    <SettingsView>
      <Wallets section={section} signInHref={loginHrefFor(shown, walletsAddress)} />
      {signedIn ? <Email section={section} signInHref={loginHrefFor(shown, notificationsAddress)} localMailHref={local === undefined ? undefined : `${local}/__dev/mail`} /> : null}
      {signedIn ? <ReferralSection runtime={runtime} /> : null}
    </SettingsView>
  );
}
