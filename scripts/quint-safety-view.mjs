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
// These are individually reviewed projections, not a manifest-selected
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
    id: "owner-vault-cap-cone-safety-v8",
    model: "formal/models/api/api_owner_vault_lifecycle.qnt",
    module: "api_owner_vault_lifecycle",
    operator: "SlopOwnerVaultCapConeViewV8",
    hashMode: "terminal-stutter-and-closed-cap-copy-cone",
    memoryCandidateMode:
      "erase-policy-request-and-creation-cap-carriers-preserving-v7-rest",
    fields: [
      {
        name: "state",
        expression:
          '[s EXCEPT !.history = [rev \\in DOMAIN s.history |-> [s.history[rev] EXCEPT !.cap = 0]], !.requests = [i \\in DOMAIN s.requests |-> LET r == s.requests[i] IN IF r.phase \\in {"response", "done"} THEN LET obligation == (r.committed > 0 => (policyAt(r.committed).exists /\\ deploymentAt(r.purpose).exists)) IN <<"terminal", obligation, IF obligation THEN <<0, 0>> ELSE <<r.committed, r.purpose>>, (r.status > 0 => r.noStore), (r.result = "existing" => (r.captured.exists /\\ r.captured.family = r.family /\\ ~r.chainCalled /\\ r.committed = 0 /\\ r.responseRevision = r.current)), (r.result = "registered" => (r.committed > 0 /\\ r.responseRevision = r.committed)), (r.result = "pending" => r.committed = 0), (r.result = "funds" => (r.mode = "get" /\\ r.purpose = 2))>> ELSE [r EXCEPT !.creationRevision = 0, !.creationCap = 0, !.canSetup = FALSE, !.received = FALSE, !.expected = IF r.mode = "get" \\/ r.phase \\in {"chain", "append-generation", "append-validation", "commit", "postcommit"} THEN 1 ELSE r.expected, !.transaction = IF r.mode \\in {"get", "review"} \\/ r.phase = "postcommit" THEN 1 ELSE r.transaction, !.family = IF r.mode \\in {"get", "review"} \\/ r.phase = "postcommit" THEN "evm" ELSE r.family, !.current = IF r.mode = "get" \\/ (r.mode = "review" /\\ r.phase \\in {"chain", "append-generation", "append-validation", "commit", "postcommit"}) THEN 0 ELSE r.current, !.policy = IF r.mode \\in {"get", "review"} \\/ r.phase = "postcommit" THEN 0 ELSE r.policy, !.cap = 0, !.captured = IF r.mode = "get" \\/ (r.mode = "review" /\\ r.phase \\in {"chain", "append-generation", "append-validation", "commit", "postcommit"}) THEN [exists |-> FALSE, transaction |-> 0, family |-> "evm"] ELSE IF r.mode = "review" THEN [r.captured EXCEPT !.transaction = 0, !.family = "evm"] ELSE r.captured, !.appendGeneration = IF r.mode \\in {"get", "review"} \\/ r.phase = "postcommit" THEN -1 ELSE r.appendGeneration, !.restricted = IF r.phase \\in {"funds", "service", "body", "expected", "history", "chain", "append-generation", "append-validation", "commit", "postcommit"} THEN FALSE ELSE r.restricted, !.banned = IF r.phase \\in {"funds", "service", "body", "expected", "history", "chain", "append-generation", "append-validation", "commit", "postcommit"} THEN FALSE ELSE r.banned]]]',
      },
    ],
    clauses: [],
  },
  {
    id: "project-lookup-phase-liveness-safety-v6",
    model: "formal/models/api/api_project_lookup_routes.qnt",
    module: "api_project_lookup_routes",
    operator: "SlopProjectLookupPhaseViewV6",
    hashMode:
      "data-cache-payload-positivity-and-terminal-invariant-observations",
    memoryCandidateMode:
      "erase-unused-login-legacy-terminal-handoff-refusal-and-phase-dead-inputs",
    fields: [
      {
        name: "state",
        expression:
          '[s EXCEPT !.legacyCache = [k \\in DOMAIN s.legacyCache |-> [version |-> 0, subject |-> 0]], !.loginVersion = [a \\in DOMAIN s.loginVersion |-> 0], !.dataVersion = IF s.dataVersion > 0 THEN 1 ELSE 0, !.cache = [k \\in DOMAIN s.cache |-> [s.cache[k] EXCEPT !.version = IF s.cache[k].version > 0 THEN 1 ELSE 0]], !.requests = [id \\in DOMAIN s.requests |-> LET r == s.requests[id] IN IF r.phase \\in {"response", "done", "enforcement-handoff"} THEN <<r.phase, r.attempt, r.putPending, IF r.putPending THEN <<r.key, r.subject, IF r.payload > 0 THEN 1 ELSE 0, r.waitUntil>> ELSE <<0, 0, 0, FALSE>>, <<r.attempt <= 2, (r.hit => (r.actor # 0 /\\ r.providerReads = 0 /\\ r.status = 200)), (r.route = "owned" /\\ r.status = 200 => (r.subject = r.actor /\\ r.actor # 0)), (r.putPending => (r.status = 200 /\\ r.payload > 0)), (r.status = 200 /\\ r.route \\in {"owned", "repository"} => r.policy = "private-300"), (r.phase = "enforcement-handoff" => (r.selected # 0 /\\ r.providerReads = 1)), (r.status \\in {400, 401, 403, 404, 422, 500, 502, 503} => ~r.putPending)>>>> ELSE IF r.phase = "dispatch" /\\ ~r.putPending /\\ ((r.method # "GET" /\\ ~r.transport) \\/ ~(IF r.route = "actor-selection" THEN r.method = "POST" ELSE r.method = "GET" /\\ r.route # "unknown")) THEN [r EXCEPT !.expected = 0, !.repository = 1, !.cacheEnabled = TRUE, !.waitUntil = FALSE, !.loginValid = TRUE, !.login = 0, !.payload = IF r.payload > 0 THEN 1 ELSE 0] ELSE [r EXCEPT !.method = IF r.phase \\in {"session", "cache", "validate", "actor", "owned-list", "repository", "buffer", "selection-input", "selection-actor"} THEN "GET" ELSE r.method, !.transport = IF r.phase \\in {"session", "cache", "validate", "actor", "owned-list", "repository", "buffer", "selection-input", "selection-actor"} THEN TRUE ELSE r.transport, !.expected = IF r.phase \\in {"cache", "validate", "actor", "owned-list", "repository", "buffer", "selection-input", "selection-actor"} THEN 0 ELSE r.expected, !.repository = IF r.phase \\in {"actor", "owned-list", "repository", "buffer"} THEN 1 ELSE r.repository, !.loginValid = IF r.phase \\in {"actor", "owned-list", "repository", "buffer"} THEN TRUE ELSE r.loginValid, !.login = 0, !.payload = IF r.payload > 0 THEN 1 ELSE 0]]]',
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
  {
    id: "email-preference-request-observation-safety-v1",
    model: "formal/models/ui/ui_email_preference_requests.qnt",
    module: "ui_email_preference_requests",
    operator: "SlopEmailPreferenceRequestViewV1",
    hashMode: "request-auth-and-indexed-publication-observations",
    memoryCandidateMode: "erase-output-closure-and-phase-dead-request-data",
    fields: [
      {
        name: "state",
        expression:
          '[s EXCEPT !.draft = 0, !.key = FALSE, !.enabled = FALSE, !.verificationPending = FALSE, !.error = "none", !.view = IF s.view = "ready" THEN "ready" ELSE "loading", !.publicationGeneration = IF s.publication = 0 THEN 0 ELSE s.publicationGeneration, !.requests = [id \\in DOMAIN s.requests |-> LET r == s.requests[id] IN <<r.phase, (r.accepted => r.cookie = r.actor), IF s.publication = id THEN <<r.generation, r.observedActor = r.actor, (r.kind = "read" \\/ r.accepted)>> ELSE <<0, TRUE, TRUE>>, IF r.phase \\in {"unused", "done"} THEN 0 ELSE [r EXCEPT !.target = FALSE, !.cookie = IF r.phase \\in {"pre", "pre-wait", "pre-observed", "pre-returned", "http"} THEN r.cookie ELSE 0, !.observedActor = IF r.phase \\in {"pre-observed", "pre-returned", "post-observed", "post-returned", "failure-observed", "failure-returned"} THEN r.observedActor ELSE 0, !.status = IF r.phase \\in {"body", "post", "post-wait", "post-observed", "post-returned"} THEN (IF r.kind = "save" /\\ r.status = 200 THEN 200 ELSE IF r.kind = "verify" /\\ r.status = 202 THEN 202 ELSE 0) ELSE 0]>>]]',
      },
    ],
    clauses: [],
  },
  {
    id: "ui-project-publication-continuation-safety-v2",
    model: "formal/models/ui/ui_project_publication_lifetime.qnt",
    module: "ui_project_publication_lifetime",
    operator: "SlopPublicationContinuationViewV2",
    hashMode:
      "publication-phase-continuation-and-terminal-invariant-observations",
    memoryCandidateMode:
      "erase-write-only-referrer-and-phase-dead-request-payloads",
    fields: [
      {
        name: "state",
        expression:
          '[s EXCEPT !.serverDraft = 0, !.storageError = FALSE, !.error = "none", !.referrer = FALSE, !.storedReferrer = FALSE, !.requests = [id \\in DOMAIN s.requests |-> LET r == s.requests[id] IN IF r.phase \\in {"unused", "done"} THEN <<r.phase, r.accepted, (r.admitted => r.cookie = r.actor)>> ELSE [r EXCEPT !.referrer = FALSE, !.outcome = "none", !.observedActor = IF r.phase \\in {"preflight-observed", "preflight-returned", "success-observed", "success-returned", "failure-observed", "failure-returned"} THEN r.observedActor ELSE -1, !.expected = IF r.phase \\in {"http", "success-check", "success-observed", "success-returned", "failure-check", "failure-observed", "failure-returned"} THEN 0 ELSE r.expected, !.draft = IF s.mode = "create" \\/ r.phase \\in {"failure-check", "failure-observed", "failure-returned"} THEN 0 ELSE r.draft, !.draftEpoch = IF s.mode = "create" \\/ r.phase \\in {"failure-check", "failure-observed", "failure-returned"} THEN 0 ELSE r.draftEpoch, !.resultRevision = IF s.mode = "create" \\/ r.phase \\in {"failure-check", "failure-observed", "failure-returned"} THEN 0 ELSE r.resultRevision]]]',
      },
    ],
    clauses: [],
  },
  {
    id: "ui-security-settings-lifetime-safety-v2",
    model: "formal/models/ui/ui_security_settings_lifetime.qnt",
    module: "ui_security_settings_lifetime",
    operator: "SlopSecuritySettingsLifetimeViewV2",
    hashMode: "exact-publication-identity-and-stale-read-admission",
    memoryCandidateMode:
      "erase-write-only-reset-absorbing-and-stale-read-payloads",
    fields: [
      {
        name: "state",
        expression:
          '[s EXCEPT !.error = "none", !.success = 0, !.serverBody = 0, !.reads = [i \\in DOMAIN s.reads |-> LET r == s.reads[i] IN IF r.phase \\in {"unused", "done"} THEN [phase |-> r.phase] ELSE IF s.read # i THEN IF r.phase = "http" THEN [phase |-> r.phase, admitted |-> (r.kind = "revision" \\/ r.cookie = r.actor)] ELSE [phase |-> r.phase] ELSE IF r.phase \\in {"pre", "dispatch"} THEN [phase |-> r.phase, kind |-> r.kind, actor |-> r.actor, life |-> r.life] ELSE IF r.phase = "http" THEN [phase |-> r.phase, kind |-> r.kind, actor |-> r.actor, life |-> r.life, cookie |-> r.cookie] ELSE IF r.phase = "post" THEN [phase |-> r.phase, kind |-> r.kind, actor |-> r.actor, life |-> r.life, ok |-> r.ok, revision |-> r.revision] ELSE r], !.publications = [i \\in DOMAIN s.publications |-> LET p == s.publications[i] IN IF p.phase \\in {"unused", "done"} THEN [phase |-> p.phase] ELSE [p EXCEPT !.body = 0]]]',
      },
    ],
    clauses: [
      {
        name: "publicationIdentity",
        expression:
          "[i \\in DOMAIN s.publications |-> (s.publications[i].accepted => s.publications[i].cookie = s.publications[i].actor)]",
      },
    ],
  },
  {
    id: "solana-binding-api-observation-safety-v1",
    model: "formal/models/payments/solana_binding_api.qnt",
    module: "solana_binding_api",
    operator: "SlopSolanaBindingApiViewV1",
    hashMode: "terminal-audit-dispatch-and-reply-invariant-observations",
    memoryCandidateMode: "erase-unobserved-ledger-status-and-response-payload",
    fields: [
      {
        name: "state",
        expression:
          '[s EXCEPT !.ledger = [scope \\in DOMAIN s.ledger |-> IF s.ledger[scope] = "unavailable" THEN "unavailable" ELSE "prepared"], !.requests = [id \\in DOMAIN s.requests |-> LET r == s.requests[id] IN IF r.phase \\in {"unused", "response", "done"} THEN <<r.phase, r.dispatched, <<r.audited = (id \\in s.audits), (r.audited => (r.owner /\\ s.auditStamps[id] = r.stamp)), (r.scope = 2 => (r.owner /\\ r.audited)), (r.dispatched => (r.admitted /\\ r.scope \\in {1, 2} /\\ r.dispatchScope = r.scope /\\ r.dispatchClaim = r.claim /\\ r.dispatchAttempt = r.attempt /\\ r.requestTransaction = (r.mode = "complete"))), ((id \\in s.effects) => r.dispatched), (r.context => (r.mode = "prepare" /\\ r.contextClaim = r.claim)), (r.replyTransaction => (r.mode = "prepare" /\\ r.desired = "200")), (r.replyContext => (r.context /\\ r.desired = "200")), (r.desired = "200" => r.dispatched)>>>> ELSE [r EXCEPT !.response = "none", !.emptyId = FALSE, !.desired = IF r.desired = "200" THEN "200" ELSE "none"]]]',
      },
    ],
    clauses: [],
  },
  {
    id: "solana-wallet-provider-observation-safety-v3",
    model: "formal/models/ui/solana_wallet_provider.qnt",
    module: "solana_wallet_provider",
    operator: "SlopSolanaWalletProviderViewV3",
    hashMode: "operation-phase-truth-and-closed-capability-cone",
    memoryCandidateMode:
      "erase-consumed-provider-wait-data-and-drained-capabilities",
    fields: [
      {
        name: "state",
        expression:
          'LET drained == (s.phase = "connected" /\\ (\\A id \\in DOMAIN s.operations: s.operations[id].phase \\in {"provider-wait", "done"})) IN [s EXCEPT !.exposedTransaction = IF drained THEN FALSE ELSE s.exposedTransaction, !.exposedSend = IF drained THEN FALSE ELSE s.exposedSend, !.messageFeature = IF drained THEN FALSE ELSE s.messageFeature, !.transactionFeature = IF drained THEN FALSE ELSE s.transactionFeature, !.sendFeature = IF drained THEN FALSE ELSE s.sendFeature, !.transactionLegacy = IF drained THEN FALSE ELSE s.transactionLegacy, !.sendLegacy = IF drained THEN FALSE ELSE s.sendLegacy, !.operations = [id \\in DOMAIN s.operations |-> LET op == s.operations[id] IN IF op.phase \\in {"unused", "done"} THEN <<op.phase, op.invoked, op.method = "send", (op.invoked => (op.checked /\\ op.matched /\\ op.feature /\\ op.chainMatch /\\ op.legacyFormat)), (op.invoked => op.registered), (op.invoked => op.reconnected), ((op.invoked /\\ op.method = "send") => op.callback), (op.encoded => (op.method = "text" /\\ op.result = "ok")), ((id \\in s.effects) => (op.invoked /\\ op.method = "send"))>> ELSE IF op.phase = "provider-wait" THEN <<op.phase, op.method, op.invoked, (op.invoked => (op.checked /\\ op.matched /\\ op.feature /\\ op.chainMatch /\\ op.legacyFormat)), (op.invoked => op.registered), (op.invoked => op.reconnected), ((op.invoked /\\ op.method = "send") => op.callback), (op.encoded => (op.method = "text" /\\ op.result = "ok")), ((id \\in s.effects) => (op.invoked /\\ op.method = "send"))>> ELSE [op EXCEPT !.usedObject = 0, !.result = IF op.result = "ok" THEN "ok" ELSE "none"]]]',
      },
    ],
    clauses: [],
  },
  {
    id: "ui-contributor-allocation-safety-v2",
    model: "formal/models/ui/ui_contributor_allocation.qnt",
    module: "ui_contributor_allocation",
    operator: "SlopContributorAllocationViewV2",
    hashMode: "exact-per-account-on-time-wallet-membership",
    memoryCandidateMode: "erase-permanently-stale-and-unconsumed-payloads",
    fields: [
      {
        name: "state",
        expression:
          '[s EXCEPT !.wallets = [i \\in DOMAIN s.wallets |-> IF "on-time" \\in s.wallets[i] THEN {"on-time"} ELSE {"none"}], !.requests = [i \\in DOMAIN s.requests |-> LET r == s.requests[i] IN IF r.phase \\in {"unused", "done"} \\/ s.active # i THEN [phase |-> r.phase] ELSE IF r.phase \\in {"http", "body"} THEN [phase |-> r.phase, life |-> r.life] ELSE IF r.phase = "decoded" THEN [phase |-> r.phase, life |-> r.life, outcome |-> IF r.outcome \\in {"valid", "absent"} THEN r.outcome ELSE "invalid", recipients |-> IF r.outcome = "valid" THEN r.recipients ELSE 0, transfers |-> IF r.outcome = "valid" THEN r.transfers ELSE 0, closed |-> IF r.outcome \\in {"valid", "absent"} THEN r.closed ELSE FALSE] ELSE r]]',
      },
    ],
    clauses: [],
  },
  {
    id: "bot-inference-attempt-id-symmetry-v1",
    model: "formal/models/slopbot/bot_inference_retention.qnt",
    module: "bot_inference_retention",
    operator: "SlopBotInferenceAttemptIdViewV1",
    hashMode: "attempt-id-permutation-orbit",
    memoryCandidateMode:
      "retain-all-row-bits-current-retained-roles-and-multiplicity",
    fields: [
      {
        name: "state",
        expression:
          'LET rowIds == DOMAIN s.rows observation(id) == <<s.rows[id], id = s.current, id = s.retained>> classes == {observation(id) : id \\in rowIds} IN <<rowIds, {<<item, Cardinality({id \\in rowIds : observation(id) = item})>> : item \\in classes}, IF s.current \\in rowIds THEN "active" ELSE s.current, IF s.retained \\in rowIds THEN "retained" ELSE s.retained, s.published>>',
      },
    ],
    clauses: [],
  },
  {
    id: "operator-keeper-continuation-safety-v1",
    model: "formal/models/payments/operator_keeper_lifecycle.qnt",
    module: "operator_keeper_lifecycle",
    operator: "SlopOperatorKeeperContinuationViewV1",
    hashMode: "keeper-exact-signing-journal-and-http-run-observations",
    memoryCandidateMode:
      "erase-write-only-and-phase-dead-terminal-run-payloads",
    fields: [
      {
        name: "state",
        expression:
          '[s EXCEPT !.indexed = FALSE, !.projects = 0, !.requests = [i \\in DOMAIN s.requests |-> LET r == s.requests[i] IN [r EXCEPT !.instance = 0, !.result = "none", !.caller = IF r.caller = "cron" THEN "cron" ELSE "direct", !.http = IF r.http = 200 THEN 200 ELSE 0]], !.runs = [i \\in DOMAIN s.runs |-> LET r == s.runs[i] IN IF r.phase \\in {"unused", "lost"} THEN <<r.phase>> ELSE IF r.phase = "settled" THEN <<r.phase, IF r.outcome = "throw" THEN "throw" ELSE IF r.outcome = "partial" THEN "partial" ELSE "other">> ELSE [r EXCEPT !.projects = 0]]]',
      },
    ],
    clauses: [],
  },
  {
    id: "vetting-backup-chain-capped-carrier-safety-v2",
    model: "formal/models/vetting/vetting_backup_chain.qnt",
    module: "vetting_backup_chain",
    operator: "SlopVettingBackupChainViewV2",
    hashMode: "exact-backup-invariants-and-live-observations",
    memoryCandidateMode:
      "erase-dead-observations-and-permanently-capped-carriers",
    fields: [
      {
        name: "state",
        expression:
          '[s EXCEPT !.outcome = "none", !.restoreOutcome = "none", !.completionObserved = IF s.stage = "phase-update" THEN s.completionObserved ELSE FALSE, !.selected = IF s.restoreStage \\in {"none", "done"} THEN 0 ELSE s.selected, !.seen = IF s.replays >= 2 THEN {} ELSE s.seen, !.pending = IF s.deliveries >= 6 THEN {} ELSE s.pending]',
      },
    ],
    clauses: [],
  },
  {
    id: "email-actions-phase-carrier-safety-v1",
    model: "formal/models/ui/ui_email_actions.qnt",
    module: "ui_email_actions",
    operator: "SlopEmailActionsViewV1",
    hashMode: "separate-raw-invariants-and-live-email-captures",
    memoryCandidateMode:
      "phase-dead-inputs-storage-bounds-and-explicit-closed-carriers",
    fields: [
      {
        name: "state",
        expression:
          'IF (s.loaded /\\ s.generation >= 4 /\\ s.request.attempt >= 2 /\\ s.request.phase \\in {"idle", "done"} /\\ (\\A id \\in {1, 2}: s.checks[id].phase = "done")) THEN <<"closed", s.present, s.request.phase, (s.generation >= 1), (s.generation <= 4), (s.captures <= 2), (s.request.attempt <= 2), (s.stored >= 0), (s.stored <= 2), (s.storedActor >= 0), (s.storedActor <= 2), (s.effects \\subseteq {1, 2}), (((s.done /\\ s.link > 0) => s.doneLink = s.link)), (((s.done /\\ s.link > 0) => s.doneLink \\in s.effects)), (((s.present /\\ s.link > 0 /\\ s.error # "none") => s.errorGeneration = s.generation)), ((s.request.phase = "done" => ~s.busy)), (((s.request.accepted /\\ s.request.kind = "verify") => s.request.cookie = s.request.actor)), (((s.request.accepted /\\ s.request.kind = "verify") => s.request.actor > 0))>> ELSE <<"open", [s EXCEPT !.scrubbed = FALSE, !.error = IF s.error = "none" THEN "none" ELSE "error", !.errorGeneration = IF s.error = "none" THEN 0 ELSE s.errorGeneration, !.stored = <<s.stored >= 0, s.stored <= 2>>, !.storedActor = <<s.storedActor >= 0, s.storedActor <= 2>>, !.checks = [id \\in DOMAIN s.checks |-> LET c == s.checks[id] IN IF c.phase = "unused" THEN <<c.phase>> ELSE IF c.phase = "done" THEN <<c.phase, c.generation>> ELSE IF c.phase = "waiting" THEN [c EXCEPT !.observed = 0, !.available = FALSE] ELSE c], !.request = LET r == s.request IN IF r.phase \\in {"idle", "done", "finally"} THEN <<r.phase, r.attempt>> ELSE IF r.phase = "catch" THEN <<r.phase, r.attempt, r.generation, IF r.cause = "none" THEN "none" ELSE "error">> ELSE IF r.phase \\in {"preflight", "preflight-observed", "http", "http-reply", "body", "postflight", "postflight-observed"} THEN [r EXCEPT !.cause = "none", !.observed = IF r.phase \\in {"preflight-observed", "postflight-observed"} THEN r.observed ELSE 0, !.available = IF r.phase \\in {"preflight-observed", "postflight-observed"} THEN r.available ELSE FALSE, !.cookie = IF r.phase = "http" THEN r.cookie ELSE 0] ELSE r], (((s.request.accepted /\\ s.request.kind = "verify") => s.request.cookie = s.request.actor)), (((s.request.accepted /\\ s.request.kind = "verify") => s.request.actor > 0))>>',
      },
    ],
    clauses: [],
  },
  {
    id: "api-submission-recovery-terminal-safety-v1",
    model: "formal/models/api/api_submission_recovery.qnt",
    module: "api_submission_recovery",
    operator: "SlopSubmissionRecoveryTerminalViewV1",
    hashMode: "terminal-own-claim-and-late-land-invariant-observations",
    memoryCandidateMode:
      "erase-write-only-output-and-done-payload-after-final-read",
    fields: [
      {
        name: "state",
        expression:
          '[s EXCEPT !.absenceObserved = FALSE, !.receiptReplyLost = FALSE, !.senders = [id \\in DOMAIN s.senders |-> LET r == s.senders[id] IN IF r.phase = "done" THEN <<r.phase, r.attempt, r.posted, ~(r.outcome \\in {"terminal", "retryable", "throttled"}), (r.posted => (r.matched /\\ r.usableRevision = r.claimRevision /\\ r.usableState = "submitting"))>> ELSE [r EXCEPT !.response = "none"]]]',
      },
    ],
    clauses: [],
  },
  {
    id: "wallet-possession-continuation-safety-v1",
    model: "formal/models/api/wallet_possession_completion.qnt",
    module: "wallet_possession_completion",
    operator: "SlopWalletPossessionContinuationViewV1",
    hashMode: "exact-witness-booleans-claim-indices-and-signature-conjunction",
    memoryCandidateMode: "erase-consumed-proof-and-issue-payloads",
    fields: [
      {
        name: "state",
        expression:
          '[s EXCEPT !.issues = [i \\in DOMAIN s.issues |-> LET r == s.issues[i] IN [r EXCEPT !.claim = IF r.phase \\in {"owner", "existing", "prepare", "write"} THEN r.claim ELSE 1, !.actor = IF r.phase = "owner" THEN r.actor ELSE 1, !.stamp = IF r.phase = "write" THEN r.stamp ELSE -1, !.desired = "none", !.response = "none"]], !.requests = [i \\in DOMAIN s.requests |-> LET r == s.requests[i] IN [r EXCEPT !.actor = IF r.phase = "owner" THEN r.actor ELSE 1, !.challenge = IF r.phase \\in {"owner", "existing", "body", "consume", "consume-reply", "verify", "hash", "prewrite", "batch"} THEN r.challenge ELSE 0, !.bodyValid = IF r.phase \\in {"owner", "existing", "body"} THEN r.bodyValid ELSE FALSE, !.fieldsMatch = IF r.phase \\in {"owner", "existing", "body", "consume", "consume-reply", "verify"} THEN r.fieldsMatch /\\ r.signatureValid /\\ r.windowMatch ELSE FALSE, !.signatureValid = TRUE, !.windowMatch = TRUE, !.stamp = IF r.phase = "consume" THEN r.stamp ELSE -1, !.consumed = IF r.phase \\in {"consume-reply", "verify"} THEN r.consumed ELSE FALSE, !.desired = IF r.phase = "response" /\\ r.desired \\in {"200", "201"} THEN "200" ELSE "none", !.response = IF r.response \\in {"200", "201"} THEN "200" ELSE "none"]]]',
      },
    ],
    clauses: [
      {
        name: "verifiedConsumed",
        expression:
          "[i \\in DOMAIN s.requests |-> (s.requests[i].verified => s.requests[i].consumed)]",
      },
    ],
  },
  {
    id: "api-private-authorization-continuation-safety-v3",
    model: "formal/models/api/api_private_authorization.qnt",
    module: "api_private_authorization",
    operator: "SlopPrivateAuthorizationContinuationViewV3",
    hashMode:
      "four-independent-used-observations-and-closed-flow-retirement-cones",
    memoryCandidateMode:
      "erase-unconsumed-phase-and-permanently-retired-flow-payloads",
    fields: [
      {
        name: "state",
        expression:
          '[s EXCEPT !.phase = "idle", !.flows = [i \\in DOMAIN s.flows |-> LET retired == (s.flows[i].exists /\\ s.flowCookie # i /\\ s.grant # i /\\ ~(\\E c \\in DOMAIN s.callbacks: s.callbacks[c].flow = i /\\ (s.callbacks[c].phase \\in {"validate", "exchange", "identity", "seal"} \\/ (s.callbacks[c].phase = "response" /\\ s.callbacks[c].result = "ok")))) IN [s.flows[i] EXCEPT !.until = IF s.flows[i].exists /\\ s.flowCookie # i /\\ ~(\\E c \\in DOMAIN s.callbacks: s.callbacks[c].phase = "validate" /\\ s.callbacks[c].flow = i) THEN 0 ELSE s.flows[i].until, !.session = IF retired THEN 0 ELSE s.flows[i].session, !.actor = IF retired THEN 0 ELSE s.flows[i].actor, !.submission = IF retired THEN 0 ELSE s.flows[i].submission]], !.flowUntil = 0, !.usedFlow = 0, !.usedSession = 0, !.usedActor = 0, !.usedSubmission = 0, !.usedAt = 0, !.usedUntil = 0, !.callbacks = [id \\in DOMAIN s.callbacks |-> LET c == s.callbacks[id] IN IF c.phase \\in {"unused", "done"} THEN <<c.phase>> ELSE IF c.phase = "response" THEN <<c.phase, c.result = "ok", IF c.result = "ok" THEN <<c.flow, c.at>> ELSE <<0, 0>>>> ELSE [c EXCEPT !.nonce = IF c.phase = "validate" THEN c.nonce ELSE 0, !.actor = IF c.phase \\in {"validate", "exchange", "identity"} THEN c.actor ELSE 0, !.result = "none"]]]',
      },
    ],
    clauses: [
      {
        name: "usedSession",
        expression:
          '(s.phase = "used" => s.usedSession = flow(s.usedFlow).session)',
      },
      {
        name: "usedActor",
        expression:
          '(s.phase = "used" => s.usedActor = flow(s.usedFlow).actor)',
      },
      {
        name: "usedSubmission",
        expression:
          '(s.phase = "used" => s.usedSubmission = flow(s.usedFlow).submission)',
      },
      {
        name: "usedDeadline",
        expression: '(s.phase = "used" => s.usedAt < s.usedUntil)',
      },
    ],
  },
  {
    id: "owner-private-terminal-safety-v1",
    model: "formal/models/ui/ui_owner_private_requests.qnt",
    module: "ui_owner_private_requests",
    operator: "SlopOwnerPrivateRequestsViewV1",
    hashMode: "exact-globals-live-requests-and-terminal-raw-invariant-bits",
    memoryCandidateMode:
      "erase-write-only-error-and-terminal-payload-after-full-reset-or-no-reuse",
    fields: [
      {
        name: "state",
        expression:
          '[s EXCEPT !.error = "none", !.requests = [id \\in DOMAIN s.requests |-> LET r == s.requests[id] IN IF r.phase \\in {"unused", "done"} THEN <<r.phase, (r.actor >= 0), (r.actor <= 2), (r.admitted => r.cookie = r.actor)>> ELSE r]]',
      },
    ],
    clauses: [],
  },
  {
    id: "identity-admission-terminal-observation-safety-v2",
    model: "formal/models/api/api_identity_admission.qnt",
    module: "api_identity_admission",
    operator: "SlopIdentityAdmissionTerminalViewV2",
    hashMode:
      "allowed-generation-quota-and-terminal-local-invariant-observations",
    memoryCandidateMode:
      "erase-nonallowed-terminal-generation-and-payload-after-final-read",
    fields: [
      {
        name: "state",
        expression:
          '[s EXCEPT !.requests = [id \\in DOMAIN s.requests |-> LET r == s.requests[id] IN IF r.phase \\in {"unused", "done"} THEN <<r.phase, IF r.result = "allowed" THEN r.generation ELSE 0, r.result = "allowed", (r.result = "allowed" => (r.count >= 1 /\\ r.count <= 2)), (r.result \\in {"allowed", "429"} => (r.expiry > r.stamp /\\ r.retryAfter = r.expiry - r.stamp /\\ r.retryAfter >= 1)), (r.result = "429" => r.count > 2), (r.result = "503" => r.retryAfter = 0)>> ELSE r]]',
      },
    ],
    clauses: [],
  },
  {
    id: "vetting-evidence-registration-observation-safety-v1",
    model: "formal/models/vetting/vetting_evidence_registration.qnt",
    module: "vetting_evidence_registration",
    operator: "SlopVettingEvidenceRegistrationViewV1",
    hashMode: "exact-registration-invariant-observations-and-live-fences",
    memoryCandidateMode:
      "classify-validation-results-and-erase-unconsumed-copy-cones",
    fields: [
      {
        name: "state",
        expression:
          '[s EXCEPT !.wholeMatches = TRUE, !.bytes = [part \\in DOMAIN s.bytes |-> IF s.bytes[part] = "valid" THEN "valid" ELSE "missing"], !.rows = [scope \\in DOMAIN s.rows |-> [s.rows[scope] EXCEPT !.service = 0, !.at = 0]], !.requests = [id \\in DOMAIN s.requests |-> LET r == s.requests[id] IN [r EXCEPT !.raw = IF r.raw = 3 THEN 3 ELSE 1, !.fault = IF r.fault = "none" THEN "none" ELSE IF r.fault \\in {"json", "shape", "digest", "empty", "limit"} THEN "json" ELSE "object", !.service = 0, !.at = 0, !.cause = "none", !.status = IF r.status \\in {200, 201} THEN r.status ELSE 0, !.stored = (r.stored \\subseteq {1, 2}), !.delivered = FALSE]]]',
      },
    ],
    clauses: [],
  },
  {
    id: "payment-history-terminal-page-safety-v2",
    model: "formal/models/payments/payment_history.qnt",
    module: "payment_history",
    operator: "SlopPaymentHistoryTerminalPageViewV2",
    hashMode: "indexed-retirement-and-six-page-invariant-observations",
    memoryCandidateMode: "erase-attribution-fetched-and-absorbing-page-payload",
    fields: [
      {
        name: "state",
        expression:
          'LET retired == (LET sourceAcceptEnabled(id) == (s.pages[id].phase = "response" /\\ s.pages[id].after = s.cursor /\\ ((s.through = -1 /\\ s.pages[id].requested = -1) \\/ s.pages[id].requested = s.through) /\\ ~s.ready /\\ ~s.failed) frozenFrontier == ((\\A id \\in ids: s.pages[id].phase \\in {"response", "done"}) /\\ ~(\\E id \\in ids: sourceAcceptEnabled(id))) IN [id \\in DOMAIN s.pages |-> (s.configured /\\ (s.pages[id].phase = "done" \\/ (s.pages[id].phase = "response" /\\ (s.ready \\/ s.failed \\/ frozenFrontier))))]) IN [s EXCEPT !.monthly = {}, !.pages = [id \\in DOMAIN s.pages |-> IF retired[id] THEN [s.pages[id] EXCEPT !.months = {}, !.fetched = {}, !.after = 0, !.requested = -1, !.through = -1, !.total = -1, !.selected = {}, !.next = 0, !.result = "none"] ELSE [s.pages[id] EXCEPT !.months = {}, !.fetched = {}]]]',
      },
      {
        name: "retired",
        expression:
          'LET sourceAcceptEnabled(id) == (s.pages[id].phase = "response" /\\ s.pages[id].after = s.cursor /\\ ((s.through = -1 /\\ s.pages[id].requested = -1) \\/ s.pages[id].requested = s.through) /\\ ~s.ready /\\ ~s.failed) frozenFrontier == ((\\A id \\in ids: s.pages[id].phase \\in {"response", "done"}) /\\ ~(\\E id \\in ids: sourceAcceptEnabled(id))) IN [id \\in DOMAIN s.pages |-> (s.configured /\\ (s.pages[id].phase = "done" \\/ (s.pages[id].phase = "response" /\\ (s.ready \\/ s.failed \\/ frozenFrontier))))]',
      },
    ],
    clauses: [
      {
        name: "selectedSize",
        expression:
          "[id \\in DOMAIN s.pages |-> (Cardinality(s.pages[id].selected) <= 2)]",
      },
      {
        name: "selectedSubsetFetched",
        expression:
          "[id \\in DOMAIN s.pages |-> (s.pages[id].selected \\subseteq s.pages[id].fetched)]",
      },
      {
        name: "fetchedCount",
        expression:
          "[id \\in DOMAIN s.pages |-> (Cardinality(s.pages[id].fetched) <= 3)]",
      },
      {
        name: "monthsSubset",
        expression:
          "[id \\in DOMAIN s.pages |-> (s.pages[id].months \\subseteq s.pages[id].selected)]",
      },
      {
        name: "selectedRange",
        expression:
          "[id \\in DOMAIN s.pages |-> (\\A row \\in s.pages[id].selected: row > s.pages[id].after /\\ row <= s.pages[id].through)]",
      },
      {
        name: "validResult",
        expression:
          '[id \\in DOMAIN s.pages |-> ((s.pages[id].result = "200" /\\ s.rail = "vault") => (s.pages[id].selected \\cap s.invalid = {}))]',
      },
    ],
  },
  {
    id: "evm-binding-consent-terminal-safety-v1",
    model: "formal/models/payments/evm_binding_consent_api.qnt",
    module: "evm_binding_consent_api",
    operator: "SlopEvmBindingConsentTerminalViewV1",
    hashMode: "terminal-stored-key-and-raw-local-invariant-observations",
    memoryCandidateMode:
      "erase-write-only-output-and-terminal-payload-after-final-use",
    fields: [
      {
        name: "state",
        expression:
          '[s EXCEPT !.requests = [id \\in DOMAIN s.requests |-> LET r == s.requests[id] IN IF r.phase \\in {"unused", "response", "done"} THEN <<r.phase, r.inserted, r.verified, r.desired = "200-authorized", IF r.inserted \\/ r.desired = "200-authorized" THEN <<r.snapshot, r.deployment, r.version, r.expiry>> ELSE <<0, 0, 0, 0>>, r.discoveryCalls <= 1, (r.discoveryCalls = 1 => (r.mode = "challenge" /\\ r.suppliedVersion = -1)), (r.verified => (r.mode = "authorize" /\\ r.snapshot = r.claim /\\ r.expiry > r.stamp + 600 /\\ r.expiry <= r.stamp + upper)), (r.desired = "200-challenge" => (~r.inserted /\\ r.expiry = r.stamp + lifetime))>> ELSE [r EXCEPT !.offset = 0, !.response = "none"]]]',
      },
    ],
    clauses: [],
  },
  {
    id: "historical-subscription-intake-phase-readback-safety-v2",
    model: "formal/models/slopbot/historical_subscription_intake.qnt",
    module: "historical_subscription_intake",
    operator: "SlopHistoricalSubscriptionIntakeViewV2",
    hashMode: "phase-subset-and-monotone-readback-observations",
    memoryCandidateMode:
      "erase-post-refresh-carriers-and-true-terminal-receipt-indices",
    fields: [
      {
        name: "state",
        expression:
          '[s EXCEPT !.requests = [id \\in DOMAIN s.requests |-> LET r == s.requests[id] IN IF r.phase \\in {"unused", "response", "done"} THEN LET receipt == (r.status = 200 => (rowAt(r.returnedRow).exists /\\ r.returnedPayload = rowAt(r.returnedRow).payload)) IN <<r.phase, r.attempt, IF r.attempt > 0 /\\ r.attempt < 2 THEN <<r.mode, r.key, r.parent, r.payload, r.bundle>> ELSE <<>>, r.status = 200, receipt, IF receipt THEN <<0, 0>> ELSE <<r.returnedRow, r.returnedPayload>>, (r.status > 0 => r.noStore), (r.refreshed \\subseteq r.collected), (r.collected \\subseteq r.members)>> ELSE IF r.phase \\in {"prepare", "preflight", "append", "readback"} THEN <<"post-refresh", [r EXCEPT !.received = FALSE, !.sourceRevisions = [sourceId \\in DOMAIN r.sourceRevisions |-> 0], !.collected = {}, !.refreshed = {}], (r.refreshed \\subseteq r.collected), (r.collected \\subseteq r.members)>> ELSE [r EXCEPT !.received = FALSE]]]',
      },
    ],
    clauses: [],
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
