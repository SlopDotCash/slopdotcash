// spec/frontend/requestedRepos.md, "Story: See requested repos, flag one, renew or withdraw it"; spec/frontend/requestedRepos.md, "A board read keeps a ready board on screen and a failed one offers Try again"; spec/frontend/requestedRepos.md, "One flag, renew or withdraw is in flight per lifetime, a success reloads the board and a refusal changes nothing else"
import { parseRepoInput, pitchText, repoInputRule, repoPathRule, repoUrl, validRepoPath } from "@repo/backend/client";
import { Alert, Button, CopyButton, cn, ExternalLink, Field, Input, PageHeader, shell, Spinner, StatusIcon, Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@repo/ui";
import { Flag } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { SignInPanel } from "../../app/SignInPanel.tsx";
import type { SessionView } from "../../session/session.vibe";
import { formatDate } from "../projects/summary.ts";
import { pitchLink, type RepoRequestAction, type RequestedView } from "./flow.vibe";

export type RequestedReposProps = {
  /** The page's machine state with the board, the last answer and the viewer it was read for. */
  view: RequestedView;
  /** The origin a pitch's link is built on. */
  origin: string;
  /** The `?flag=` repository of this visit, as typed in the address. */
  flag: string | null;
  /** Whether the visitor is signed in, as the session last said. */
  session: SessionView;
  /** Where sign-in returns to this page with the same `?flag=`. */
  signInHref: string;
  /** Flags, renews or withdraws a repository for the signed-in viewer. */
  onAct: (repo: string, action: RepoRequestAction) => void;
  /** Reads the board again after it failed. */
  onRetry: () => void;
  /** Opens the `?flag=` panel for a signed-out visitor who typed a repository. */
  onSignedOutFlag: (repo: string) => void;
  /** Writes a pitch to the clipboard. */
  onCopy?: (text: string) => Promise<void>;
};

const link = "font-medium text-primary underline-offset-4 hover:underline";

function Region({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 rounded-xl border border-border p-4 md:p-8">
      <h2 id={id} className="mb-1 text-2xl leading-page font-extrabold tracking-amount text-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function RepoLink({ repo }: { repo: string }) {
  return (
    <ExternalLink href={repoUrl(repo)} className={link}>
      {repo}
    </ExternalLink>
  );
}

function FlagField({ busy, onFlag }: { busy: boolean; onFlag: (repo: string) => void }) {
  const [entry, setEntry] = useState("");
  const [invalid, setInvalid] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const repo = parseRepoInput(entry);
    setInvalid(repo === undefined);
    if (repo === undefined) return;
    setEntry("");
    onFlag(repo);
  };
  return (
    <Region id="flag-field-heading" title="Flag a repo">
      <form className="flex flex-col items-start gap-4" onSubmit={submit}>
        <Field label="Repository" className="w-full" error={invalid ? <span role="alert">{repoInputRule}</span> : undefined}>
          <Input
            type="text"
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            required
            maxLength={300}
            placeholder="owner/name"
            disabled={busy}
            invalid={invalid}
            value={entry}
            onChange={(event) => {
              setEntry(event.target.value);
              setInvalid(false);
            }}
          />
        </Field>
        <Button type="submit" loading={busy} disabled={busy || entry.trim() === ""}>
          {busy ? "Saving…" : "Flag"}
        </Button>
      </form>
    </Region>
  );
}

function FlagPanel({ repo, signedIn, busy, session, signInHref, onAct }: { repo: string; signedIn: boolean; busy: boolean } & Pick<RequestedReposProps, "session" | "signInHref" | "onAct">) {
  if (!validRepoPath(repo)) return <Alert variant="destructive">{repoPathRule}</Alert>;
  if (signedIn) {
    return (
      <>
        <p>
          Flag <RepoLink repo={repo} /> as a repo you'd work on?
        </p>
        <Button loading={busy} disabled={busy} className="self-start" onClick={() => onAct(repo, "flag")}>
          {busy ? "Saving…" : "Flag"}
        </Button>
      </>
    );
  }
  if (session.status === "checking" || session.status === "signedIn") {
    return (
      <p aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
        <StatusIcon icon="Spinner" />
        Checking sign-in
      </p>
    );
  }
  return (
    <SignInPanel
      view={session.status === "failed" ? { status: "failed", message: "Sign-in could not be checked. Try again." } : session}
      href={signInHref}
      purpose={`Sign in to flag ${repo} as a repo you'd work on.`}
    />
  );
}

function Board({ view, origin, onRetry, onCopy }: Pick<RequestedReposProps, "view" | "origin" | "onRetry" | "onCopy">) {
  const { page, board } = view;
  if (page.board === "BoardFailed") {
    return (
      <Alert variant="destructive" action={<Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>}>
        Requested repos could not load.
      </Alert>
    );
  }
  if (page.board === "BoardLoading" || board === undefined) return <Spinner label="Loading requested repos" />;
  if (board.repos.length === 0) return <p>No repos are flagged yet.</p>;
  const pitchTo = pitchLink(origin, view.viewer);
  return (
    <Table label="Requested repos">
      <TableCaption visuallyHidden>Requested repos</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Repo</TableHead>
          <TableHead>Contributors</TableHead>
          <TableHead>Last flagged</TableHead>
          <TableHead>Pitch</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {board.repos.map((row) => (
          <TableRow key={row.repo}>
            <TableHead scope="row" className="text-foreground">
              <RepoLink repo={row.repo} />
            </TableHead>
            <TableCell className="tabular-nums">{row.count}</TableCell>
            <TableCell>{formatDate(row.newestAt)}</TableCell>
            <TableCell>
              <CopyButton
                text={pitchText(row.count, row.repo, pitchTo)}
                label={`Copy pitch for ${row.repo}`}
                labels={{ ready: "Copy pitch", copied: "Copied.", failed: "Copy failed. Select and copy the text." }}
                onCopy={onCopy}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function YourFlags({ view, busy, onAct }: { view: RequestedView; busy: boolean; onAct: RequestedReposProps["onAct"] }) {
  const mine = view.board?.mine ?? [];
  return (
    <Region id="mine-heading" title="Your flags">
      {mine.length === 0 ? (
        <p>You have not flagged a repo.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {mine.map((row) => (
            <li key={row.repo} className="flex flex-wrap items-center gap-2">
              <RepoLink repo={row.repo} />{" "}
              <span>{row.listedAs !== null ? `· Now on Slop as ${row.listedAs}` : `· Counts until ${formatDate(row.expiresAt)}`}</span>
              {row.listedAs === null ? (
                <Button variant="secondary" size="sm" aria-label={`Renew ${row.repo}`} disabled={busy} onClick={() => onAct(row.repo, "flag")}>
                  Renew
                </Button>
              ) : null}
              <Button variant="secondary" size="sm" aria-label={`Withdraw ${row.repo}`} disabled={busy} onClick={() => onAct(row.repo, "withdraw")}>
                Withdraw
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Region>
  );
}

/**
 * `/requested`: the repositories Slop contributors with merged work would work on, by count, each with a pitch to
 * copy, and the signed-in viewer's own flags.
 * @model spec/frontend/requestedRepos.md
 */
export function RequestedRepos({ view, origin, flag, session, signInHref, onAct, onRetry, onSignedOutFlag, onCopy }: RequestedReposProps) {
  const signedIn = view.page.actor !== "";
  const busy = view.page.pending !== 0;
  return (
    <main className={cn(shell, "flex min-h-[70vh] flex-1 flex-col gap-8 pt-9 pb-18")}>
      <PageHeader
        title="Requested repos"
        icon={<Flag className="size-6 text-primary" />}
        lead="Repos Slop contributors want to work on. A count is accounts with merged work on Slop that flagged the repo in the last 90 days."
      />
      {flag === null ? (
        <FlagField busy={busy} onFlag={(repo) => (signedIn ? onAct(repo, "flag") : onSignedOutFlag(repo))} />
      ) : (
        <Region id="flag-heading" title="Flag a repo">
          <FlagPanel repo={flag} signedIn={signedIn} busy={busy} session={session} signInHref={signInHref} onAct={onAct} />
        </Region>
      )}
      {view.done !== undefined ? <p role="status">{view.done}</p> : null}
      {view.problem !== undefined ? <Alert variant="destructive">{view.problem}</Alert> : null}
      <Board view={view} origin={origin} onRetry={onRetry} onCopy={onCopy} />
      {signedIn && view.page.board === "BoardReady" && view.board !== undefined ? <YourFlags view={view} busy={busy} onAct={onAct} /> : null}
    </main>
  );
}
