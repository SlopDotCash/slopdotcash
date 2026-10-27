/**
 * A comma-separated allowlist of permanent GitHub account IDs. Entries are
 * trimmed and empty entries are skipped. A malformed entry throws an error
 * that names the variable, never its value, so a typo cannot silently remove
 * an authorized account.
 */
export function githubIdSet(
  value: string | undefined,
  variable: string,
): Set<string> {
  const ids = new Set<string>();
  for (const entry of (value ?? "").split(",")) {
    const id = entry.trim();
    if (id === "") continue;
    if (!/^[1-9][0-9]{0,19}$/u.test(id))
      throw new Error(`${variable} contains a malformed GitHub ID`);
    ids.add(id);
  }
  return ids;
}
