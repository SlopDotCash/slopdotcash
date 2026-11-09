/**
 * Confirms that a Worker's single active deployment is the version tagged
 * with the released source commit. Callers read both Wrangler outputs and
 * supply their own failure message; the version id is returned on success.
 */
export function assertActiveVersionTagged({
  deployment,
  versions,
  sha,
  message,
}) {
  const active = deployment?.versions;
  if (
    !Array.isArray(active) ||
    active.length !== 1 ||
    active[0].percentage !== 100 ||
    !Array.isArray(versions) ||
    !versions.some(
      (version) =>
        version.id === active[0].version_id &&
        version.annotations?.["workers/tag"] === sha,
    )
  )
    throw new Error(message);
  return active[0].version_id;
}
