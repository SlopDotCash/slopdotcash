/** The message of a thrown value; a non-Error value gets the fallback. */
export function errorMessage(
  error: unknown,
  fallback = "Something went wrong.",
): string {
  return error instanceof Error ? error.message : fallback;
}
