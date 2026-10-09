/** Parse the existing strict --name value syntax used by chain-verification CLIs. */
export function parseValueArguments(
  argv: readonly string[],
  allowed: ReadonlySet<string>,
  usage: string,
): Map<string, string> {
  const parsed = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (
      !name ||
      !allowed.has(name) ||
      !value ||
      value.startsWith("--") ||
      parsed.has(name)
    ) {
      throw new TypeError(usage);
    }
    parsed.set(name, value);
  }
  return parsed;
}
