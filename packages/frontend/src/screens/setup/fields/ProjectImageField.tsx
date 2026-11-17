// spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
import { Avatar, FileField, Label } from "@repo/ui";
import { Cause, Effect, Exit } from "effect";
import { ImagePlus } from "lucide-react";
import { useState } from "react";
import { projectImage } from "../../../../gen/frontend__presentation.ts";
import { projectImageOf } from "./image.vibe";

export type ProjectImageFieldProps = {
  value: string;
  onChange: (value: string) => void;
  ownerLogin?: string;
  compact?: boolean;
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
export function ProjectImageField({ value, onChange, ownerLogin = "", compact = false }: ProjectImageFieldProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const shown = projectImage(value, ownerAvatar(ownerLogin));
  const choose = async (file: File) => {
    setBusy(true);
    setError("");
    const exit = await Effect.runPromiseExit(projectImageOf(file));
    setBusy(false);
    if (Exit.isSuccess(exit)) onChange(exit.value);
    else setError(refusal(exit.cause));
  };
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="project-image">Project image (optional)</Label>
      {compact ? null : (
        <p id="project-image-help" className="text-sm text-muted-foreground">
          Shown on cards and your project page. Without an image, your GitHub owner avatar is used.
        </p>
      )}
      <FileField
        id="project-image"
        accept="image/png,image/jpeg,image/webp"
        aria-describedby={compact ? undefined : "project-image-help"}
        chooseLabel="Choose image"
        removeLabel="Remove image"
        file={value ? "Custom image" : undefined}
        loading={busy}
        invalid={error !== ""}
        preview={value !== "" ? <img src={value} alt="" width={64} height={64} /> : ownerLogin ? <Avatar name={ownerLogin} src={shown} size="lg" /> : <ImagePlus aria-hidden className="size-8 text-muted-foreground" />}
        onFiles={([file]) => {
          if (file) void choose(file);
        }}
        onRemove={() => onChange("")}
      />
      {busy ? <p role="status">Preparing image…</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
