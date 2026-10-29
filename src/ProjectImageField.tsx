import { useState } from "react";
import {
  assertProjectImage,
  MAX_PROJECT_IMAGE_LENGTH,
} from "./lib/project-image.mjs";

/** Re-encode uploads as a small avatar; metadata and original bytes stay local. */
export function ProjectImageField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function choose(file: File) {
    setError("");
    setBusy(true);
    try {
      if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(file.type))
        throw new Error("Choose a PNG, JPEG or WebP image.");
      const bitmap = await createImageBitmap(file);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 128;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Image processing is unavailable.");
        const side = Math.min(bitmap.width, bitmap.height);
        context.drawImage(
          bitmap,
          (bitmap.width - side) / 2,
          (bitmap.height - side) / 2,
          side,
          side,
          0,
          0,
          128,
          128,
        );
        let image = canvas.toDataURL("image/webp", 0.8);
        // Unsupported canvas formats fall back to PNG. Use the browser's
        // JPEG encoder when WebP is unavailable instead of mislabelling bytes.
        const format = image.startsWith("data:image/webp;")
          ? "image/webp"
          : "image/jpeg";
        if (format === "image/jpeg") image = canvas.toDataURL(format, 0.8);
        if (image.length > MAX_PROJECT_IMAGE_LENGTH)
          image = canvas.toDataURL(format, 0.5);
        onChange(assertProjectImage(image));
      } finally {
        bitmap.close();
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The image could not be read.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="project-image-field">
      <label htmlFor="project-image">Project image (optional)</label>
      <p id="project-image-help">
        Shown on cards and your project page. Without an image, your GitHub
        owner avatar is used.
      </p>
      {value ? (
        <img src={value} alt="Project avatar preview" width={80} height={80} />
      ) : null}
      <input
        id="project-image"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-describedby="project-image-help"
        disabled={busy}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void choose(file);
        }}
      />
      {value ? (
        <button
          type="button"
          className="button secondary-button"
          disabled={busy}
          onClick={() => onChange("")}
        >
          Remove image
        </button>
      ) : null}
      {busy ? <p role="status">Preparing image…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
