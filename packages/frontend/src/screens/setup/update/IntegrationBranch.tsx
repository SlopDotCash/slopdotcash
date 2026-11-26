// spec/backend/projects.md, "A current repository administrator moves the integration branch with a committed declaration"; spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
import { Alert, Button } from "@repo/ui";
import { Exit } from "effect";
import { useRef, useState } from "react";
import type { PageRuntime } from "../../../app/runtime.vibe";
import { branchMessages, type IntegrationBranchChoice, integrationBranchChoices, type StoredRepository } from "../../../flows/projects/github.vibe";
import { SelectField } from "../fields/ProjectFields.tsx";
import { failureMessage } from "../proposal/run.ts";

export type BranchChoices =
  | { readonly state: "idle" | "loading" }
  | { readonly state: "error"; readonly message: string }
  | { readonly state: "ready"; readonly choices: ReadonlyArray<IntegrationBranchChoice> };

export interface IntegrationBranchControl {
  readonly choices: BranchChoices;
  readonly name: string;
  readonly change: IntegrationBranchChoice | undefined;
  readonly load: (stored: StoredRepository) => void;
  readonly choose: (name: string) => void;
  readonly clear: () => void;
}

/** The owner's pending integration branch change: the live branch heads of the stored repository and the one chosen. */
export function useIntegrationBranch(runtime: PageRuntime): IntegrationBranchControl {
  const [choices, setChoices] = useState<BranchChoices>({ state: "idle" });
  const [name, setName] = useState("");
  const loads = useRef(0);
  const load = async (stored: StoredRepository) => {
    const id = ++loads.current;
    setName("");
    setChoices({ state: "loading" });
    const exit = await runtime.runPromiseExit(integrationBranchChoices(stored));
    if (id !== loads.current) return;
    setChoices(Exit.isSuccess(exit) ? { state: "ready", choices: exit.value } : { state: "error", message: failureMessage(exit.cause, branchMessages.failed) });
  };
  const clear = () => {
    loads.current += 1;
    setName("");
    setChoices({ state: "idle" });
  };
  return {
    choices,
    name,
    change: choices.state === "ready" ? choices.choices.find((entry) => entry.name === name) : undefined,
    load: (stored) => void load(stored),
    choose: setName,
    clear,
  };
}

export type IntegrationBranchProps = {
  /** The primary repository as stored, or undefined while it cannot be verified. */
  stored: StoredRepository | undefined;
  choices: BranchChoices;
  name: string;
  /** Why the chosen branch cannot be published with the other pending changes. */
  error: string | undefined;
  disabled: boolean;
  onLoad: (stored: StoredRepository) => void;
  onChoose: (name: string) => void;
};

/** Change the primary repository's integration branch to another live branch head, verified against the stored repository ids. */
export function IntegrationBranch({ stored, choices, name, error, disabled, onLoad, onChoose }: IntegrationBranchProps) {
  const current = stored?.integrationBranch ?? "";
  return (
    <div className="flex flex-col gap-3">
      <Button variant="secondary" className="self-start" loading={choices.state === "loading"} disabled={stored === undefined || choices.state === "loading" || disabled} onClick={() => stored && onLoad(stored)}>
        {choices.state === "loading" ? "Loading branches…" : choices.state === "ready" ? "Refresh integration branches" : "Change integration branch"}
      </Button>
      {choices.state === "ready" && choices.choices.length > 0 ? (
        <SelectField
          label="New integration branch"
          name="integrationBranch"
          value={name}
          options={[["", `Keep ${current}`], ...choices.choices.map(({ name: branch }) => [branch, branch] as const)]}
          disabled={disabled}
          error={error}
          onChange={onChoose}
        />
      ) : choices.state === "error" ? (
        <Alert variant="destructive">{choices.message}</Alert>
      ) : choices.state === "ready" ? (
        <p role="status" className="text-sm text-muted-foreground">
          No other branch head is available.
        </p>
      ) : null}
    </div>
  );
}
