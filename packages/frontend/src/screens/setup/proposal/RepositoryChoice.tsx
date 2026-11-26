// spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
import { Button, StatusIcon } from "@repo/ui";
import { ListChecks } from "lucide-react";
import { useState } from "react";
import { normalizeRepositoryInput } from "../../../flows/projects/proposal.ts";
import { focusField, SelectField, TextField } from "../fields/ProjectFields.tsx";

export type OwnedRepository = { readonly repository: string; readonly description: string | null };

export type RepositoryListView = { readonly status: "loading" } | { readonly status: "ready"; readonly repositories: ReadonlyArray<OwnedRepository> } | { readonly status: "error"; readonly message: string };

export type RepositoryChoiceProps = {
  selected: string;
  onChoose: (repository: string) => void;
  list: RepositoryListView;
  onRetryList: () => void;
  error?: string;
  onRetryLookup?: () => void;
};

const other = "__other";

/** One repository control: the account's repositories, with entry of any other public repository by name or URL. */
export function RepositoryChoice({ selected, onChoose, list, onRetryList, error, onRetryLookup }: RepositoryChoiceProps) {
  const [manual, setManual] = useState(false);
  const repositories = list.status === "ready" ? list.repositories : [];
  const option = repositories.find((entry) => entry.repository.toLowerCase() === selected.toLowerCase())?.repository ?? selected;
  const typed = manual || list.status === "error" || (list.status === "ready" && repositories.length === 0);
  const switchTo = (next: boolean) => {
    setManual(next);
    requestAnimationFrame(() => focusField("repository"));
  };
  return (
    <div className="flex flex-col gap-2">
      {typed ? (
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <TextField label="GitHub repository" name="repository" value={selected} placeholder="owner/repository or GitHub URL" error={error} onChange={(value) => onChoose(normalizeRepositoryInput(value))} />
          </div>
          {repositories.length > 0 ? (
            <Button variant="ghost" size="icon" aria-label="Choose from your repositories" onClick={() => switchTo(false)}>
              <ListChecks aria-hidden className="size-5" />
            </Button>
          ) : null}
        </div>
      ) : (
        <SelectField
          label="GitHub repository"
          name="repository"
          value={option}
          error={error}
          disabled={list.status === "loading"}
          options={[
            ["", list.status === "loading" ? "Loading repositories…" : "Choose a repository"],
            ...(option && !repositories.some((entry) => entry.repository === option) ? [[option, option] as const] : []),
            ...repositories.map((entry) => [entry.repository, entry.repository] as const),
            [other, "Enter repository…"],
          ]}
          onChange={(value) => {
            if (value !== other) return onChoose(value);
            onChoose("");
            switchTo(true);
          }}
        />
      )}
      {list.status === "error" ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          <StatusIcon icon="Alert" />
          {list.message}
          <Button variant="link" onClick={onRetryList}>
            Retry repositories
          </Button>
        </p>
      ) : null}
      {onRetryLookup ? (
        <Button variant="link" className="self-start" onClick={onRetryLookup}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
