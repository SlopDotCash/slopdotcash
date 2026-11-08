/**
 * Keep Quint's pinned parser, init conversion, TLA postprocessor and TLC runner,
 * but translate through Apalache's local parse command. The packaged gRPC
 * launcher binds every interface even when its client requests localhost.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { normalizeTlaFolds } from "./quint-tla-normalization.mjs";

const require = createRequire(import.meta.url);
const packagePath = require.resolve("@informalsystems/quint/package.json");
const packageRoot = dirname(packagePath);
const version = JSON.parse(readFileSync(packagePath, "utf8")).version;
if (version !== "0.33.1")
  throw new Error("Review the local translation bridge before changing Quint");

const { fetchApalache } = require(join(packageRoot, "dist/src/apalache.js"));
const { apalacheDistDir } = require(join(packageRoot, "dist/src/config.js"));
const { postprocessTlaplus } = require(
  join(packageRoot, "dist/src/tlaplusPostprocessing.js"),
);
const { right } = require("@sweet-monads/either");
const compiler = require(join(packageRoot, "dist/src/compileToTlaplus.js"));
const tlc = require(join(packageRoot, "dist/src/tlc.js"));
// JAR from the official v0.62.4 apalache.tgz release asset. The release archive
// digest and independent download receipt are recorded in the transport audit.
const APALACHE_SHA256 =
  "e5223915507b65cc5f1638bd037ede60f8a4fc1644aff46355779f9b05df9262";
function verifiedJar(apalacheVersion) {
  if (apalacheVersion !== "0.62.4")
    throw new Error(
      "Review the local translation bridge before changing Apalache",
    );
  const path = join(
    apalacheDistDir(apalacheVersion),
    "apalache/lib/apalache.jar",
  );
  const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (digest !== APALACHE_SHA256)
    throw new Error("Apalache JAR differs from the approved v0.62.4 release");
  return path;
}
const verifyTlc = tlc.verify;
tlc.verify = async (config, apalacheVersion, ...args) => {
  verifiedJar(apalacheVersion);
  const result = await verifyTlc(config, apalacheVersion, ...args);
  verifiedJar(apalacheVersion);
  return result;
};

compiler.compileToTlaplus = async (
  _endpoint,
  apalacheVersion,
  parseDataJson,
  verbosity,
) => {
  if (apalacheVersion !== "0.62.4")
    throw new Error(
      "Review the local translation bridge before changing Apalache",
    );
  const distribution = await fetchApalache(apalacheVersion, verbosity);
  if (distribution.isLeft()) return distribution;
  const directory = mkdtempSync(join(tmpdir(), "slop-quint-translate-"));
  try {
    const input = join(directory, "input.qnt.json");
    // The CLI gives the output module its filename; retain Quint's module name.
    const { modules } = JSON.parse(parseDataJson);
    const output = join(directory, `${modules[0].name}.tla`);
    const config = join(directory, "config.json");
    writeFileSync(input, parseDataJson);
    // Select this empty config instead of discovering user/local config files.
    writeFileSync(config, "{}\n");
    const jar = verifiedJar(apalacheVersion);
    const result = spawnSync(
      "java",
      [
        "-Xmx2G",
        "-jar",
        jar,
        `--config-file=${config}`,
        `--out-dir=${join(directory, "out")}`,
        "parse",
        `--output=${output}`,
        input,
      ],
      {
        cwd: directory,
        encoding: "utf8",
        timeout: 90_000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    if (result.status !== 0 || result.error) {
      throw new Error(
        `Local Apalache translation failed: ${result.error?.message || `${result.stdout ?? ""}${result.stderr ?? ""}`}`,
      );
    }
    verifiedJar(apalacheVersion);
    // Preserve literal data while applying the required fold rewrite.
    const tla = normalizeTlaFolds(readFileSync(output, "utf8"));
    console.log(
      `[local-translator] Apalache ${apalacheVersion} sha256=${APALACHE_SHA256}`,
    );
    return right(postprocessTlaplus(tla));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};
