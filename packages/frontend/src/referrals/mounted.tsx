// spec/frontend/referralSettings.md, "A loaded account owns the displayed link and the editable draft"; spec/frontend/referralSettings.md, "Exactly one request can act for each active account lifetime"
import { Cause, Exit } from "effect";
import { useState } from "react";
import { useMachine } from "../../gen/frontend__referralSettings.react.ts";
import type { PageRuntime } from "../app/runtime.vibe";
import { writeClipboard } from "../platform/navigatorClipboard.ts";
import { ReferralSettings } from "./ReferralSettings.tsx";
import { editDraft, referralRuntime, saveDraft } from "./runtime.vibe";

export function ReferralSection({ runtime }: { runtime: PageRuntime }) {
  const section = referralRuntime(runtime);
  const { state, cause } = useMachine(section);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  if (cause) throw Cause.squash(cause);
  if (state === undefined) return null;
  return (
    <ReferralSettings
      settings={state}
      origin={location.origin}
      problem={problem}
      onEdit={(text) => void section.runPromiseExit(editDraft(text))}
      onSave={(text) =>
        void section.runPromiseExit(saveDraft(text)).then((exit) => {
          if (Exit.isSuccess(exit)) setProblem(exit.value.problem);
        })
      }
      onCopy={writeClipboard}
    />
  );
}
