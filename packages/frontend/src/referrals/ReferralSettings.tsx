// spec/frontend/referralSettings.md, "A loaded account owns the displayed link and the editable draft"; spec/frontend/referralSettings.md, "Exactly one request can act for each active account lifetime"; spec/backend/referralCodes.md, "The referral path without a name opens Settings without a database read"; spec/frontend/requestedRepos.md, "Story: See requested repos, flag one, renew or withdraw it"
import { requestedPage } from "@repo/backend/client";
import { Address, Alert, Button, Field, Input } from "@repo/ui";
import { type FormEvent, useState } from "react";
import { canSubmit, type Settings } from "../../gen/frontend__referralSettings.ts";
import { referralLink, validReferralCode } from "../flows/account/referral.vibe";

export type ReferralSettingsProps = {
  /** The referral form's state for the signed-in account. */
  settings: Settings;
  /** The origin the referral link is built on. */
  origin: string;
  /** Why the last save failed: the name rule, the server's refusal or the retry text. */
  problem?: string;
  /** Records each change of the name in the text box. */
  onEdit: (text: string) => void;
  /** Saves the name in the text box. */
  onSave: (text: string) => void;
  /** Writes the link to the clipboard. */
  onCopy?: (text: string) => Promise<void>;
};

type NameFormProps = Omit<ReferralSettingsProps, "origin" | "onCopy">;

function NameForm({ settings, problem, onEdit, onSave }: NameFormProps) {
  const [text, setText] = useState(settings.draft);
  const normalized = text.trim();
  const saving = settings.notice === "Saving";
  const offered = canSubmit(settings, settings.draft, normalized, validReferralCode(normalized));
  const failed = settings.notice === "InvalidDraft" || settings.notice === "SaveFailed";
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (offered) onSave(text);
  };
  return (
    <form className="flex flex-col items-start gap-4" onSubmit={save}>
      <Field label="Link name" className="w-full max-w-md">
        <Input
          type="text"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          required
          maxLength={32}
          disabled={saving}
          invalid={failed}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            onEdit(event.target.value);
          }}
        />
      </Field>
      {settings.savedCode !== "" ? <p className="text-sm text-muted-foreground">Saving a new name stops your current link.</p> : null}
      <Button type="submit" variant="secondary" loading={saving} disabled={!offered}>
        {saving ? "Saving…" : "Save"}
      </Button>
      {settings.notice === "Saved" ? <p role="status">Saved.</p> : null}
      {failed && problem !== undefined ? <Alert variant="destructive">{problem}</Alert> : null}
    </form>
  );
}

/**
 * The Settings section where a member names their referral link and copies it.
 * @model spec/frontend/referralSettings.md
 */
export function ReferralSettings({ settings, origin, problem, onEdit, onSave, onCopy }: ReferralSettingsProps) {
  if (settings.actor === "") return null;
  return (
    <section id="referral" aria-labelledby="referral-heading" className="flex flex-col gap-4">
      <h2 id="referral-heading" className="text-xl font-semibold text-foreground">
        Referral link
      </h2>
      <p>A project listed through your link names you as its referrer.</p>
      {settings.savedCode !== "" ? <Address value={referralLink(origin, settings.savedCode)} label="Your referral link" copyLabel="Copy link" onCopy={onCopy} /> : null}
      <NameForm key={`${settings.lifetime}:${settings.savedCode}`} settings={settings} problem={problem} onEdit={onEdit} onSave={onSave} />
      <p>
        <a href={requestedPage} className="font-medium text-primary underline-offset-4 hover:underline">
          Requested repos
        </a>{" "}
        lists repos Slop contributors want to work on, with a pitch that carries your link.
      </p>
    </section>
  );
}
