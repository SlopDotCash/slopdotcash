/** Assemble one publication from explicit inputs before Vite serves or builds it. */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const profileInput =
  process.env.SLOP_PROFILES_INPUT ?? "data/profiles/seed.json";
// PR and offline builds deliberately retain the historical seed. A selected
// publication census must also satisfy the current browser inventory.
const currentProfiles =
  realpathSync(resolve(root, profileInput)) !==
  realpathSync(resolve(root, "data/profiles/seed.json"));
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
  // The public record (/record, /receipts) reads the plain leaderboard on disk,
  // so it runs before the transport stage splits it. It never fails a build.
  [process.execPath, ["scripts/record/build-record.mjs"], { soft: true }],
  [process.execPath, ["scripts/prepare-leaderboard-transport.mjs"]],
];
for (const [command, args, options] of stages) {
  if (options?.soft) {
    try {
      execFileSync(command, args, {
        cwd: root,
        stdio: "inherit",
        timeout: 10 * 60_000,
      });
    } catch (error) {
      console.log(`record: stage did not finish (${error.message})`);
    }
    continue;
  }
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}
