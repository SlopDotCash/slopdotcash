/** Small, self-contained WebP avatars stay in the immutable project revision. */
export const MAX_PROJECT_IMAGE_LENGTH = 16_384;

export function assertProjectImage(value) {
  if (
    typeof value !== "string" ||
    value.length > MAX_PROJECT_IMAGE_LENGTH ||
    !/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/u.test(value)
  )
    throw new TypeError("Project image must be a small WebP image.");
  let bytes;
  try {
    bytes = atob(value.slice(value.indexOf(",") + 1));
  } catch {
    throw new TypeError("Project image encoding is invalid.");
  }
  if (bytes.slice(0, 4) !== "RIFF" || bytes.slice(8, 12) !== "WEBP")
    throw new TypeError("Project image must contain WebP bytes.");
  return value;
}
