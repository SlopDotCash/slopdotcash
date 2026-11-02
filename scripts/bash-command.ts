import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

const windowsBashPaths = () =>
  [
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "Programs")
      : undefined,
  ]
    .filter((directory): directory is string => Boolean(directory))
    .map((directory) => join(directory, "Git", "bin", "bash.exe"))
    .concat(
      (process.env.PATH ?? "")
        .split(delimiter)
        .filter(
          (directory) => directory && existsSync(join(directory, "git.exe")),
        )
        .flatMap((directory) => [
          join(directory, "bash.exe"),
          join(directory, "..", "bin", "bash.exe"),
        ]),
    );

/**
 * CI uses PATH lookup for Bash. On Windows, System32 bash.exe is the WSL
 * launcher, so a normal repository checkout needs Git Bash instead. Portable
 * installations can live outside the standard roots; use the Git on PATH too.
 */
export const bashCommand = () =>
  process.platform === "win32"
    ? (windowsBashPaths().find((candidate) => existsSync(candidate)) ?? "bash")
    : "bash";
