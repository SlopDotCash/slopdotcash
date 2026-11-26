// spec/security/admission.md, "Every reviewed batch covers the next unreviewed inventory entries"
import { binaryMagic } from "./magic.ts";
import type { BulkClass, ScanSurface } from "./model.ts";

const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "cargo.lock",
  "poetry.lock",
  "pipfile.lock",
  "uv.lock",
  "go.sum",
  "gemfile.lock",
  "composer.lock",
  "flake.lock",
  "deno.lock",
  "pdm.lock",
  "pubspec.lock",
  "mix.lock",
  "podfile.lock",
  "packages.lock.json",
  "gradle.lockfile",
  "conda-lock.yml",
]);
const MANIFESTS = new Set([
  "package.json",
  "pyproject.toml",
  "setup.cfg",
  "pipfile",
  "cargo.toml",
  "go.mod",
  "gemfile",
  "composer.json",
  "build.gradle",
  "build.gradle.kts",
  "pom.xml",
  "deno.json",
  "deno.jsonc",
  "flake.nix",
  "mix.exs",
  "podfile",
  "conanfile.txt",
]);
const AGENT_INSTRUCTIONS = new Set([
  "agents.md",
  "claude.md",
  "gemini.md",
  "contributing.md",
  "readme.md",
  "skill.md",
  ".cursorrules",
  ".windsurfrules",
  ".clinerules",
  ".goosehints",
  ".continuerules",
  ".rules",
  "copilot-instructions.md",
  "warp.md",
  "claude.local.md",
  "llms.txt",
]);
const PACKAGE_MANAGER_CONFIGS = new Set([
  ".npmrc",
  ".pypirc",
  ".yarnrc",
  ".yarnrc.yml",
  ".pnpmfile.cjs",
  "bunfig.toml",
  "pip.conf",
  "pip.ini",
]);
const INSTALL_FILES = new Set([
  "setup.py",
  "setup.hs",
  "setup.lhs",
  "build.rs",
  "extconf.rb",
  "makefile",
  "makefile.pl",
  "justfile",
  "install.sh",
  "postinstall.js",
  "preinstall.js",
  ".pnpmfile.cjs",
  ".pnpmfile.js",
  ".envrc",
  "tasks.json",
  "tox.ini",
  "tox.toml",
  "devcontainer.json",
  "gnumakefile",
  "dockerfile",
  "containerfile",
  "jenkinsfile",
  "vagrantfile",
  "rakefile",
  "rakefile.rb",
  "gemfile",
  "gems.rb",
  "brewfile",
  "procfile",
  "cmakelists.txt",
  "meson.build",
  "earthfile",
  "sconstruct",
  "sconscript",
  "wscript",
  "wscript_build",
  "makefile.am",
  "makefile.in",
  "gnumakefile.in",
  "configure.ac",
  "build",
  "build.pl",
  "build.sbt",
  "build.boot",
  "build.bazel",
  "module.bazel",
  "workspace",
  "workspace.bazel",
  "docker-bake.hcl",
  "docker-bake.override.hcl",
  "makefile.inc",
  "configure.in",
  "build.xml",
  "build.zig",
  "build.zig.zon",
  "build.ninja",
  "tupfile",
  "tuprules.tup",
]);

const MSBUILD_EXTENSIONS = "csproj|fsproj|vbproj|vcxproj|proj|props|targets";
const GYP_EXTENSION = "gyp|gypi";
const BUILD_RECIPE = new RegExp(
  String.raw`(?:^|\/)(?:dockerfile|containerfile|jenkinsfile)(?:\.[^/]+)?$|\.(?:dockerfile|cmake|sbt|bzl|bazel|m4|hcl|ninja|rake|mk|make|${MSBUILD_EXTENSIONS}|${GYP_EXTENSION})$`,
  "u",
);
export const MSBUILD_RECIPE = new RegExp(String.raw`\.(?:${MSBUILD_EXTENSIONS})$`, "iu");
export const ANT_BUILD_XML = /(?:^|\/)build\.xml$/iu;
export const GYP_SOURCE = new RegExp(String.raw`\.(?:${GYP_EXTENSION})$`, "iu");
export const CMAKE_SOURCE = /(?:^|\/)cmakelists\.txt$|\.cmake$/iu;
const CARGO_CONFIG = /(?:^|\/)\.cargo\/config(?:\.toml)?$/u;
const SOURCE_EXTENSIONS =
  /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kt|kts|swift|c|cc|cpp|h|hpp|cs|php|sh|bash|zsh|ps1|psm1|bat|cmd|lua|pl|r|scala|sol|move|vue|svelte|astro|toml|ya?ml|json|gradle|nix|mk)$/iu;
export const EXECUTABLE_BINARIES = /\.(?:node|wasm|so|dylib|dll|exe|jar|pyc|class|bin|a|o)$/iu;
export const ARCHIVES = /\.(?:zip|tar|tgz|gz|bz2|xz|7z|rar|whl|gem|crate)$/iu;

const CONFIG_JSON =
  /(?:^|\/)(?:tsconfig[^/]*|jsconfig[^/]*|\.?eslintrc[^/]*|\.babelrc|babel\.config|\.swcrc|turbo|nx|lerna|vercel|netlify|wrangler|app|manifest|renovate|\.prettierrc|biome|components|project|angular|firebase|now)\.json$/iu;
const GENERATED =
  /(?:^|\/)(?:dist|build|out|\.next|\.output|coverage)\/|\.min\.(?:m?js|css)$|(?:^|\/)(?:assets|static|public)\/(?:[^/]+\/)*[^/]+[-.][A-Za-z0-9_-]{8,}\.m?js$/u;
const VENDORED = /(?:^|\/)(?:vendor|third_party|third-party|node_modules)\//u;

/** @throws {never} */
export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).toLowerCase();
}

/** @throws {never} */
export function inDirectory(path: string, directory: string): boolean {
  return path.startsWith(`${directory}/`) || path.includes(`/${directory}/`);
}

/** @throws {never} */
export function knownScanPath(path: string): boolean {
  return surfacesOf(path).length > 0 || EXECUTABLE_BINARIES.test(path) || ARCHIVES.test(path);
}

/** @throws {never} */
export function opaqueArtifact(path: string, bytes: Uint8Array): boolean {
  return EXECUTABLE_BINARIES.test(path) || ARCHIVES.test(path) || binaryMagic(bytes);
}

/** @throws {never} */
export function surfacesOf(path: string): ScanSurface[] {
  const lower = path.toLowerCase();
  const name = basename(path);
  const surfaces = new Set<ScanSurface>();
  const rubyManifest = !name.endsWith(".lock") && /^(?:gemfile(?:\..+)?|.+\.gemfile|gems\.rb)$/u.test(name);
  if (LOCKFILES.has(name) || /^requirements[^/]*\.txt$/u.test(name) || /(?:^|\/)requirements\/[^/]*\.txt$/u.test(lower))
    surfaces.add("dependencies");
  if (MANIFESTS.has(name) || name.endsWith(".gemspec") || rubyManifest) surfaces.add("manifests");
  if (
    name.endsWith(".md") ||
    AGENT_INSTRUCTIONS.has(name) ||
    inDirectory(lower, ".cursor") ||
    inDirectory(lower, ".claude") ||
    inDirectory(lower, ".github/instructions") ||
    inDirectory(lower, ".github/chatmodes") ||
    inDirectory(lower, ".junie") ||
    inDirectory(lower, ".idx") ||
    inDirectory(lower, ".windsurf")
  )
    surfaces.add("agentInstructions");
  if (
    INSTALL_FILES.has(name) ||
    rubyManifest ||
    PACKAGE_MANAGER_CONFIGS.has(name) ||
    CARGO_CONFIG.test(lower) ||
    BUILD_RECIPE.test(lower) ||
    inDirectory(lower, ".husky") ||
    inDirectory(lower, ".devcontainer") ||
    inDirectory(lower, ".vscode") ||
    /(?:^|\/)(?:install|setup|bootstrap)[^/]*\.(?:sh|ps1|bat|cmd|py|js|mjs)$/u.test(lower)
  )
    surfaces.add("installScripts");
  if (SOURCE_EXTENSIONS.test(name) || surfaces.size > 0) surfaces.add("source");
  return [...surfaces];
}

/** @throws {never} */
export function bulkClass(path: string, surfaces: ReadonlyArray<ScanSurface>): BulkClass | null {
  if (surfaces.includes("installScripts") || surfaces.includes("agentInstructions") || surfaces.includes("manifests")) return null;
  const lower = path.toLowerCase();
  if (surfaces.includes("dependencies")) return "lockfile";
  if (VENDORED.test(lower)) return "vendored";
  if (GENERATED.test(lower)) return "generated";
  if (
    lower.endsWith(".json") &&
    !CONFIG_JSON.test(lower) &&
    !lower.includes("/.vscode/") &&
    !inDirectory(lower, ".vscode") &&
    !inDirectory(lower, ".claude") &&
    !inDirectory(lower, ".cursor") &&
    !lower.startsWith(".github/")
  )
    return "data";
  return null;
}
