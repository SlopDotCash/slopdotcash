/** Pure canonical command and report validation; no filesystem or workflow IO. */
import { basename, isAbsolute, normalize } from "node:path";

const commonTools = [
  "scripts/check-formal.mjs",
  "scripts/formal-models.mjs",
  "scripts/formal-report.mjs",
  "scripts/run-e2e-phase.mjs",
  "bun.lock",
];
const verificationTools = [
  "scripts/quint-local-translator.mjs",
  "scripts/quint-tla-normalization.mjs",
  "scripts/quint-safety-view.mjs",
  "scripts/quint-verification-step.mjs",
  "formal/tlc.json",
  "formal/tlc-safety-views.json",
];

const verificationTimeouts = {
  // These source-bound finite graphs still had millions of queued states
  // after the ordinary three-minute budget. Retain the complete domains,
  // transitions and reviewed views; grant time to finish the same graph.
  "formal/models/api/api_owner_vault_lifecycle.qnt": 1_800_000,
  "formal/models/api/api_project_lookup_routes.qnt": 1_800_000,
  "formal/models/ui/ui_admin_mutation_identity.qnt": 1_800_000,
  "formal/models/ui/ui_email_actions.qnt": 600_000,
  "formal/models/ui/ui_email_preference_requests.qnt": 600_000,
  "formal/models/ui/ui_project_authority.qnt": 600_000,
  "formal/models/ui/ui_project_publication_lifetime.qnt": 1_800_000,
  // The unchanged quotient exhausted 600s with 542,301 states still queued.
  // Increase only its resource allowance; retain the complete safety graph.
  "formal/models/ui/ui_security_settings_lifetime.qnt": 1_200_000,
  "formal/models/ui/ui_vetting_reader.qnt": 600_000,
  // The unchanged value-cap graph still had work queued at 962,410 states
  // after 180s. Keep its full spend, failure and retry states.
  "formal/models/fees/fee_value_caps.qnt": 600_000,
  "formal/models/ui/ui_submitted_payment_recovery.qnt": 600_000,
  // This full-state UI graph exceeds the ordinary three-minute budget.
  // Keep its resource allowance explicit without reducing the model.
  "formal/models/ui/ui_bounty_payment_parent.qnt": 1_800_000,
  // The corrected archive timer graph completed in 34m48s: 3,929,088 distinct
  // states, zero queued and no temporal violation. Retain the full concrete
  // domains and temporal property; allow this unchanged graph one hour.
  "formal/models/ui/ui_cycle_archive.qnt": 3_600_000,
  // The unchanged payout-consent graph exceeded 180s while still exploring
  // roughly five million distinct states. Keep every concrete state and
  // transition; allow this model ten minutes to finish its finite graph.
  "formal/models/ui/ui_payout_consent_lifetime.qnt": 600_000,
  // The journal's unchanged finite domain exceeds the ordinary three-minute
  // budget. Keep a bounded, model-specific allowance for its reviewed view.
  "formal/models/payments/direct_bounty_journal.qnt": 1_800_000,
  // The qualified provider-wait quotient exceeded 180s with 1,471,827
  // distinct states and 446,535 queued. Keep its entire model and safety VIEW.
  "formal/models/ui/solana_wallet_provider.qnt": 600_000,
  // The equivalent configure-guard revision still had 143,371 states queued
  // after 600s. Preserve its complete model and reviewed safety VIEW.
  "formal/models/payments/solana_binding_api.qnt": 1_200_000,
};

export function formalToolPaths(verify) {
  return [...commonTools, ...(verify ? verificationTools : [])];
}

export function formalTimeoutMs(model, verify) {
  return verify ? (verificationTimeouts[model] ?? 180_000) : 90_000;
}

export function formalStageArguments(
  model,
  verify,
  finiteTransition,
  temporalProperties = [],
) {
  return verify
    ? [
        [
          "verify",
          model,
          "--backend=tlc",
          "--verbosity=3",
          "--tlc-config=formal/tlc.json",
          "--invariant=invariant",
          ...(finiteTransition ? [`--step=${finiteTransition.step}`] : []),
          ...(temporalProperties.length
            ? [`--temporal=${temporalProperties.join(",")}`]
            : []),
        ],
      ]
    : [
        ["typecheck", model],
        [
          "test",
          model,
          "--backend=typescript",
          "--seed=20261107",
          "--max-samples=100",
        ],
        [
          "run",
          model,
          "--backend=typescript",
          "--seed=20261107",
          "--max-samples=500",
          "--max-steps=60",
          "--invariant=invariant",
        ],
      ];
}

const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function same(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => same(value, right[index]))
    );
  if (!record(left) || !record(right)) return false;
  const keys = Object.keys(left).sort();
  return (
    same(keys, Object.keys(right).sort()) &&
    keys.every((key) => same(left[key], right[key]))
  );
}
function producerCommand(command, expectedArguments, verify) {
  if (
    !Array.isArray(command) ||
    command.some((part) => typeof part !== "string")
  )
    return false;
  const index = verify ? 3 : 0;
  const executable = command[index];
  const suffix = "/node_modules/.bin/quint";
  if (
    typeof executable !== "string" ||
    !isAbsolute(executable) ||
    normalize(executable) !== executable ||
    !executable.endsWith(suffix)
  )
    return false;
  const producerRoot = executable.slice(0, -suffix.length);
  if (
    verify &&
    (typeof command[0] !== "string" ||
      !isAbsolute(command[0]) ||
      basename(command[0]) !== "node" ||
      normalize(command[0]) !== command[0] ||
      command[1] !== "--import" ||
      command[2] !== `${producerRoot}/scripts/quint-local-translator.mjs`)
  )
    return false;
  return same(command.slice(index + 1), expectedArguments);
}

/** Return every failed contract instead of accepting absent fields as vacuous truth. */
export function formalReportProblems(report, expected) {
  const problems = [];
  if (!record(report)) return ["report is not an object"];
  if (report.schemaVersion !== 1) problems.push("unsupported report schema");
  if (report.canceled !== false || report.inputsUnchanged !== true)
    problems.push("canceled or unstable report");
  if (!same(report.toolHashes, expected.toolHashes))
    problems.push("tool keys or current digests differ");
  if (
    report.mode !==
      (expected.verify
        ? "exhaustive-finite-tlc"
        : "types-scenarios-seeded-simulation") ||
    report.translation !== (expected.verify ? "local-apalache-cli" : "not-used")
  )
    problems.push("wrong report mode or translation");
  if (report.quintVersion !== expected.quintVersion)
    problems.push("wrong Quint version");
  if (
    expected.verify
      ? typeof report.javaVersion !== "string" ||
        !/version "21[.]/u.test(report.javaVersion)
      : report.javaVersion !== null
  )
    problems.push("wrong Java metadata");
  if (
    !Array.isArray(report.results) ||
    report.results.length !== expected.commands.length
  )
    return [...problems, "missing, duplicate or extra stage results"];
  for (const [index, result] of report.results.entries()) {
    const label = `stage ${index + 1}`;
    if (!record(result)) {
      problems.push(`${label}: result is not an object`);
      continue;
    }
    if (typeof result.output !== "string")
      problems.push(`${label}: missing stage output`);
    if (
      result.passed !== true ||
      result.exitCode !== 0 ||
      result.error !== null
    )
      problems.push(`${label}: failed or incomplete result`);
    if (result.model !== expected.model || result.sha256 !== expected.sha256)
      problems.push(`${label}: wrong model or digest`);
    if (!same(result.sources, expected.sources))
      problems.push(`${label}: mapped-source keys or digests differ`);
    if (
      !producerCommand(
        result.command,
        expected.commands[index],
        expected.verify,
      )
    )
      problems.push(
        `${label}: wrong producer command, seed, bound or property`,
      );
    if (
      result.timeoutMs !== expected.timeoutMs ||
      !Number.isSafeInteger(result.durationMs) ||
      result.durationMs < 0
    )
      problems.push(`${label}: wrong resource allowance or duration`);
    if (!same(result.finiteTransition, expected.finiteTransition))
      problems.push(`${label}: wrong finite transition`);
    const view = expected.safetyView;
    if (result.requestedSafetyView !== (view?.id ?? null))
      problems.push(`${label}: wrong requested safety view`);
    if (!view) {
      if (result.safetyView !== null)
        problems.push(`${label}: unexpected safety view`);
    } else {
      const applied = result.safetyView;
      if (
        !record(applied) ||
        !same(
          Object.fromEntries(
            Object.keys(view).map((key) => [key, applied?.[key]]),
          ),
          view,
        ) ||
        !/^[0-9a-f]{64}$/u.test(applied.overlaySha256 ?? "") ||
        Object.keys(applied).sort().join(",") !==
          [...Object.keys(view), "overlaySha256"].sort().join(",")
      )
        problems.push(`${label}: wrong applied safety view`);
    }
  }
  return problems;
}
