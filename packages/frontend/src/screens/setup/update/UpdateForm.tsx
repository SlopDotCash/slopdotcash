// spec/backend/projects.md, "Owner revisions publish at once against the expected revision"; spec/backend/projects.md, "Appending a repository pauses the project and its work counts from next month"; spec/backend/closureConsent.md, "The new form starts unchecked and an existing form reflects only its exact saved setting"
import { Button, Disclosure } from "@repo/ui";
import { X } from "lucide-react";
import { formatDate } from "../../projects/summary.ts";
import { contributionLabels, skillRuleFields } from "../fields/contribution.ts";
import { ProjectImageField } from "../fields/ProjectImageField.tsx";
import { TextField } from "../fields/ProjectFields.tsx";
import { ClosureConsent } from "../proposal/ClosureConsent.tsx";
import { type FundingField, FundingFields } from "../proposal/FundingFields.tsx";
import type { ManagedManifest, PendingRepository } from "./manifest.schema.ts";
import type { FormGroup, UpdateField, UpdateReview } from "./revision.ts";

export type Addition = { readonly state: "idle" | "loading" } | { readonly state: "error"; readonly message: string };

export type UpdateFormProps = {
  review: UpdateReview;
  manifest: ManagedManifest;
  /** The field's error once a publish was attempted. */
  shown: (field: string) => string | undefined;
  open: ReadonlySet<FormGroup>;
  onOpen: (group: FormGroup, open: boolean) => void;
  onChange: (field: UpdateField, value: string) => void;
  onPending: (change: (list: ReadonlyArray<PendingRepository>) => ReadonlyArray<PendingRepository>) => void;
  repository: string;
  addition: Addition;
  onRepository: (value: string) => void;
  onAdd: () => void;
  publishing: boolean;
};

const fundingFields = { mode: "fundingMode", network: "network", assetKind: "assetKind", tokenAddress: "tokenAddress", tokenSymbol: "tokenSymbol", monthlyAmount: "monthlyAmount" } as const satisfies Record<FundingField, UpdateField>;

/** The owner's edit of the current revision: listing, contribution rules, added repositories and monthly rewards. */
export function UpdateForm({ review, manifest, shown, open, onOpen, onChange, onPending, repository, addition, onRepository, onAdd, publishing }: UpdateFormProps) {
  const { value, added, choice } = review;
  const group = (name: FormGroup, summary: string) => ({ summary, open: open.has(name), onOpenChange: (next: boolean) => onOpen(name, next) });
  return (
    <form noValidate className="flex flex-col gap-6" onSubmit={(event) => event.preventDefault()}>
      <Disclosure {...group("listing", "Project listing")}>
        <div className="flex flex-col gap-4 pt-2 text-foreground">
          <ProjectImageField value={value.image} onChange={(image) => onChange("image", image)} />
          <TextField label="Short description" name="headline" value={value.headline} error={shown("headline")} onChange={(entry) => onChange("headline", entry)} />
          <TextField label="Goal" name="goal" multiline value={value.goal} error={shown("goal")} onChange={(entry) => onChange("goal", entry)} />
        </div>
      </Disclosure>
      <Disclosure {...group("rules", "Contribution rules")}>
        <div className="flex flex-col gap-4 pt-2 text-foreground">
          <TextField label="Acceptance criteria" name="criteria" multiline placeholder="What accepted GitHub outcomes qualify?" value={value.criteria} error={shown("criteria")} onChange={(entry) => onChange("criteria", entry)} />
          <ClosureConsent value={value.automaticClosure} onChange={(entry) => onChange("automaticClosure", entry)} />
          <h3 className="text-sm font-semibold">Contributor instructions</h3>
          <p className="text-sm text-muted-foreground">These cannot override Slop's safety rules.</p>
          {skillRuleFields.map((field) => (
            <TextField key={field} label={contributionLabels[field].label} name={field} multiline placeholder={contributionLabels[field].placeholder} value={value[field]} error={shown(field)} onChange={(entry) => onChange(field, entry)} />
          ))}
        </div>
      </Disclosure>
      <Disclosure {...group("repositories", "Repositories")}>
        <div className="flex flex-col gap-4 pt-2 text-foreground">
          <ul className="flex flex-col gap-3">
            {manifest.repositories.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-medium">{entry.id}</span>
                {entry.countsFrom ? <span className="text-sm text-muted-foreground">Counts from {formatDate(entry.countsFrom)}</span> : null}
              </li>
            ))}
            {added.map((entry, index) => (
              <li key={entry.entry.id} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-medium">{entry.entry.id}</span>
                  <Button variant="ghost" size="sm" aria-label={`Remove ${entry.entry.id}`} disabled={publishing} onClick={() => onPending((list) => list.filter((_, position) => position !== index))}>
                    <X aria-hidden className="size-4" />
                    Remove
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Counts from {formatDate(review.countsFrom)}. A security scan runs before it counts; an active project pauses until the scan clears. If the scan has not cleared when the month closes, that month has no allocation.
                </p>
                {entry.ownDescription ? (
                  <TextField
                    label="Description"
                    name={`addedRepository${index}`}
                    value={entry.entry.description}
                    error={shown(`addedRepository${index}`)}
                    onChange={(description) => onPending((list) => list.map((item, position) => (position === index ? { ...item, entry: { ...item.entry, description } } : item)))}
                  />
                ) : null}
              </li>
            ))}
          </ul>
          <TextField label="GitHub repository" name="addRepository" placeholder="owner/repository or GitHub URL" value={repository} error={addition.state === "error" ? addition.message : undefined} onChange={onRepository} />
          <Button variant="secondary" className="self-start" loading={addition.state === "loading"} disabled={repository.trim() === "" || publishing} onClick={onAdd}>
            Add
          </Button>
        </div>
      </Disclosure>
      {review.monthly && !review.bountyOnly ? (
        <Disclosure {...group("rewards", "Monthly rewards")}>
          <div className="pt-2 text-foreground">
            <FundingFields choice={choice} networkFixed={review.assetFixed} error={shown} onChange={(field, entry) => onChange(fundingFields[field], entry)} />
          </div>
        </Disclosure>
      ) : null}
      {review.offerVault ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-muted-foreground">Keeps this amount and asset. Publish this change to begin vault setup.</p>
          <Button variant="secondary" onClick={() => onChange("fundingMode", "monthly")}>
            Enable vault setup
          </Button>
        </div>
      ) : null}
    </form>
  );
}
