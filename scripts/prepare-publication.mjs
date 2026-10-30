/** Assemble one publication from explicit inputs before Vite serves or builds it. */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const profileInput =
  process.env.SLOP_PROFILES_INPUT ?? "data/profiles/seed.json";
// PR and offline builds deliberately retain the historical seed. A selected
// publication census must also satisfy the current browser inventory.
const currentProfiles =
  resolve(root, profileInput) !== resolve(root, "data/profiles/seed.json");
const stages = [
  [process.execPath, ["scripts/prepare-site.mjs"]],
  ["bun", ["scripts/generate-points.ts"]],
  [
    "bun",
    [
      "scripts/generate-profiles.ts",
      "--input",
      profileInput,
      ...(currentProfiles ? ["--current"] : []),
    ],
  ],
  [process.execPath, ["scripts/prepare-leaderboard-transport.mjs"]],
];
for (const [command, args] of stages) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}
