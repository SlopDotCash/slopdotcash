/** Repository source census. Mapping is review evidence, not a refinement proof. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  listModels,
  modelScenarios,
  modelSources,
  writeOrCompareIndex,
} from "./formal-models.mjs";

const root = resolve(import.meta.dirname, "..");
const write = process.argv.includes("--write");
const requireMapped = process.argv.includes("--require-mapped");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const stateless = new Map(
  Object.entries(
    JSON.parse(readFileSync(resolve(root, "formal/stateless.json"), "utf8")),
  ),
);
for (const [path, reason] of stateless)
  if (typeof reason !== "string" || !reason.trim())
    throw new Error(`Missing stateless review reason for ${path}`);
const models = listModels(root).map((path) => {
  const source = readFileSync(resolve(root, path), "utf8");
  return {
    path,
    sha256: digest(source),
    sources: modelSources(source).sort(),
    scenarios: modelScenarios(source).sort(),
  };
});
const paths = [
  ...new Set(
    execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: root, encoding: "utf8" },
    ).split("\0"),
  ),
]
  .filter((path) => path && existsSync(resolve(root, path)))
  .filter(
    (path) =>
      /^(src|backend|workers|functions|scripts|skills|contracts|migrations|\.github\/workflows)\//u.test(
        path,
      ) ||
      /^(package\.json|(?:vite|playwright)\.config\.ts|wrangler\.toml)$/u.test(
        path,
      ),
  )
  .filter(
    (path) =>
      /\.(?:[cm]?[jt]sx?|rs|sol|py|sh|sql|ya?ml|toml)$/u.test(path) ||
      path === "package.json",
  )
  .filter((path) => !/(?:^|\/)(?:tests|test|fixtures|target|out)\//u.test(path))
  .filter(
    (path) =>
      !/\.(?:test|spec|integration|e2e|workflow)\.[cm]?[jt]sx?$/u.test(path),
  )
  .filter(
    (path) => !/\.d\.[cm]?ts$/u.test(path) && !path.endsWith("vite-env.d.ts"),
  )
  .filter((path) => !/\.generated\.(?:mjs|ts)$/u.test(path))
  .sort();
const sources = paths.map((path) => {
  const source = readFileSync(resolve(root, path), "utf8");
  const linkedModels = models
    .filter((model) => model.sources.includes(path))
    .map((model) => model.path);
  // Lexical discovery aids review. It cannot classify all implicit state or
  // prove that any candidate is reachable; reviewers retain that obligation.
  const candidates = source
    .split("\n")
    .flatMap((line, index) =>
      /\b(?:useState|useReducer|useEffect|setTimeout|setInterval|INSERT|UPDATE|DELETE|CREATE TRIGGER|state|status|lease|retry|pending|finalized|writeFile|rename|compare_exchange)\b/iu.test(
        line,
      )
        ? [index + 1]
        : [],
    );
  return {
    path,
    sha256: digest(source),
    models: linkedModels,
    candidateLines: candidates,
    review: linkedModels.length
      ? "mapped-abstraction"
      : stateless.has(path)
        ? "reviewed-no-independent-state"
        : "pending",
    ...(stateless.has(path) ? { statelessReason: stateless.get(path) } : {}),
  };
});
const actual = new Set(paths);
for (const path of stateless.keys())
  if (
    !actual.has(path) &&
    !(existsSync(resolve(root, path)) && /\.d\.[cm]?ts$/u.test(path))
  )
    throw new Error(`Stateless review names absent source ${path}`);
for (const model of models)
  for (const path of model.sources) {
    if (!actual.has(path))
      throw new Error(
        `${model.path} refers to absent or excluded source ${path}`,
      );
  }
const manifest = {
  schemaVersion: 1,
  baseline: "f4f02c250e4cd1a1db2021c3cb182df96c5cd2de",
  reviewStartedAt: "e3d7dea64f1171f5761033069b98de4fd5cc1e77",
  meaning:
    "Current production source census with lexical state candidates and model links. A mapping is not a complete branch or semantic refinement proof. Pending is unfinished review work.",
  exclusions:
    "Dependencies, generated build outputs, test/fixture trees, declarations and integration test entry points are not production state machines. Generated registry source remains inventoried through its generator.",
  sources,
  models,
};
writeOrCompareIndex(
  root,
  "formal/inventory.json",
  manifest,
  write,
  "Formal inventory changed. Review source/model changes, then run bun run formal:inventory:update.",
);
const pending = sources.filter((source) => source.review === "pending").length;
console.log(
  `${sources.length} source files, ${models.length} models, ${pending} files pending mapping. Mapping does not establish refinement.`,
);
if (requireMapped && pending) process.exitCode = 1;
