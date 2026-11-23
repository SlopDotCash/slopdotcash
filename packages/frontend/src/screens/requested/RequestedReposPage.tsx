// spec/frontend/requestedRepos.md, "Story: See requested repos, flag one, renew or withdraw it"; spec/frontend/composition.md, "Sign-in keeps only a safe same-origin return destination"
import { requestedPage } from "@repo/backend/client";
import type { PageProps } from "../../app/pages.ts";
import { useAddress } from "../../app/useAddress.ts";
import { loginHrefFor, useSession } from "../../app/useSession.ts";
import { writeClipboard } from "../../platform/navigatorClipboard.ts";
import { useView } from "../account/useView.ts";
import { RequestedRepos } from "./RequestedRepos.tsx";
import { actOn, requestedRuntime, retryBoard, watchRequested } from "./runtime.vibe";

const flagAddress = (repo: string) => `${requestedPage}?flag=${encodeURIComponent(repo)}`;

export function RequestedReposPage({ runtime }: PageProps) {
  const section = requestedRuntime(runtime);
  const view = useView(section, watchRequested);
  const shown = useSession(runtime);
  const address = useAddress();
  if (view === undefined) return null;
  const flag = new URL(address, location.origin).searchParams.get("flag");
  return (
    <RequestedRepos
      view={view}
      origin={location.origin}
      flag={flag}
      session={shown?.view ?? { status: "checking" }}
      signInHref={shown === undefined ? "" : loginHrefFor(shown, flag === null ? requestedPage : flagAddress(flag))}
      onAct={(repo, action) => void section.runPromiseExit(actOn(repo, action))}
      onRetry={() => void section.runPromiseExit(retryBoard())}
      onSignedOutFlag={(repo) => location.assign(flagAddress(repo))}
      onCopy={writeClipboard}
    />
  );
}
