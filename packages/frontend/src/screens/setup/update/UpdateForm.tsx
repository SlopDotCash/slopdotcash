// spec/backend/projects.md, "Owner revisions publish at once against the expected revision"; spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"; spec/backend/projects.md, "Automatic-closure consent changes only by an owner revision or an administrator exception"; spec/backend/projects.md, "Appending a repository pauses the project and its work counts from next month"; spec/backend/closureConsent.md, "The new form starts unchecked and an existing form reflects only its exact saved setting"; spec/backend/readyLabelSettings.md, "Ready-label settings are bounded, off when absent or disabled, and only add protected paths"; spec/frontend/readyLabelForm.md, "The control starts off with the defaults when nothing is saved, saves only bounded settings while on, and keeps the owner's numbers when turned off"; spec/backend/intakeCap.md, "A recent count at or above the cap of an active project pauses it"; spec/backend/projects.md, "The maintainer share is an owner setting whose history only the server writes"; spec/backend/projects.md, "A current repository administrator moves the integration branch with a committed declaration"
import { Button, Checkbox, Disclosure, Label } from "@repo/ui";
import { X } from "lucide-react";
import { useNow } from "../../../app/hooks.ts";
import { formatDate } from "../../projects/summary.ts";
import { contributionLabels, skillRuleFields } from "../fields/contribution.ts";
import { ProjectImageField } from "../fields/ProjectImageField.tsx";
import { fieldId, TextField } from "../fields/ProjectFields.tsx";
import { maxShareBasisPoints } from "../../../../gen/settlement__maintainerShare.ts";
import { ClosureConsent } from "../proposal/ClosureConsent.tsx";
import { ContributionSettings } from "../proposal/ContributionSettings.tsx";
import { type FundingField, FundingFields } from "../proposal/FundingFields.tsx";
import type { ManagedManifest, PendingRepository } from "./manifest.schema.ts";
import { IntegrationBranch, type IntegrationBranchControl } from "./IntegrationBranch.tsx";
import { ReadyLabelFields } from "./ReadyLabelFields.tsx";
import { catchUpEnd, catchUpOfferedEnd, catchUpStartAllowed, type FormGroup, type UpdateField, type UpdateReview } from "./revision.ts";

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
  branch: IntegrationBranchControl;
};

const fundingFields = { mode: "fundingMode", network: "network", assetKind: "assetKind", tokenAddress: "tokenAddress", tokenSymbol: "tokenSymbol", monthlyAmount: "monthlyAmount" } as const satisfies Record<FundingField, UpdateField>;

function CatchUpField({ manifest, value, onChange }: { manifest: ManagedManifest; value: string; onChange: (value: string) => void }) {
  const now = new Date(useNow());
  const running = catchUpEnd(manifest, now);
  const allowed = running !== null || catchUpStartAllowed(manifest, now);
  const id = fieldId("catchingUp");
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-11 items-center gap-2.5">
        <Checkbox
          id={id}
          name="catchingUp"
          checked={value === "true"}
          disabled={!allowed}
          aria-describedby="catch-up-state"
          onCheckedChange={(checked) => onChange(String(checked === true))}
        />
        <Label htmlFor={id} className="text-copy leading-page font-bold">
          {allowed
            ? `Catching up on reviews until ${formatDate(running ?? catchUpOfferedEnd(now))}`
            : "Catching up on reviews (already used this month)"}
        </Label>
      </div>
      <p id="catch-up-state" className="text-xs text-muted-foreground">
        Backlog rule: projects with 50 or more outside pull requests waiting a week, or with open work and no merge in 14 days (starting 1 December 2026), step out of rotation until caught up. A catch-up pause lasts up to 14 days and can start once per UTC month.
      </p>
    </div>
  );
}

/** The owner's edit of the current revision: listing and its links, the contribution settings, contribution rules with the ready label and intake cap, repositories with the integration branch, and monthly rewards with the maintainer share. */
export function UpdateForm({ review, manifest, shown, open, onOpen, onChange, onPending, repository, addition, onRepository, onAdd, publishing, branch }: UpdateFormProps) {
  const { value, added, choice } = review;
  const group = (name: FormGroup, summary: string) => ({ summary, open: open.has(name), onOpenChange: (next: boolean) => onOpen(name, next) });
  return (
    <form noValidate className="flex flex-col gap-6" onSubmit={(event) => event.preventDefault()}>
      <Disclosure {...group("listing", "Project listing")}>
        <div className="flex flex-col gap-4 pt-2 text-foreground">
          <ProjectImageField value={value.image} onChange={(image) => onChange("image", image)} />
          <TextField label="Short description" name="headline" value={value.headline} error={shown("headline")} onChange={(entry) => onChange("headline", entry)} />
          <TextField label="Goal" name="goal" multiline value={value.goal} error={shown("goal")} onChange={(entry) => onChange("goal", entry)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Website (optional)" name="website" type="url" placeholder="https://example.com" value={value.website} error={shown("website")} onChange={(entry) => onChange("website", entry)} />
            <TextField label="X account (optional)" name="x" placeholder="@handle" value={value.x} error={shown("x")} onChange={(entry) => onChange("x", entry)} />
          </div>
        </div>
      </Disclosure>
      <ClosureConsent value={value.automaticClosure} onChange={(entry) => onChange("automaticClosure", entry)} />
      <ContributionSettings
        bountyOnly={review.bountyOnly}
        value={value}
        onChange={onChange}
        amount={{ value: value.submissionFeeAmount, error: shown("submissionFeeAmount"), onChange: (entry) => onChange("submissionFeeAmount", entry) }}
        standing={{ value: value.standingDeposits, onChange: (entry) => onChange("standingDeposits", entry) }}
      />
      <Disclosure summary="Contribution rules" open={open.has("rules") || open.has("moreRules")} onOpenChange={(next) => {
          onOpen("rules", next);
          if (!next) onOpen("moreRules", false);
        }}
      >
        <div className="flex flex-col gap-4 pt-2 text-foreground">
          <TextField label="Acceptance criteria" name="criteria" multiline value={value.criteria} error={shown("criteria")} onChange={(entry) => onChange("criteria", entry)} />
          <ReadyLabelFields value={value} shown={shown} onChange={onChange} />
          <TextField label="Pause new contributors when this many outside pull requests are open (optional)" name="intakeCap" inputMode="numeric" value={value.intakeCap} error={shown("intakeCap")} onChange={(entry) => onChange("intakeCap", entry)} />
          {review.bountyOnly ? null : <CatchUpField manifest={manifest} value={value.catchingUp} onChange={(entry) => onChange("catchingUp", entry)} />}
          <Disclosure {...group("moreRules", "More rules")}>
            <div className="flex flex-col gap-4 pt-2">
              {skillRuleFields.map((field) => (
                <TextField key={field} label={contributionLabels[field].label} name={field} multiline placeholder={contributionLabels[field].placeholder} value={value[field]} error={shown(field)} onChange={(entry) => onChange(field, entry)} />
              ))}
            </div>
          </Disclosure>
        </div>
      </Disclosure>
      <Disclosure {...group("repositories", "Repositories")}>
        <div className="flex flex-col gap-4 pt-2 text-foreground">
          <ul className="flex flex-col gap-3">
            {manifest.repositories.map((entry, index) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-medium">{entry.id}</span>
                {index === 0 && review.primary ? (
                  <span className="text-sm text-muted-foreground">
                    Integration branch <code>{review.primary.integrationBranch}</code>
                  </span>
                ) : null}
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
          <IntegrationBranch stored={review.primary} choices={branch.choices} name={branch.name} error={review.errors.integrationBranch} disabled={publishing} onLoad={branch.load} onChoose={branch.choose} />
          <TextField label="GitHub repository" name="addRepository" placeholder="owner/repository or GitHub URL" value={repository} error={addition.state === "error" ? addition.message : undefined} onChange={onRepository} />
          <Button variant="secondary" className="self-start" loading={addition.state === "loading"} disabled={repository.trim() === "" || publishing} onClick={onAdd}>
            Add
          </Button>
        </div>
      </Disclosure>
      {review.monthly && !review.bountyOnly ? (
        <Disclosure {...group("rewards", "Monthly rewards")}>
          <div className="flex flex-col gap-4 pt-2 text-foreground">
            <FundingFields
              choice={choice}
              networkFixed={review.assetFixed}
              error={shown}
              onChange={(field, entry) => onChange(fundingFields[field], entry)}
              promise={{ checked: value.honorSystem === "true", onChange: (checked) => onChange("honorSystem", String(checked)) }}
            />
            {choice.mode === "monthly" ? (
              <TextField
                label={`Maintainer share (%, 0 to ${maxShareBasisPoints / 100}, optional)`}
                name="maintainerShare"
                inputMode="numeric"
                hint="Percent of the monthly amount for the people who merge or close outside pull requests. Starts next UTC month."
                value={value.maintainerShare}
                error={shown("maintainerShare")}
                onChange={(entry) => onChange("maintainerShare", entry)}
              />
            ) : null}
          </div>
        </Disclosure>
      ) : null}
      {review.offerVault ? (
        <Button variant="secondary" className="self-start" onClick={() => onChange("fundingMode", "monthly")}>
          Set up vault
        </Button>
      ) : null}
    </form>
  );
}
