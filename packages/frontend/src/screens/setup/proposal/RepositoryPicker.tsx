// spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"; spec/backend/projects.md, "Authority is one read bound to the acting account and the stored repository"
import { Button, StatusIcon } from "@repo/ui";
import { useState } from "react";
import type { PageRuntime } from "../../../app/runtime.vibe";
import { ownedRepositories } from "../../../flows/projects/github.vibe";
import type { SessionView } from "../../../session/session.vibe";
import { fieldId } from "../fields/ProjectFields.tsx";
import { RepositoryChoice, type RepositoryChoiceProps, type RepositoryListView } from "./RepositoryChoice.tsx";
import { useRun } from "./run.ts";

export type RepositoryPickerProps = Omit<RepositoryChoiceProps, "list" | "onRetryList"> & {
  runtime: PageRuntime;
  session: SessionView;
  loginHref: string;
};

/** The repository control of setup: sign-in first, then the account's repository list read from GitHub. */
export function RepositoryPicker({ runtime, session, loginHref, ...choice }: RepositoryPickerProps) {
  const [attempt, setAttempt] = useState(0);
  const login = session.status === "signedIn" ? session.session.githubLogin : undefined;
  const read = useRun(runtime, login === undefined ? undefined : `owned:${login}:${attempt}`, () => ownedRepositories(), "Repositories could not load.");
  if (login === undefined) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-foreground">GitHub repository</span>
        {session.status === "checking" ? (
          <p id={fieldId("repository")} aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
            <StatusIcon icon="Spinner" />
            Checking sign-in…
          </p>
        ) : (
          <Button asChild variant="outline" className="self-start">
            <a id={fieldId("repository")} href={loginHref} aria-describedby={choice.error ? `${fieldId("repository")}-error` : undefined}>
              Sign in with GitHub
            </a>
          </Button>
        )}
        {choice.error ? (
          <p id={`${fieldId("repository")}-error`} className="flex items-center gap-2 text-sm text-destructive">
            <StatusIcon icon="Alert" />
            {choice.error}
          </p>
        ) : null}
      </div>
    );
  }
  const list: RepositoryListView =
    read === undefined || read.status === "running" ? { status: "loading" } : read.status === "done" ? { status: "ready", repositories: read.value } : { status: "error", message: read.message };
  return <RepositoryChoice {...choice} list={list} onRetryList={() => setAttempt((value) => value + 1)} />;
}
