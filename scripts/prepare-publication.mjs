/** Assemble one publication from explicit inputs before Vite serves or builds it. */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const stages = [
  [process.execPath, ["scripts/prepare-site.mjs"]],
  ["bun", ["scripts/generate-points.ts"]],
  [
    "bun",
    [
      "scripts/generate-profiles.ts",
      "--input",
      process.env.SLOP_PROFILES_INPUT ?? "data/profiles/seed.json",
    ],
  ],
];
for (const [command, args] of stages) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}
