// spec/points/window.md, "Publication needs a verified complete census; a failure keeps the previous window"

/** @throws {Error} */
export function enterDirectory(directory: string): string {
  const before = process.cwd();
  process.chdir(directory);
  return before;
}
