// spec/frontend/presentation.md, "Settings keeps wallet and email controls expanded without account navigation tabs"
import { Alert, Button, CopyButton } from "@repo/ui";
import { useState } from "react";
import { useAction } from "../../app/hooks.ts";
import type { PageRuntime } from "../../app/runtime.vibe";
import { createSecurityReadKey, revokeSecurityReadKey, SECURITY_READ_KEY_NOTICE } from "../../flows/account/securityReadKey.vibe";

export function SecurityReadKey({ runtime, githubId }: { runtime: PageRuntime; githubId: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const { busy, error, notice, setNotice, act } = useAction(runtime);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{SECURITY_READ_KEY_NOTICE}</p>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {notice ? <p role="status" className="text-sm text-foreground">{notice}</p> : null}
      {secret !== null ? (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3">
          <p className="text-xs font-medium text-foreground">Copy this key now. It is shown only once.</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 font-mono text-xs break-all text-foreground">{secret}</code>
            <CopyButton text={secret} label="Copy security read key" />
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          loading={busy}
          onClick={() =>
            void act(createSecurityReadKey(githubId), (created) => {
              setSecret(created);
              setNotice("New personal security read key created. Any previous key stopped working immediately.");
            })
          }
        >
          {secret === null ? "Create read key" : "Rotate read key"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() =>
            void act(revokeSecurityReadKey(githubId), () => {
              setSecret(null);
              setNotice("Security read key revoked.");
            })
          }
        >
          Revoke key
        </Button>
      </div>
    </div>
  );
}
