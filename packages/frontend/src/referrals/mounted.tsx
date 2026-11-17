// spec/frontend/referralSettings.md, "A loaded account owns the displayed link and the editable draft"; spec/frontend/referralSettings.md, "Exactly one request can act for each active account lifetime"
import type { PageRuntime } from "../app/runtime.vibe";
import { writeClipboard } from "../platform/navigatorClipboard.ts";
import { useView } from "../screens/account/useView.ts";
import { ReferralSettings } from "./ReferralSettings.tsx";
import { editDraft, referralRuntime, saveDraft, watchReferral } from "./runtime.vibe";

export function ReferralSection({ runtime }: { runtime: PageRuntime }) {
  const section = referralRuntime(runtime);
  const view = useView(section, watchReferral);
  if (view === undefined) return null;
  return (
    <ReferralSettings
      settings={view.settings}
      origin={location.origin}
      problem={view.problem}
      onEdit={(text) => void section.runPromiseExit(editDraft(text))}
      onSave={(text) => void section.runPromiseExit(saveDraft(text))}
      onCopy={writeClipboard}
    />
  );
}
