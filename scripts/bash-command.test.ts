import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { bashCommand } from "./bash-command";

test.skipIf(process.platform !== "win32")(
  "release checks use the installed Git Bash without standard install roots",
  () => {
    const names = ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"];
    const saved = names.map((name) => process.env[name]);
    try {
      for (const name of names) delete process.env[name];
      const command = bashCommand();
      // An unqualified bash selects the System32 WSL launcher on Windows.
      expect(command).not.toBe("bash");
      const result = spawnSync(
        command,
        ["--noprofile", "--norc", "-c", "printf git-bash-ready"],
        { encoding: "utf8", windowsHide: true },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe("git-bash-ready");
    } finally {
      names.forEach((name, index) => {
        if (saved[index] === undefined) delete process.env[name];
        else process.env[name] = saved[index];
      });
    }
  },
);
