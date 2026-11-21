import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

const advisoryUrl = "https://github.com/advisories/GHSA-fc5q-39xc-vjpf";
const packageCopies = {
  picomatch: { version: "4.0.5", consumers: ["vite", "tinyglobby", "fdir"] },
  "micromatch/picomatch": { version: "2.3.2", consumers: ["micromatch"] },
};

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readAuditReport(result) {
  const diagnostics = stripVTControlCharacters(result.stderr ?? "").trim();
  if (
    result.error ||
    result.signal ||
    ![0, 1].includes(result.status) ||
    (diagnostics &&
      !/^bun audit v\d+\.\d+\.\d+ \([0-9a-f]+\)$/u.test(diagnostics))
  ) {
    throw new Error("The registry audit did not return a verified response.");
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error("The registry audit did not return JSON.");
  }
  if (
    !isObject(report) ||
    !Object.values(report).every(
      (advisories) =>
        Array.isArray(advisories) &&
        advisories.length > 0 &&
        advisories.every(isObject),
    ) ||
    result.status !== (Object.keys(report).length === 0 ? 0 : 1)
  ) {
    throw new Error("The registry audit report and exit status disagree.");
  }
  return report;
}

function assertSha256(path, expected) {
  const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (actual !== expected) {
    throw new Error(`Reviewed SHA-256 mismatch: ${path}`);
  }
}

function verifyPackageFiles(root, directory, hashes) {
  let checked = 0;
  let bunMarker = false;
  for (const entry of readdirSync(join(root, directory), {
    withFileTypes: true,
  })) {
    const path = directory === "" ? entry.name : `${directory}/${entry.name}`;
    // Bun adds an empty patch-cache marker outside the published package bytes.
    if (
      directory === "" &&
      !bunMarker &&
      entry.isFile() &&
      /^\.bun-tag-[0-9a-f]{16}$/u.test(entry.name) &&
      readFileSync(join(root, path)).length === 0
    ) {
      bunMarker = true;
      continue;
    }
    if (entry.isDirectory()) {
      checked += verifyPackageFiles(root, path, hashes);
    } else {
      if (!entry.isFile() || !Object.hasOwn(hashes, path)) {
        throw new Error(
          `Unexpected installed package file: ${join(root, path)}`,
        );
      }
      assertSha256(join(root, path), hashes[path]);
      checked++;
    }
  }
  return checked;
}

export function verifyPicomatchBackports(root) {
  root = realpathSync(root);
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const lock = Bun.JSONC.parse(readFileSync(join(root, "bun.lock"), "utf8"));
  const { packages } = JSON.parse(
    readFileSync(
      join(root, "scripts/picomatch-backport-integrity.json"),
      "utf8",
    ),
  );

  const copies = Object.entries(lock.packages ?? {}).filter(
    ([name, entry]) =>
      name === "picomatch" ||
      name.endsWith("/picomatch") ||
      (typeof entry?.[0] === "string" && entry[0].startsWith("picomatch@")),
  );
  if (
    copies.length !== Object.keys(packageCopies).length ||
    !copies.every(([name]) => Object.hasOwn(packageCopies, name)) ||
    Object.keys(packages ?? {}).length !== copies.length
  ) {
    throw new Error("The lockfile has unexpected Picomatch copies.");
  }

  for (const [name, { version, consumers }] of Object.entries(packageCopies)) {
    const expected = packages[name];
    const identity = `picomatch@${version}`;
    const entry = lock.packages[name];
    const patch = `patches/${identity}.patch`;
    if (
      expected?.version !== version ||
      !Array.isArray(entry) ||
      entry.length !== 4 ||
      entry[0] !== identity ||
      entry[1] !== "" ||
      !isObject(entry[2]) ||
      Object.keys(entry[2]).length !== 0 ||
      typeof expected.integrity !== "string" ||
      !expected.integrity.startsWith("sha512-") ||
      entry[3] !== expected.integrity ||
      manifest.patchedDependencies?.[identity] !== patch ||
      lock.patchedDependencies?.[identity] !== patch
    ) {
      throw new Error(
        `The reviewed lock or patch mapping changed for ${identity}.`,
      );
    }
    assertSha256(join(root, patch), expected.patchSha256);

    const directory = join(
      root,
      "node_modules",
      name.replaceAll("/", "/node_modules/"),
    );
    const installedPackage = join(directory, "package.json");
    const installed = JSON.parse(readFileSync(installedPackage, "utf8"));
    const hashes = expected.files;
    if (
      realpathSync(directory) !== directory ||
      installed.name !== "picomatch" ||
      installed.version !== version ||
      !isObject(hashes) ||
      !Object.hasOwn(hashes, "lib/parse.js") ||
      verifyPackageFiles(directory, "", hashes) !== Object.keys(hashes).length
    ) {
      throw new Error(`The installed bytes changed for ${identity}.`);
    }

    const entryPoint = join(directory, "index.js");
    for (const consumer of consumers) {
      const consumerManifest = join(
        root,
        "node_modules",
        consumer,
        "package.json",
      );
      const consumerRequire = createRequire(realpathSync(consumerManifest));
      if (realpathSync(consumerRequire.resolve("picomatch")) !== entryPoint) {
        throw new Error(
          `${consumer} does not resolve the reviewed ${identity}.`,
        );
      }
    }
  }
}

export function verifyAuditFindings(report, root) {
  const findings = Object.entries(report);
  if (findings.length > 0) {
    const [[name, advisories]] = findings;
    const [advisory] = advisories;
    if (
      findings.length !== 1 ||
      name !== "picomatch" ||
      advisories.length !== 1 ||
      advisory.id !== 1247710 ||
      advisory.url !== advisoryUrl ||
      advisory.severity !== "high" ||
      advisory.vulnerable_versions !== "<=4.0.7"
    ) {
      throw new Error("The registry audit reported an unresolved advisory.");
    }
  }
  verifyPicomatchBackports(root);
  return findings.length !== 0;
}

if (import.meta.main) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  try {
    const report = readAuditReport(
      spawnSync(process.execPath, ["--no-env-file", "audit", "--json"], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        timeout: 60_000,
      }),
    );
    console.log(
      JSON.stringify(report, null, process.argv.includes("--json") ? 0 : 2),
    );
    const reported = verifyAuditFindings(report, root);
    console.error(
      reported
        ? "GHSA-fc5q-39xc-vjpf: verified local backports of both reported Picomatch copies."
        : "Registry audit is clean. Both local Picomatch backports were verified.",
    );
  } catch (error) {
    console.error(
      `Dependency audit failed: ${JSON.stringify(error instanceof Error ? error.message : "unknown failure")}`,
    );
    process.exitCode = 1;
  }
}
