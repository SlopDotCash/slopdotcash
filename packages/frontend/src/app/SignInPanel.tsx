// spec/frontend/navigation.md, "A signed-out private destination keeps its URL and shows sign-in in place with private reads disabled"; spec/frontend/composition.md, "Sign-in keeps only a safe same-origin return destination"
import { Alert, Button, StatusIcon } from "@repo/ui";
import type { SessionView } from "../session/session.vibe";

export type SignInPanelProps = {
  view: Exclude<SessionView, { status: "signedIn" }>;
  href: string;
  purpose?: string;
};

export function SignInPanel({ view, href, purpose }: SignInPanelProps) {
  if (view.status === "checking") {
    return (
      <p aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
        <StatusIcon icon="Spinner" />
        Checking sign-in…
      </p>
    );
  }
  return (
    <div className="flex flex-col items-start gap-4">
      {purpose ? <p>{purpose}</p> : null}
      {view.status === "failed" ? <Alert variant="destructive">{view.message}</Alert> : null}
      <Button asChild>
        <a href={href}>Sign in with GitHub</a>
      </Button>
    </div>
  );
}
