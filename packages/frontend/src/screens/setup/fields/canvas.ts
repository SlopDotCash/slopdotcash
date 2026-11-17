// spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
const accepted = new Set(["image/png", "image/jpeg", "image/webp"]);
const side = 128;

/** @throws {Error} */
export async function squareImage(file: Blob, maxLength: number): Promise<string> {
  if (!accepted.has(file.type)) throw new Error("Choose a PNG, JPEG or WebP image.");
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image processing is unavailable.");
    const crop = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - crop) / 2, (bitmap.height - crop) / 2, crop, crop, 0, 0, side, side);
    const webp = canvas.toDataURL("image/webp", 0.8);
    const format = webp.startsWith("data:image/webp;") ? "image/webp" : "image/jpeg";
    const image = format === "image/webp" ? webp : canvas.toDataURL(format, 0.8);
    return image.length > maxLength ? canvas.toDataURL(format, 0.5) : image;
  } finally {
    bitmap.close();
  }
}
