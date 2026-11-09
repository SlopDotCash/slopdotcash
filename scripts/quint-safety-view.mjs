/** Exact-source safety views; full models and normal scenarios stay unchanged. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { join } from "node:path";

const hash = (text) => createHash("sha256").update(text).digest("hex");
const identifier = /^[A-Za-z][A-Za-z0-9_]*$/u;
const digest = /^[0-9a-f]{64}$/u;
const fields = [
  "store",
  "memory",
  "held",
  "used",
  "mounted",
  "before",
  "touched",
  "observed",
  "expected",
  "wrote",
];

export function readSafetyViews(root) {
  const manifest = JSON.parse(
    readFileSync(join(root, "formal/tlc-safety-views.json"), "utf8"),
  );
  if (
    Object.keys(manifest).sort().join(",") !==
      "quintAdapterSha256,schemaVersion,views" ||
    manifest.schemaVersion !== 1 ||
    !digest.test(manifest.quintAdapterSha256) ||
    !Array.isArray(manifest.views) ||
    manifest.views.length !== 1
  )
    throw new Error("Unreviewed TLC safety-view manifest");
  const view = manifest.views[0];
  if (
    Object.keys(view).sort().join(",") !==
      "fields,id,model,module,operator,sourceSha256,translatedSha256" ||
    view.id !== "direct-bounty-journal-safety-v1" ||
    view.model !== "formal/models/direct_bounty_journal.qnt" ||
    view.module !== "direct_bounty_journal" ||
    view.operator !== "SlopJournalSafetyView" ||
    !digest.test(view.sourceSha256) ||
    !digest.test(view.translatedSha256) ||
    JSON.stringify(view.fields) !== JSON.stringify(fields)
  )
    throw new Error("Unreviewed TLC safety-view definition");
  return manifest;
}

export function bindSafetyView(manifest, id, model, source) {
  const view = manifest.views.find((entry) => entry.id === id);
  if (!view || view.model !== model)
    throw new Error("Unknown TLC safety-view request");
  if (hash(source) !== view.sourceSha256)
    throw new Error(
      "TLC safety-view model changed; review its projection again",
    );
  if (/^\s*temporal\s+/mu.test(source))
    throw new Error("TLC safety view does not authorize temporal properties");
  return view;
}

export function applySafetyView(view, config) {
  if (
    config.moduleName !== view.module ||
    !config.hasInvariant ||
    config.hasTemporal ||
    !identifier.test(view.operator) ||
    view.operator !== "SlopJournalSafetyView" ||
    JSON.stringify(view.fields) !== JSON.stringify(fields)
  )
    throw new Error("TLC safety-view module or property differs");
  if (hash(config.tlaCode) !== view.translatedSha256)
    throw new Error("TLC safety-view generated TLA changed; review it again");
  const end = config.tlaCode.match(/^={4,}[ \t]*$/gmu);
  if (end?.length !== 1 || !config.tlaCode.endsWith(`${end[0]}\n`))
    throw new Error("TLC safety-view module terminator differs");
  const definition = `${view.operator} ==\n  <<${view.fields.map((field) => `s.${field}`).join(", ")}>>\n\n`;
  const tlaCode = `${config.tlaCode.slice(0, -end[0].length - 1)}${definition}${end[0]}\n`;
  return {
    ...config,
    tlaCode,
    slopSafetyView: view.operator,
    viewEvidence: {
      id: view.id,
      model: view.model,
      sourceSha256: view.sourceSha256,
      translatedSha256: view.translatedSha256,
      operator: view.operator,
      fields: view.fields,
      viewTlaSha256: hash(tlaCode),
    },
  };
}

// Retain the complete pinned official runner. Only its private config emitter
// gains the one validated VIEW line; Java flags/results/cleanup do not change.
export function patchTlcConfig(source, expectedSha256) {
  if (hash(source) !== expectedSha256)
    throw new Error("Pinned Quint TLC adapter changed");
  const original = "    return cfg;\n}\nfunction findApalacheJar(";
  if (source.split(original).length !== 2)
    throw new Error("Pinned Quint TLC config emitter differs");
  const replacement =
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Preserve the generated JavaScript placeholder as literal code.
    "    if (config.slopSafetyView) cfg += `VIEW ${config.slopSafetyView}\\n`;\n" +
    original;
  return source.replace(original, replacement);
}

export function loadSafetyViewTlc(adapterPath, manifest) {
  if (process.version !== "v24.15.0")
    throw new Error("TLC safety-view loader requires Node 24.15.0");
  const source = readFileSync(adapterPath, "utf8");
  const overlay = patchTlcConfig(source, manifest.quintAdapterSha256);
  const module = new Module(adapterPath);
  module.filename = adapterPath;
  module.paths = Module._nodeModulePaths(join(adapterPath, ".."));
  module._compile(overlay, adapterPath);
  if (typeof module.exports.verify !== "function")
    throw new Error("Pinned Quint TLC runner export differs");
  return {
    verify: module.exports.verify,
    adapterSha256: hash(source),
    overlaySha256: hash(overlay),
  };
}
