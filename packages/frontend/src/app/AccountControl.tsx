// spec/frontend/navigation.md, "Navigation gates private destinations on a signed-in account"; spec/frontend/presentation.md, "Settings keeps wallet and email controls expanded without account navigation tabs"; spec/backend/accounts.md, "Sign-out ends only the caller's session and revocation never reaches another account"
import { AccountMenu, AccountMenuItem, Button } from "@repo/ui";
import type { SessionView } from "../session/session.vibe";

export type AccountControlProps = {
  view: SessionView;
  loginHref: string;
  onLoginPage: boolean;
  signingOut: boolean;
  signOutFailed: boolean;
  onSignOut: () => void;
};

const avatarOf = (login: string) => `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?size=80`;

export function AccountControl({ view, loginHref, onLoginPage, signingOut, signOutFailed, onSignOut }: AccountControlProps) {
  if (view.status !== "signedIn" && onLoginPage) return null;
  if (view.status === "checking") return <span role="status" className="text-sm text-muted-foreground">Checking login…</span>;
  if (view.status !== "signedIn") {
    return (
      <Button asChild variant="outline" size="sm">
        <a href={loginHref}>Log in</a>
      </Button>
    );
  }
  const { githubLogin: login, admin } = view.session;
  const destinations: ReadonlyArray<readonly [string, string]> = [
    ["View profile", `/contributors/${encodeURIComponent(login)}`],
    ["Inbox", "/inbox"],
    ["Payouts", "/earnings"],
    ["Settings", "/account"],
    ...(admin ? [["Admin", "/admin"] as const] : []),
  ];
  return (
    <div className="flex items-center gap-2">
      {signOutFailed ? <p role="alert" className="text-sm text-destructive">Could not sign out. Retry.</p> : null}
      <AccountMenu login={login} avatarUrl={avatarOf(login)} onSignOut={onSignOut} loading={signingOut} signOutLabel={signingOut ? "Signing out…" : "Sign out"}>
        {destinations.map(([label, href]) => (
          <AccountMenuItem key={href} asChild>
            <a href={href}>{label}</a>
          </AccountMenuItem>
        ))}
      </AccountMenu>
    </div>
  );
}
