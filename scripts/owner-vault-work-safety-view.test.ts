/** Full-production VIEW controls; hosted execution is required. */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { TlcConfig } from "@informalsystems/quint/dist/src/tlc.js";
import {
  applySafetyView,
  bindSafetyView,
  readSafetyViews,
} from "./quint-safety-view.mjs";
import { runE2ePhase } from "./run-e2e-phase.mjs";

const root = resolve(import.meta.dirname, "..");
const model = "formal/models/ui/ui_owner_vault_setup.qnt";
const source = readFileSync(resolve(root, model), "utf8");
const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const manifest = readSafetyViews(root);
const selected = (() => {
  const found = manifest.views.find((v) => v.model === model);
  if (!found) throw new Error("Missing reviewed owner-vault VIEW");
  return found;
})();
const enabled = process.env.SLOP_QUINT_TRANSLATOR_TEST === "1";
test("owner-vault work VIEW binds the unchanged complete source", () => {
  expect(sha256(source)).toBe(
    "acdadb1e73e178d01c9ac4e3328c0228ff6950a47d0d232def590d96315993d0",
  );
  expect(bindSafetyView(manifest, selected.id, model, source)).toBe(selected);
  expect(sha256(selected.fields[0].expression)).toBe(
    "dfc13ee095c83777d0778ecdc966ae152d04819f95ce225c52a1a39ffdcb3f1e",
  );
  expect(selected.fields[1].expression).toBe(
    String.raw`[SlopOvId \in DOMAIN s.work |-> (SlopOvId \in s.prompts => s.work[SlopOvId].captured.id = SlopOvId)]`,
  );
});
for (const [before, after] of [
  ["s.callbacks.subseteq(s.registered)", "s.callbacks==s.registered"],
  ["s.mounted,id==s.started+1", "s.mounted,s.error==false,id==s.started+1"],
  ["s.store==request.captured", "s.store.id==request.captured.id"],
  ["s.store==s.local", "s.store.id==s.local.id"],
  [
    'request.phase=="wallet"',
    'request.phase=="wallet", request.kind=="create"',
  ],
  ["s.epoch==1", "s.epoch<=2"],
  ['s.with("mounted",false).with("active",0)', 's.with("mounted",false)'],
  ["s.work.get(id).epoch==s.epoch", "s.work.get(id).epoch<=s.epoch"],
  ["ids.contains(id),", 'ids.contains(id),s.work.get(id).phase=="unused",'],
  ["s.callbacks.union(Set(id))", "s.callbacks.union(Set(request.captured.id))"],
  [
    "s.prompts.forall(id=>s.work.get(id).captured.id==id)",
    "s.prompts.forall(id=>s.work.get(id).captured.hash>0)",
  ],
  [
    "val same=s.store==request.captured",
    "val same=s.store.hash==request.captured.hash",
  ],
  [
    "val cleared=storageWorks and s.store==request.captured",
    "val cleared=storageWorks and owns(id) and s.store==request.captured",
  ],
  ["captured:submitted", "captured:s.local"],
] as const) {
  test(`new owner-vault consumer requires review: ${before}`, () => {
    const changed = source.replace(before, after);
    expect(changed).not.toBe(source);
    expect(() => bindSafetyView(manifest, selected.id, model, changed)).toThrow(
      "model changed",
    );
  });
}
async function verifyFixture(tla: string, viewed: boolean, name: string) {
  const definition = `${selected.operator} ==\n  <<${selected.fields.map((f) => f.expression).join(", ")}>>\n\n`;
  const end = tla.match(/^={4,}[ \t]*$/gmu);
  if (end?.length !== 1 || !tla.endsWith(`${end[0]}\n`))
    throw new Error("Native fixture has an unexpected complete TLA terminator");
  const projected = `${tla.slice(0, -end[0].length - 1)}${definition}${end[0]}\n`;
  const binding = {
    ...selected,
    translatedSha256: sha256(tla),
    viewTlaSha256: sha256(projected),
  };
  const probe = `
    import {createRequire} from 'node:module';
    import {readFileSync} from 'node:fs';
    import {applySafetyView,loadSafetyViewTlc,readSafetyViews} from './scripts/quint-safety-view.mjs';
    const require=createRequire(import.meta.url);
    const manifest=readSafetyViews(process.cwd());
    const binding=${JSON.stringify(binding)};
    const config={moduleName:binding.module,tlaCode:${JSON.stringify(tla)},hasInvariant:true,hasTemporal:false};
    const prepared=${viewed ? "applySafetyView(binding,config)" : "config"};
    const runner=loadSafetyViewTlc(require.resolve('@informalsystems/quint/dist/src/tlc.js'),manifest);
    const result=await runner.verify(prepared,'0.62.4',JSON.parse(readFileSync('formal/tlc.json','utf8')),3);
    if(result.isLeft()) {
      if(!result.value.isViolation)process.exit(2);
      console.log(${JSON.stringify(`OWNER_VAULT_WORK_VIEW_VIOLATION_${name}`)});process.exit(1);
    }
    console.log(${JSON.stringify(`OWNER_VAULT_WORK_VIEW_COMPLETE_${name}`)});
  `;
  let output = "";
  const status = await runE2ePhase({
    label: `owner-vault-work-view-${name}`,
    command: "node",
    args: ["--input-type=module", "-e", probe],
    cwd: root,
    env: process.env,
    timeoutMs: 30_000,
    onStdout: (text: string) => {
      output += text;
    },
    onStderr: (text: string) => {
      output += text;
    },
  });
  return { status, output };
}

let capturedProduction: Promise<TlcConfig> | undefined;
function freshProductionConfig(): Promise<TlcConfig> {
  capturedProduction ??= (async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "owner-vault-work-native-translation-"),
    );
    const outputPath = join(directory, "complete-config.json");
    const capturePath = join(directory, "capture.mjs");
    writeFileSync(
      capturePath,
      `import {createRequire} from 'node:module';
       import {writeFileSync} from 'node:fs';
       const require=createRequire(${JSON.stringify(resolve(root, "package.json"))});
       require('@informalsystems/quint/dist/src/tlc.js').verify=async(config)=>{
         writeFileSync(${JSON.stringify(outputPath)},JSON.stringify(config));
         process.exit(0);
       };`,
    );
    const env = { ...process.env };
    delete env.SLOP_QUINT_SAFETY_VIEW;
    let output = "";
    try {
      const status = await runE2ePhase({
        label: "owner-vault-work-production-translation-only",
        command: "node",
        args: [
          "--import",
          resolve(root, "scripts/quint-local-translator.mjs"),
          "--import",
          capturePath,
          resolve(root, "node_modules/@informalsystems/quint/dist/src/cli.js"),
          "verify",
          model,
          "--backend=tlc",
          "--verbosity=3",
          "--tlc-config=formal/tlc.json",
          "--invariant=invariant",
        ],
        cwd: root,
        env,
        timeoutMs: 90_000,
        onStdout: (text: string) => {
          output += text;
        },
        onStderr: (text: string) => {
          output += text;
        },
      });
      expect(status, output).toBe(0);
      const config = JSON.parse(readFileSync(outputPath, "utf8")) as TlcConfig;
      expect(sha256(config.tlaCode)).toBe(selected.translatedSha256);
      expect(config.tlaCode.match(/^={4,}[ \t]*$/gmu)).toEqual([
        "=".repeat(80),
      ]);
      const bound = bindSafetyView(manifest, selected.id, model, source);
      const prepared = applySafetyView(bound, config);
      expect(sha256(prepared.tlaCode)).toBe(selected.viewTlaSha256);
      expect(prepared.tlaCode.startsWith(config.tlaCode.slice(0, -81))).toBe(
        true,
      );
      return config;
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  })();
  return capturedProduction;
}

const localHelpers = String.raw`
SlopOvRecord == [id |-> 1, hash |-> 0, terms |-> 1, legacy |-> FALSE]
SlopOvBase == OWNER_INIT_EXPRESSION
SlopOvPromptSafe == \A id \in s.prompts: s.work[id].captured.id = id
SlopOvCallbackSafe == s.callbacks \subseteq s.registered
`;
async function fixture(
  initial: string,
  action: string,
  property: string,
  alternate?: string,
) {
  const config = await freshProductionConfig();
  const original = config.tlaCode;
  const found = original.match(/^init ==\n {2}s\n {4}= ([\s\S]*?)\n\n\(\*/mu);
  if (!found) throw new Error("Pinned production init expression changed");
  const helpers = localHelpers.replace(
    "OWNER_INIT_EXPRESSION",
    `[${found[1]} EXCEPT !.work = [id \\in ids |-> [unused EXCEPT !.phase = "done"]]]`,
  );
  const bindings = [
    [
      "q_init == init\n",
      `q_init == ${alternate ?? `s = ${initial ? `[SlopOvBase EXCEPT ${initial}]` : "SlopOvBase"}`}\n`,
    ],
    ["q_step == step\n", `q_step == ${action}\n`],
    ["q_inv == invariant\n", `${helpers}\nq_inv == ${property}\n`],
  ] as const;
  let body = original.slice(0, -81);
  for (const [old, replacement] of bindings) {
    expect(body.split(old)).toHaveLength(2);
    body = body.replace(old, replacement);
  }
  let restored = body;
  for (const [old, replacement] of bindings)
    restored = restored.replace(replacement, old);
  expect(`${restored}${"=".repeat(80)}\n`).toBe(original);
  return `${body}${"=".repeat(80)}\n`;
}
async function witness(tla: string, name: string, state = 2, viewed = true) {
  const r = await verifyFixture(tla, viewed, name);
  expect(r.status, r.output).toBe(1);
  expect(r.output).toContain("Invariant q_inv is violated");
  expect(r.output).toContain(`State ${state}:`);
  expect(r.output).toContain(`OWNER_VAULT_WORK_VIEW_VIOLATION_${name}`);
  expect(r.output).not.toContain("violated by the initial state");
  expect(r.output).not.toContain("No error has been found");
}
function terminalCounts(output: string) {
  const last = [
    ...output.matchAll(
      /([\d,]+) distinct states found, ([\d,]+) states left on queue/gu,
    ),
  ].at(-1);
  if (!last) throw new Error("Missing final TLC state counts");
  return {
    distinct: Number(last[1].replaceAll(",", "")),
    queued: Number(last[2].replaceAll(",", "")),
  };
}
test("owner-vault evidence uses final counts rather than an earlier progress line", () => {
  expect(
    terminalCounts(
      "1 distinct states found, 0 states left on queue\n4 distinct states found, 0 states left on queue",
    ),
  ).toEqual({ distinct: 4, queued: 0 });
  expect(
    terminalCounts("4,001 distinct states found, 2,003 states left on queue"),
  ).toEqual({ distinct: 4001, queued: 2003 });
  expect(() => terminalCounts("No error has been found")).toThrow(
    "Missing final TLC state counts",
  );
});
async function complete(
  tla: string,
  name: string,
  states: number,
  viewed = true,
) {
  const r = await verifyFixture(tla, viewed, name);
  expect(r.status, r.output).toBe(0);
  expect(r.output).toContain("No error has been found");
  expect(r.output).toContain(`OWNER_VAULT_WORK_VIEW_COMPLETE_${name}`);
  expect(terminalCounts(r.output)).toEqual({ distinct: states, queued: 0 });
}
type Control = readonly [
  name: string,
  initial: string,
  update: string,
  property: string,
];
const controls: Control[] = [
  ["epoch-lower", "", "!.epoch = 0", "s.epoch >= 1"],
  ["epoch-upper", "", "!.epoch = 3", "s.epoch <= 2"],
  ["epoch-false-heals", "!.epoch = 0", "!.epoch = 1", "s.epoch < 1"],
  ["started-lower", "", "!.started = -1", "s.started >= 0"],
  ["started-upper", "", "!.started = 8", "s.started <= 7"],
  [
    "store-hash-lower",
    "!.store = SlopOvRecord",
    "!.store.hash = -1",
    "s.store.hash >= 0",
  ],
  [
    "store-hash-upper",
    "!.store = SlopOvRecord",
    "!.store.hash = 3",
    "s.store.hash <= 2",
  ],
  [
    "empty-record-terms",
    "",
    "!.store.terms = 1",
    "s.store.id = 0 => s.store = empty",
  ],
  [
    "empty-record-legacy",
    "",
    "!.store.legacy = TRUE",
    "s.store.id = 0 => s.store = empty",
  ],
  [
    "empty-record-false-heals",
    "!.store.terms = 1",
    "!.store = empty",
    "~(s.store.id = 0 => s.store = empty)",
  ],
  ["callback-subset", "", "!.callbacks = {2}", "SlopOvCallbackSafe"],
  [
    "callback-false-heals",
    "!.callbacks = {2}",
    "!.registered = {2}",
    "~SlopOvCallbackSafe",
  ],
  ["callback-outside-domain", "", "!.callbacks = {9}", "SlopOvCallbackSafe"],
  [
    "callback-missing-id-distinction",
    "!.callbacks = {2}",
    "!.callbacks = {3}",
    "s.callbacks = {2}",
  ],
  [
    "prompt-unused-capture",
    '!.prompts = {1}, !.work[1].phase = "unused", !.work[1].captured = SlopOvRecord',
    "!.work[1].captured.id = 2",
    "SlopOvPromptSafe",
  ],
  [
    "prompt-done-capture",
    "!.prompts = {1}, !.work[1].captured = SlopOvRecord",
    "!.work[1].captured.id = 2",
    "SlopOvPromptSafe",
  ],
  [
    "prompt-false-heals",
    "!.prompts = {1}",
    "!.work[1].captured = SlopOvRecord",
    "~SlopOvPromptSafe",
  ],
  [
    "prompt-actual-map-key",
    "!.prompts = {9}, !.work = [id \\in ids \\cup {9} |-> [unused EXCEPT !.captured.id = id]]",
    "!.work[9].captured.id = 0",
    "SlopOvPromptSafe",
  ],
  [
    "owned-waiting",
    '!.active = 1, !.work[1] = [unused EXCEPT !.epoch = 1, !.kind = "connect", !.phase = "waiting"]',
    "!.work[1].epoch = 2",
    "owns(1)",
  ],
  [
    "false-global-epoch-owned",
    '!.epoch = 0, !.active = 1, !.work[1] = [unused EXCEPT !.kind = "connect", !.phase = "waiting"]',
    "!.work[1].epoch = 1",
    "owns(1)",
  ],
  [
    "waiting-kind",
    '!.work[1].phase = "waiting", !.work[1].kind = "review"',
    '!.work[1].kind = "recover"',
    's.work[1].kind = "review"',
  ],
  [
    "registering-full-legacy",
    '!.work[1].phase = "registering", !.work[1].kind = "register", !.work[1].captured = SlopOvRecord',
    "!.work[1].captured.legacy = TRUE",
    "s.work[1].captured = SlopOvRecord",
  ],
  [
    "wallet-full-terms",
    '!.work[1].phase = "wallet", !.work[1].captured = SlopOvRecord',
    "!.work[1].captured.terms = 2",
    "s.work[1].captured = SlopOvRecord",
  ],
  [
    "callback-full-hash",
    '!.work[1].phase = "callback", !.work[1].captured = SlopOvRecord',
    "!.work[1].captured.hash = 2",
    "s.work[1].captured = SlopOvRecord",
  ],
  [
    "local-full-record",
    "!.local = SlopOvRecord",
    "!.local.terms = 2",
    "s.local = SlopOvRecord",
  ],
  [
    "actual-work-domain",
    "",
    "!.work = [id \\in ids \\cup {9} |-> unused]",
    "DOMAIN s.work = ids",
  ],
];
for (const [name, initial, update, property] of controls)
  test.skipIf(!enabled)(
    `native owner-vault work preserves ${name}`,
    async () => {
      await witness(
        await fixture(initial, `s' = [s EXCEPT ${update}]`, property),
        name,
      );
    },
    125_000,
  );

const owned = "!.active = 1, !.work[1].epoch = 1";
const wallet = `!.work[1].phase = "wallet", !.work[1].captured = SlopOvRecord, !.store = SlopOvRecord`;
const callback = `!.work[1].phase = "callback", !.work[1].captured = SlopOvRecord, !.store = SlopOvRecord`;
const registering = `${owned}, !.work[1].phase = "registering", !.work[1].kind = "register", !.work[1].captured = SlopOvRecord, !.store = SlopOvRecord`;
const actualWitnesses: readonly Control[] = [
  [
    "late-wallet-retains-hash",
    wallet,
    "walletReply(1,1,TRUE)",
    "s.store.hash = 0",
  ],
  [
    "late-wallet-decline-clears",
    wallet,
    "walletReply(1,2,TRUE)",
    "s.store # empty",
  ],
  [
    "late-callback-clears",
    callback,
    "callbackSettled(1,TRUE)",
    "s.store # empty",
  ],
  [
    "register-heals-exact-member",
    `${registering}, !.callbacks = {1}`,
    "registerReply(1,2)",
    "~SlopOvCallbackSafe",
  ],
  [
    "dirty-unused-begin-resets-prompt",
    '!.prompts = {1}, !.work[1].phase = "unused", !.work[1].captured = SlopOvRecord',
    'begin(1,"connect")',
    "SlopOvPromptSafe",
  ],
  [
    "dirty-done-begin-resets-prompt",
    "!.prompts = {1}, !.work[1].captured = SlopOvRecord",
    'begin(1,"connect")',
    "SlopOvPromptSafe",
  ],
  [
    "send-heals-false-prompt",
    `${owned}, !.work[1].phase = "before-send", !.prompts = {1}`,
    "send(1,TRUE)",
    "~SlopOvPromptSafe",
  ],
  [
    "legacy-registration-keeps-captured-source-id",
    "!.store = [SlopOvRecord EXCEPT !.id = 7, !.legacy = TRUE], !.local = [SlopOvRecord EXCEPT !.id = 7, !.legacy = TRUE], !.prompts = {1}, !.work[1].captured = SlopOvRecord",
    "beginRegister(1,2,TRUE)",
    "SlopOvPromptSafe",
  ],
  [
    "owned-epoch-zero-connect",
    '!.epoch = 0, !.active = 1, !.work[1].phase = "waiting", !.work[1].kind = "connect"',
    "connectReply(1,TRUE)",
    "~s.connected",
  ],
  [
    "owned-fresh-review-any-kind",
    `${owned}, !.work[1].phase = "fresh-review", !.work[1].kind = "unknown"`,
    "freshReviewReply(1,TRUE)",
    's.work[1].phase # "before-send"',
  ],
  [
    "stale-review-keeps-current-review",
    '!.review = 2, !.work[1].phase = "waiting", !.work[1].kind = "review", !.work[1].epoch = 1',
    "reviewReply(1,TRUE,FALSE)",
    '~(s.review = 2 /\\ s.work[1].phase = "done")',
  ],
];
for (const [name, initial, action, property] of actualWitnesses)
  test.skipIf(!enabled)(
    `native owner-vault original action ${name}`,
    async () => {
      const tla = await fixture(initial, action, property);
      await witness(tla, name, 2, false);
      await witness(tla, name);
    },
    160_000,
  );

const positive: readonly (readonly [string, string, string, string, number])[] =
  [
    ["late-wallet-write", wallet, "walletReply(1,1,TRUE)", "invariant", 2],
    ["late-wallet-decline", wallet, "walletReply(1,2,TRUE)", "invariant", 2],
    ["late-wallet-unknown", wallet, "walletReply(1,3,TRUE)", "invariant", 2],
    [
      "late-wallet-storage-failed",
      wallet,
      "walletReply(1,1,FALSE)",
      "invariant",
      2,
    ],
    [
      "late-wallet-ABA-keeps-new-record",
      `${wallet}, !.store.id = 2`,
      "walletReply(1,2,TRUE)",
      "invariant /\\ s.store.id = 2",
      2,
    ],
    [
      "late-wallet-terms-mismatch-keeps-record",
      `${wallet}, !.store.terms = 2`,
      "walletReply(1,1,TRUE)",
      "invariant /\\ s.store.hash = 0",
      2,
    ],
    [
      "late-wallet-legacy-mismatch-keeps-record",
      `${wallet}, !.store.legacy = TRUE`,
      "walletReply(1,2,TRUE)",
      "invariant /\\ s.store.id = 1",
      2,
    ],
    [
      "late-callback-match",
      callback,
      "callbackSettled(1,TRUE)",
      "invariant",
      2,
    ],
    [
      "late-callback-ABA",
      `${callback}, !.store.id = 2`,
      "callbackSettled(1,TRUE)",
      "invariant /\\ s.store.id = 2",
      2,
    ],
    [
      "late-callback-storage-refused",
      callback,
      "callbackSettled(1,FALSE)",
      "invariant /\\ s.store.id = 1",
      2,
    ],
    [
      "register-other-member-stays-false",
      `${registering}, !.callbacks = {2}`,
      "registerReply(1,2)",
      "~SlopOvCallbackSafe",
      2,
    ],
    [
      "register-exact-member-heals",
      `${registering}, !.callbacks = {1}`,
      "registerReply(1,2)",
      "s.callbacks \\subseteq {1}",
      2,
    ],
    [
      "inert-kind-connect-refused",
      '!.work[1].phase = "waiting", !.work[1].kind = "unknown"',
      "connectReply(1,TRUE)",
      "invariant",
      1,
    ],
    [
      "inert-wallet-check-kind-refused",
      '!.work[1].phase = "wallet-check", !.work[1].kind = "unknown"',
      "walletChecked(1,TRUE)",
      "invariant",
      1,
    ],
    [
      "inert-register-kind-refused",
      '!.work[1].phase = "registering", !.work[1].kind = "unknown"',
      "registerReply(1,2)",
      "invariant",
      1,
    ],
    [
      "fresh-review-guard",
      '!.work[1].phase = "fresh-review", !.work[1].kind = "unknown"',
      "freshReviewReply(1,TRUE)",
      "invariant",
      2,
    ],
    [
      "stale-epoch-remount-never-reowns",
      '!.work[1].phase = "waiting", !.work[1].kind = "connect", !.work[1].epoch = 2',
      "remount \\/ connectReply(1,TRUE)",
      "invariant /\\ ~s.connected",
      4,
    ],
    [
      "two-missing-members-heal-one",
      `${registering}, !.callbacks = {1,2}`,
      "registerReply(1,2)",
      "~SlopOvCallbackSafe",
      2,
    ],
  ];
for (const [name, initial, action, property, states] of positive)
  test.skipIf(!enabled)(
    `native owner-vault RAW/VIEW queue0 ${name}`,
    async () => {
      const tla = await fixture(initial, action, property);
      await complete(tla, name, states, false);
      await complete(tla, name, states);
    },
    160_000,
  );
const pairs: readonly (readonly [string, string, string])[] = [
  ["output-cone", "", '!.error = TRUE, !.notice = "unknown", !.inputHash = 2'],
  [
    "unused-dead-capture",
    '!.work[1].phase = "unused"',
    '!.work[1].phase = "done", !.work[1].captured = [SlopOvRecord EXCEPT !.legacy = TRUE]',
  ],
  [
    "coupled-history",
    "!.registered = {1}, !.callbacks = {1}",
    "!.registered = {2}, !.callbacks = {2}",
  ],
  [
    "coupled-false-history",
    "!.registered = {1}, !.callbacks = {1,3}",
    "!.registered = {2}, !.callbacks = {2,3}",
  ],
  [
    "unowned-waiting-epochs",
    '!.work[1].phase = "waiting", !.work[1].kind = "connect", !.work[1].epoch = 1',
    '!.work[1].phase = "waiting", !.work[1].kind = "connect", !.work[1].epoch = 2',
  ],
  [
    "captured-id-true-with-prompt",
    "!.prompts = {1}, !.work[1].captured = SlopOvRecord",
    "!.prompts = {1}, !.work[1].captured = [SlopOvRecord EXCEPT !.hash = 2, !.terms = 8, !.legacy = TRUE]",
  ],
  [
    "captured-id-false-with-prompt",
    "!.prompts = {1}",
    "!.prompts = {1}, !.work[1].captured = [SlopOvRecord EXCEPT !.id = 2]",
  ],
  [
    "guard-inert-phase-kind",
    '!.work[1].phase = "waiting", !.work[1].kind = "unknown"',
    '!.work[1].phase = "registering", !.work[1].kind = "unknown"',
  ],
];
for (const [name, a, b] of pairs)
  test.skipIf(!enabled)(
    `native owner-vault positive quotient ${name}`,
    async () => {
      const tla = await fixture(
        "",
        "s' = s",
        "TRUE",
        `(s = [SlopOvBase EXCEPT ${a || "!.inputHash = 0"}]) \\/ (s = [SlopOvBase EXCEPT ${b}])`,
      );
      await complete(tla, name, 2, false);
      await complete(tla, name, 1);
    },
    160_000,
  );

test.skipIf(!enabled)(
  "native outside-ID work rows retain both ownership predecessors through active zero",
  async () => {
    const first =
      '[SlopOvBase EXCEPT !.active = 1, !.work = [id \\in ids \\cup {0} |-> [unused EXCEPT !.kind = "connect", !.phase = "waiting", !.epoch = 1]]]';
    const second =
      '[SlopOvBase EXCEPT !.active = 1, !.work = [id \\in ids \\cup {0} |-> [unused EXCEPT !.kind = "connect", !.phase = "waiting", !.epoch = IF id = 0 THEN 2 ELSE 1]]]';
    const tla = await fixture(
      "",
      "changeChoice",
      "invariant",
      "(s = " + first + ") \\/ (s = " + second + ")",
    );
    await complete(tla, "outside-id-active-zero", 4, false);
    await complete(tla, "outside-id-active-zero", 4);
  },
  160_000,
);
