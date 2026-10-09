/** Resolve the pinned skill validation runtime for production and fixtures. */
import { execFileSync } from "node:child_process";

export function pythonCommand(cwd) {
  const candidates = [
    process.env.SLOP_PYTHON,
    "python3",
    "/usr/bin/python3",
  ].filter((value, index, values) => value && values.indexOf(value) === index);
  for (const executable of candidates) {
    try {
      execFileSync(
        executable,
        [
          "-c",
          "import yaml,sys;sys.exit(0 if yaml.__version__ == '6.0.3' else 1)",
        ],
        { cwd, stdio: "ignore" },
      );
      return { executable, prefix: [] };
    } catch {
      // error-policy:J3 an unavailable validator runtime tries the next pinned path.
    }
  }
  try {
    execFileSync("uv", ["--version"], { stdio: "ignore" });
    return {
      executable: "uv",
      prefix: ["run", "--with", "PyYAML==6.0.3", "python"],
    };
  } catch {
    throw new TypeError(
      "[Slop] skill packaging requires Python with PyYAML 6.0.3 or uv; set SLOP_PYTHON to an interpreter with that exact version",
    );
  }
}
