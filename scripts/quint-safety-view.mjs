/** Exact-source safety views; full models and normal scenarios stay unchanged. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { join } from "node:path";

const hash = (text) => createHash("sha256").update(text).digest("hex");
const identifier = /^[A-Za-z][A-Za-z0-9_]*$/u;
const digest = /^[0-9a-f]{64}$/u;
const hashMode = "entry-hash-zero-or-positive";
const memoryCandidateMode = "erase-unused-memory-candidate";
const fields = [
  {
    name: "store",
    expression:
      "[n \\in DOMAIN s.store |-> [s.store[n] EXCEPT !.hash = IF s.store[n].hash = 0 THEN 0 ELSE 1]]",
  },
  {
    name: "memory",
    expression:
      "[q \\in DOMAIN s.memory |-> [n \\in DOMAIN s.memory[q] |-> [s.memory[q][n] EXCEPT !.hash = IF s.memory[q][n].hash = 0 THEN 0 ELSE 1, !.candidate = 0]]]",
  },
  { name: "held", expression: "s.held" },
  { name: "used", expression: "s.used" },
  { name: "mounted", expression: "s.mounted" },
];
const clauses = [
  {
    name: "ownership",
    expression: "((s.wrote /\\ s.expected > 0) => s.observed = s.expected)",
  },
  {
    name: "frame",
    expression:
      "(s.touched > 0 => (\\A n \\in {1, 2} \\ {s.touched}: s.store[n] = s.before[n]))",
  },
];
// These are four individually reviewed projections, not a manifest-selected
// expression engine. Unknown models, fields, clauses or modes fail closed.
const definitions = [
  {
    id: "direct-bounty-journal-safety-v4",
    model: "formal/models/payments/direct_bounty_journal.qnt",
    module: "direct_bounty_journal",
    operator: "SlopJournalSafetyViewV4",
    hashMode,
    memoryCandidateMode,
    fields,
    clauses,
  },
  {
    id: "owner-vault-terminal-safety-v3",
    model: "formal/models/api/api_owner_vault_lifecycle.qnt",
    module: "api_owner_vault_lifecycle",
    operator: "SlopOwnerVaultTerminalViewV3",
    hashMode: "terminal-invariant-observations",
    memoryCandidateMode: "erase-terminal-payload-and-unused-operation-inputs",
    fields: [
      {
        name: "state",
        expression:
          '[s EXCEPT !.requests = [i \\in DOMAIN s.requests |-> IF s.requests[i].phase \\in {"response", "done"} THEN <<s.requests[i].phase, s.requests[i].committed, s.requests[i].purpose, (s.requests[i].status > 0 => s.requests[i].noStore), (s.requests[i].result = "existing" => (s.requests[i].captured.exists /\\ s.requests[i].captured.family = s.requests[i].family /\\ ~s.requests[i].chainCalled /\\ s.requests[i].committed = 0 /\\ s.requests[i].responseRevision = s.requests[i].current)), (s.requests[i].result = "registered" => (s.requests[i].committed > 0 /\\ s.requests[i].responseRevision = s.requests[i].committed)), (s.requests[i].result = "pending" => s.requests[i].committed = 0), (s.requests[i].result = "funds" => (s.requests[i].mode = "get" /\\ s.requests[i].purpose = 2))>> ELSE [s.requests[i] EXCEPT !.expected = IF s.requests[i].mode = "get" THEN 1 ELSE s.requests[i].expected, !.transaction = IF s.requests[i].mode \\in {"get", "review"} THEN 1 ELSE s.requests[i].transaction, !.family = IF s.requests[i].mode \\in {"get", "review"} THEN "evm" ELSE s.requests[i].family]]]',
      },
    ],
    clauses: [],
  },
  {
    id: "project-lookup-cache-observation-safety-v3",
    model: "formal/models/api/api_project_lookup_routes.qnt",
    module: "api_project_lookup_routes",
    operator: "SlopProjectLookupCacheViewV3",
    hashMode: "data-cache-payload-zero-or-positive",
    memoryCandidateMode:
      "erase-unused-login-legacy-terminal-and-refusal-inputs",
    fields: [
      {
        name: "state",
        expression:
          '[s EXCEPT !.legacyCache = [k \\in DOMAIN s.legacyCache |-> [version |-> 0, subject |-> 0]], !.loginVersion = [a \\in DOMAIN s.loginVersion |-> 0], !.dataVersion = IF s.dataVersion > 0 THEN 1 ELSE 0, !.cache = [k \\in DOMAIN s.cache |-> [s.cache[k] EXCEPT !.version = IF s.cache[k].version > 0 THEN 1 ELSE 0]], !.requests = [id \\in DOMAIN s.requests |-> LET r == s.requests[id] IN IF r.phase \\in {"response", "done"} THEN [r EXCEPT !.method = "GET", !.transport = TRUE, !.expected = 0, !.loginValid = TRUE, !.repository = 1, !.cacheEnabled = TRUE, !.login = 0, !.selectedExpected = 0, !.delivered = FALSE, !.key = IF r.putPending THEN r.key ELSE 0, !.payload = IF r.putPending THEN (IF r.payload > 0 THEN 1 ELSE 0) ELSE 0, !.waitUntil = IF r.putPending THEN r.waitUntil ELSE FALSE] ELSE IF r.phase = "dispatch" /\\ ~r.putPending /\\ ((r.method # "GET" /\\ ~r.transport) \\/ ~(IF r.route = "actor-selection" THEN r.method = "POST" ELSE r.method = "GET" /\\ r.route # "unknown")) THEN [r EXCEPT !.expected = 0, !.repository = 1, !.cacheEnabled = TRUE, !.waitUntil = FALSE, !.loginValid = TRUE, !.login = 0, !.payload = IF r.payload > 0 THEN 1 ELSE 0] ELSE [r EXCEPT !.login = 0, !.payload = IF r.payload > 0 THEN 1 ELSE 0]]]',
      },
    ],
    clauses: [],
  },
  {
    id: "ui-admin-mutation-continuation-safety-v2",
    model: "formal/models/ui/ui_admin_mutation_identity.qnt",
    module: "ui_admin_mutation_identity",
    operator: "SlopAdminMutationContinuationViewV2",
    hashMode: "admin-continuation-and-terminal-admission-observations",
    memoryCandidateMode: "erase-phase-dead-and-terminal-invariant-only",
    fields: [
      {
        name: "state",
        expression:
          '[s EXCEPT !.error = IF s.error = "request" THEN "request" ELSE "none", !.didClear = FALSE, !.clearExpected = 0, !.clearObserved = 0, !.requests = [id \\in DOMAIN s.requests |-> LET r == s.requests[id] IN IF r.phase = "done" THEN <<r.phase, (r.admitted => r.cookie = r.actor)>> ELSE [r EXCEPT !.kind = IF r.phase = "done" THEN "save" ELSE r.kind, !.draft = IF r.phase = "done" \\/ r.kind = "action" THEN 0 ELSE r.draft, !.accepted = IF r.phase \\in {"recheck", "recheck-observed", "recheck-returned", "done"} THEN FALSE ELSE r.accepted, !.observedActor = IF r.phase \\in {"preflight-observed", "preflight-returned", "recheck-observed", "recheck-returned"} THEN r.observedActor ELSE 0, !.observedAdmin = IF r.phase \\in {"preflight-observed", "preflight-returned", "recheck-observed", "recheck-returned"} THEN r.observedAdmin ELSE FALSE]]]',
      },
    ],
    clauses: [
      {
        name: "clear",
        expression: "(s.didClear => s.clearExpected = s.clearObserved)",
      },
    ],
  },
];

function reviewedDefinition(view) {
  const definition = definitions.find((entry) => entry.id === view.id);
  return (
    definition !== undefined &&
    Object.entries(definition).every(
      ([name, value]) => JSON.stringify(view[name]) === JSON.stringify(value),
    )
  );
}

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
    manifest.views.length !== definitions.length
  )
    throw new Error("Unreviewed TLC safety-view manifest");
  for (const [index, view] of manifest.views.entries())
    if (
      Object.keys(view).sort().join(",") !==
        "clauses,fields,hashMode,id,memoryCandidateMode,model,module,operator,sourceSha256,translatedSha256,viewTlaSha256" ||
      view.id !== definitions[index].id ||
      !reviewedDefinition(view) ||
      !digest.test(view.sourceSha256) ||
      !digest.test(view.translatedSha256) ||
      !digest.test(view.viewTlaSha256)
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
    !reviewedDefinition(view)
  )
    throw new Error("TLC safety-view module or property differs");
  if (hash(config.tlaCode) !== view.translatedSha256)
    throw new Error("TLC safety-view generated TLA changed; review it again");
  const end = config.tlaCode.match(/^={4,}[ \t]*$/gmu);
  if (end?.length !== 1 || !config.tlaCode.endsWith(`${end[0]}\n`))
    throw new Error("TLC safety-view module terminator differs");
  const expressions = [
    ...view.fields.map((field) => field.expression),
    ...view.clauses.map((clause) => clause.expression),
  ];
  const definition = `${view.operator} ==\n  <<${expressions.join(", ")}>>\n\n`;
  const tlaCode = `${config.tlaCode.slice(0, -end[0].length - 1)}${definition}${end[0]}\n`;
  if (hash(tlaCode) !== view.viewTlaSha256)
    throw new Error("TLC safety-view projection changed; review it again");
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
      hashMode: view.hashMode,
      memoryCandidateMode: view.memoryCandidateMode,
      fields: view.fields,
      clauses: view.clauses,
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
