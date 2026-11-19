// spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
import { Avatar, Button, cn } from "@repo/ui";
import { Cause, Effect, Exit } from "effect";
import { ImagePlus, X } from "lucide-react";
import { useState } from "react";
import { projectImage } from "../../../../gen/frontend__presentation.ts";
import { projectImageOf } from "./image.vibe";

export type ProjectImageFieldProps = {
  value: string;
  onChange: (value: string) => void;
  ownerLogin?: string;
};

/** @throws {never} */
export function ownerAvatar(login: string): string {
  return login === "" ? "" : `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?size=128`;
}

function refusal(cause: Cause.Cause<unknown>): string {
  const error: unknown = Cause.squash(cause);
  return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : "The image could not be read.";
}

/** The project's own image, re-encoded in the browser as a small square; without one, the GitHub owner avatar. */
export function ProjectImageField({ value, onChange, ownerLogin = "" }: ProjectImageFieldProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const choose = async (file: File) => {
    setBusy(true);
    setError("");
    const exit = await Effect.runPromiseExit(projectImageOf(file));
    setBusy(false);
    if (Exit.isSuccess(exit)) onChange(exit.value);
    else setError(refusal(exit.cause));
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="project-image" title="Project image" className={cn("flex size-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-border bg-muted *:size-full *:object-cover has-focus-visible:ring-2 has-focus-visible:ring-ring", busy && "cursor-progress opacity-60")}>
        {value !== "" ? <img src={value} alt="Project avatar preview" width={64} height={64} /> : ownerLogin ? <Avatar name={ownerLogin} src={projectImage(value, ownerAvatar(ownerLogin))} size="lg" /> : <ImagePlus aria-hidden className="size-8! text-muted-foreground" />}
        <span className="sr-only">Project image (optional)</span>
        <input
          id="project-image"
          aria-label="Project image (optional)"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void choose(file);
          }}
        />
      </label>
      {value !== "" ? (
        <Button variant="ghost" size="icon" title="Remove image" aria-label="Remove image" disabled={busy} onClick={() => onChange("")}>
          <X aria-hidden className="size-4" />
        </Button>
      ) : null}
      {busy ? <p role="status">Preparing image…</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
