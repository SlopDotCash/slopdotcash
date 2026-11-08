/** Check actual runtime contracts and preserve generated implementation bodies. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  requireProofIntegrity,
  requireProofObligations,
} from "./lemmascript-integrity.mjs";
import { isExcludedSourceDirectory } from "./lemmascript-source-directories.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv.length !== 2)
  throw new Error("Usage: node scripts/check-lemmascript.mjs");
const directory = join(
  root,
  "evidence/lemmascript",
  `${Date.now()}-${process.pid}`,
);
mkdirSync(directory, { recursive: true });
const sandbox = join(directory, "source");
const results = [];
const obligations = [];
const inputHashes = [];
let failure = null;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sourceRoots = [
  "src",
  "backend",
  "functions",
  "workers",
  "scripts",
  "contracts",
  "skills",
];
const sourcePattern = /\.(?:ts|tsx|mts|mjs|js|json)$/;

function files(path) {
  if (!existsSync(join(root, path))) return [];
  return readdirSync(join(root, path), { withFileTypes: true }).flatMap(
    (entry) => {
      const child = `${path}/${entry.name}`;
      if (
        isExcludedSourceDirectory(child) &&
        (entry.isDirectory() || entry.isSymbolicLink())
      )
        return [];
      if (entry.isSymbolicLink())
        throw new Error(`Source tree has symbolic link: ${child}`);
      return entry.isDirectory() ? files(child) : [child];
    },
  );
}

async function run(command, label, cwd = sandbox) {
  const started = Date.now();
  const result = await new Promise((resolveResult) => {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        PATH: `${join(root, ".tools/dafny/dafny")}:${process.env.PATH ?? ""}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [];
    let bytes = 0;
    let error = null;
    const stop = (message) => {
      error ??= message;
      try {
        if (child.pid && process.platform !== "win32")
          process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch (killError) {
        if (killError.code !== "ESRCH") error += `; ${killError.message}`;
      }
    };
    const timer = setTimeout(() => stop("Verifier exceeded 180000ms"), 180_000);
    const collect = (chunk) => {
      bytes += chunk.length;
      if (bytes > 16 * 1024 * 1024)
        stop("Verifier exceeded 16MiB output limit");
      else chunks.push(chunk);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (cause) => {
      error ??= cause.message;
    });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      resolveResult({
        status,
        signal,
        error,
        output: Buffer.concat(chunks).toString("utf8"),
      });
    });
  });
  const output = result.output;
  const passed = result.status === 0 && !result.error && !result.signal;
  const log = `${label}.log`;
  writeFileSync(join(directory, log), output);
  results.push({
    command,
    label,
    passed,
    exitCode: result.status,
    signal: result.signal,
    durationMs: Date.now() - started,
    log,
    sha256: hash(output),
    error: result.error,
  });
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
  if (!passed)
    throw new Error(`${label}: ${result.error ?? output.slice(-5000)}`);
  return output;
}

try {
  const manifest = readFileSync(join(root, "LemmaScript-files.txt"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (!manifest.length || new Set(manifest).size !== manifest.length) {
    throw new Error(
      "Proof manifest must be nonempty and contain unique source paths",
    );
  }
  for (const file of manifest) {
    if (
      !/^(?:src|backend|functions|workers|scripts|contracts|skills)\/[A-Za-z0-9_./-]+\.ts$/.test(
        file,
      ) ||
      file.split("/").includes("..") ||
      /(?:\.test|\.spec|\.generated|\.d)\.ts$/.test(file)
    ) {
      throw new Error(`Invalid production proof source: ${file}`);
    }
  }
  const config = JSON.parse(
    readFileSync(join(root, "lemmascript.json"), "utf8"),
  );
  if (
    config["proof-dir"] !== "formal/lemmascript" ||
    config["extern-default"] !== "impure" ||
    config["string-semantics"] !== "javascript-utf16" ||
    config["dafny-library"] !== "local"
  ) {
    throw new Error("Unexpected LemmaScript semantic configuration");
  }
  const toolPackage = JSON.parse(
    readFileSync(join(root, "node_modules/lemmascript/package.json"), "utf8"),
  );
  if (toolPackage.version !== "0.6.6")
    throw new Error("Expected LemmaScript 0.6.6");
  const sourceFiles = sourceRoots
    .flatMap(files)
    .filter(
      (file) =>
        sourcePattern.test(file) &&
        !/(?:^|\/)(?:tests|fixtures|integration)\//.test(file) &&
        !/\.(?:test|spec|integration|workflow|e2e)\.(?:ts|tsx|mts|mjs|js)$/.test(
          file,
        ),
    );
  const proofFiles = files("formal/lemmascript").filter((file) =>
    /\.dfy(?:\.gen)?$/.test(file),
  );
  const configurationFiles = readdirSync(root).filter((name) =>
    /^tsconfig.*\.json$/.test(name),
  );
  const inputs = [
    ...new Set([
      ...sourceFiles,
      ...proofFiles,
      ...configurationFiles,
      "LemmaScript-files.txt",
      "lemmascript.json",
      "package.json",
      "bun.lock",
    ]),
  ].sort();
  for (const file of inputs) {
    const bytes = readFileSync(join(root, file));
    inputHashes.push({ path: file, sha256: hash(bytes) });
    const destination = join(sandbox, file);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(root, file), destination);
  }
  symlinkSync(join(root, "node_modules"), join(sandbox, "node_modules"), "dir");
  const lsc = join(root, "node_modules/.bin/lsc");
  const lscVersion = await run([lsc, "version"], "lemmascript-version");
  if (!/\b0\.6\.6\b/.test(lscVersion))
    throw new Error("Unexpected LemmaScript executable version");
  const dafnyVersion = await run(["dafny", "--version"], "dafny-version");
  if (!/^4\.11\.0(?:\+|\s|$)/.test(dafnyVersion.trim()))
    throw new Error("Expected Dafny 4.11.0");

  for (const file of manifest) {
    const label = file.replaceAll("/", "-").replace(/\.ts$/, "");
    const artifact = `formal/lemmascript/${file.replace(/\.ts$/, ".dfy")}`;
    const source = readFileSync(join(root, file), "utf8");
    if (
      /\/\/@\s+(?:assume|extern|havoc|autohavoc|skip|option)\b/.test(source) ||
      /\/\/@\s+(?:requires\s+false|ensures\s+true)\s*(?:\r?\n|$)/.test(source)
    ) {
      throw new Error(
        `Unsupported trusted/omitted source directive in ${file}`,
      );
    }
    const generated = readFileSync(join(root, `${artifact}.gen`), "utf8");
    const proof = readFileSync(join(root, artifact), "utf8");
    requireProofIntegrity(generated, proof);
    const names = requireProofObligations(source, generated);
    obligations.push({ source: file, functions: names });
    const output = await run(
      [
        lsc,
        "check",
        "--backend=dafny",
        "--time-limit=30",
        "--extra-flags=--isolate-assertions",
        file,
      ],
      label,
    );
    if (!/finished with [1-9][0-9]* verified, 0 errors/.test(output)) {
      throw new Error(
        `${file}: no positive completed Dafny verification result`,
      );
    }
    const regenerated = readFileSync(join(sandbox, `${artifact}.gen`), "utf8");
    const checkedProof = readFileSync(join(sandbox, artifact), "utf8");
    if (generated !== regenerated || proof !== checkedProof) {
      throw new Error(
        `${file}: generated artifact or proof differs from the checked-in source`,
      );
    }
    requireProofIntegrity(regenerated, checkedProof);
  }
  for (const input of inputHashes) {
    if (hash(readFileSync(join(root, input.path))) !== input.sha256) {
      throw new Error(
        `Verification input changed while checks ran: ${input.path}`,
      );
    }
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  console.error(failure);
}

const receipt = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  passed: failure === null,
  lemmascriptVersion: "0.6.6",
  dafnyVersion: "4.11.0",
  failure,
  inputs: inputHashes,
  obligations,
  results,
  limitations: [
    "Only listed runtime function contracts are checked; other functions remain unproved.",
    "Source-to-prover translation and the prover are trusted; this is not whole-application verification.",
    "JavaScript number proofs apply only within each contract's integer and magnitude domain.",
    "External providers, runtime validation, effects, and concurrent state require separate evidence.",
  ],
};
writeFileSync(
  join(directory, "result.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
);
console.log(`Evidence: ${directory}/result.json`);
if (failure !== null) process.exitCode = 1;
