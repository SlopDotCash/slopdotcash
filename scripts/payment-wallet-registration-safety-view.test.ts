/** Source-only native controllers over the complete production module. */
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
const model = "formal/models/payments/payment_wallet_registration.qnt";
const source = readFileSync(resolve(root, model), "utf8");
const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const manifest = readSafetyViews(root);
const selected = (() => {
  const view = manifest.views.find((entry) => entry.model === model);
  if (!view) throw new Error("Missing reviewed wallet-registration VIEW");
  return view;
})();
const enabled = process.env.SLOP_QUINT_TRANSLATOR_TEST === "1";
test("wallet-registration VIEW binds the entire unchanged model", () => {
  expect(sha256(source)).toBe(
    "d5023fc793181ed1a348c7d636806f89f5870971e790c25c188bd6648c3fec01",
  );
  expect(bindSafetyView(manifest, selected.id, model, source)).toBe(selected);
});
test("new consumers, retry/reset changes, digest metadata and legacy-step drift need review", () => {
  for (const [before, after] of [
    [
      'Set("unused", "done").contains(previous.phase)',
      'Set("unused", "response", "done").contains(previous.phase)',
    ],
    [
      "previous.attempt > 0 implies actor == previous.actor",
      "previous.attempt > 0 implies actor != previous.actor",
    ],
    [
      'request.phase == "helper-reply",',
      'request.phase == "helper-reply", request.stamp >= 0,',
    ],
    [
      'request.phase == "response",',
      'request.phase == "response", request.winnerObserved > 0,',
    ],
    ["and a.login == b.login", "and a.login != b.login"],
    ["and a.stamp == b.stamp", "and a.stamp != b.stamp"],
    [
      '.with("desired", desired).with("returned", returned)',
      '.with("desired", desired)',
    ],
    ['.with("stamp", s.now)))', '.with("stamp", previous.stamp)))'],
    ['request.helperKind == "conflict"', 'request.helperKind != "conflict"'],
    ["claim.id == id", "claim.id >= id"],
    [
      "      tick,",
      "      { nondet slot = slots.oneOf() legacyWinnerRead(slot) },\n      tick,",
    ],
  ]) {
    const changed = source.replace(before, after);
    expect(changed).not.toBe(source);
    expect(() => bindSafetyView(manifest, selected.id, model, changed)).toThrow(
      "model changed",
    );
  }
});
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
      console.log(${JSON.stringify(`WALLET_REGISTRATION_VIEW_VIOLATION_${name}`)});process.exit(1);
    }
    console.log(${JSON.stringify(`WALLET_REGISTRATION_VIEW_COMPLETE_${name}`)});
  `;
  let output = "";
  const status = await runE2ePhase({
    label: `wallet-registration-view-${name}`,
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
      join(tmpdir(), "wallet-registration-native-translation-"),
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
        label: "wallet-registration-production-translation-only",
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
Good3 == [exists |-> TRUE, id |-> 3, actor |-> 1, chain |-> 1, address |-> 1, login |-> 1, source |-> "registry", stamp |-> 0, predecessor |-> 0]
Good2 == [Good3 EXCEPT !.id = 2]
Bad5 == [Good3 EXCEPT !.id = 4, !.address = 2]
RequestSuccess(r) == r.desired # "200" \/ (row(r.returned).exists /\ row(r.returned).source = "registry" /\ row(r.returned).address = r.address /\ row(r.returned).actor = r.actor /\ row(r.returned).chain = r.chain)
RowSafe(i) == LET c == row(i) IN ~c.exists \/ (c.id = i /\ c.actor \in actors /\ c.chain \in chains /\ (c.predecessor = 0 \/ (row(c.predecessor).exists /\ row(c.predecessor).actor = c.actor /\ row(c.predecessor).chain = c.chain)))
HeadSafe(k) == LET h == s.heads[k] IN h = 0 \/ (row(h).exists /\ partition(row(h).actor,row(h).chain) = k /\ (\A i \in ids: ~row(i).exists \/ row(i).predecessor # h))
`;
async function fixture(
  dirty: string,
  action: string,
  property: string,
  alternativeInit?: string,
) {
  const config = await freshProductionConfig();
  const original = config.tlaCode;
  const match = original.match(/^init ==\n {2}s\n {4}= ([\s\S]*?)\n\n\(\*/mu);
  if (!match) throw new Error("Pinned production init expression changed");
  const aliases = [
    [
      "q_init == init\n",
      `${localHelpers}
SlopWalletBase == [${match[1]} EXCEPT !.requests = [id \\in slots |-> [idle EXCEPT !.phase = "done"]]]
q_init == ${alternativeInit ?? `s = ${dirty ? `[SlopWalletBase EXCEPT ${dirty}]` : "SlopWalletBase"}`}
`,
    ],
    ["q_step == step\n", `q_step == ${action}\n`],
    ["q_inv == invariant\n", `q_inv == ${property}\n`],
  ] as const;
  let body = original.slice(0, -81);
  for (const [before, after] of aliases) {
    expect(body.split(before)).toHaveLength(2);
    body = body.replace(before, after);
  }
  let restored = body;
  for (const [before, after] of aliases)
    restored = restored.replace(after, before);
  expect(`${restored}${"=".repeat(80)}\n`).toBe(original);
  return `${body}${"=".repeat(80)}\n`;
}
const success =
  '!.requests[1].desired = "200", !.requests[1].returned = 3, !.rows[3] = Good3';
type Control = readonly [
  name: string,
  initial: string,
  update: string,
  property: string,
];
const controls: Control[] = [
  ["clock-lower", "", "!.now = -1", "s.now >= 0"],
  ["clock-upper", "!.now = 2", "!.now = 3", "s.now <= 2"],
  ["row-id", "!.rows[3] = Good3", "!.rows[3].id = 4", "RowSafe(3)"],
  [
    "false-row-id-heals",
    "!.rows[3] = [Good3 EXCEPT !.id = 4]",
    "!.rows[3].id = 3",
    "~RowSafe(3)",
  ],
  [
    "row-actor-domain",
    "!.rows[3] = Good3",
    "!.rows[3].actor = 3",
    "RowSafe(3)",
  ],
  [
    "row-chain-domain",
    "!.rows[3] = Good3",
    "!.rows[3].chain = 3",
    "RowSafe(3)",
  ],
  [
    "row-predecessor-existence",
    "!.rows[3] = Good3",
    "!.rows[3].predecessor = 2",
    "RowSafe(3)",
  ],
  [
    "false-row-predecessor-heals",
    "!.rows[3] = [Good3 EXCEPT !.predecessor = 2]",
    "!.rows[2] = Good2",
    "~RowSafe(3)",
  ],
  [
    "row-predecessor-actor",
    "!.rows[3] = [Good3 EXCEPT !.predecessor = 2], !.rows[2] = Good2",
    "!.rows[2].actor = 2",
    "RowSafe(3)",
  ],
  [
    "false-row-predecessor-actor-heals",
    "!.rows[3] = [Good3 EXCEPT !.predecessor = 2], !.rows[2] = [Good2 EXCEPT !.actor = 2]",
    "!.rows[2].actor = 1",
    "~RowSafe(3)",
  ],
  [
    "row-predecessor-chain",
    "!.rows[3] = [Good3 EXCEPT !.predecessor = 2], !.rows[2] = Good2",
    "!.rows[2].chain = 2",
    "RowSafe(3)",
  ],
  [
    "head-existence",
    "!.heads[1] = 3, !.rows[3] = Good3",
    "!.rows[3].exists = FALSE",
    "HeadSafe(1)",
  ],
  [
    "false-head-existence-heals",
    "!.heads[1] = 3",
    "!.rows[3] = Good3",
    "~HeadSafe(1)",
  ],
  [
    "head-partition",
    "!.heads[1] = 3, !.rows[3] = Good3",
    "!.rows[3].actor = 2",
    "HeadSafe(1)",
  ],
  [
    "head-tip",
    "!.heads[1] = 3, !.rows[3] = Good3",
    "!.rows[4] = [Good3 EXCEPT !.id = 4, !.predecessor = 3]",
    "HeadSafe(1)",
  ],
  [
    "false-head-tip-heals",
    "!.heads[1] = 3, !.rows[3] = Good3, !.rows[4] = [Good3 EXCEPT !.id = 4, !.predecessor = 3]",
    "!.rows[4].predecessor = 0",
    "~HeadSafe(1)",
  ],
  [
    "attempt-lower",
    "",
    "!.requests[1].attempt = -1",
    "s.requests[1].attempt >= 0",
  ],
  [
    "attempt-upper",
    "!.requests[1].attempt = 2",
    "!.requests[1].attempt = 3",
    "s.requests[1].attempt <= 2",
  ],
  [
    "success-row-existence",
    `${success}`,
    "!.rows[3].exists = FALSE",
    "RequestSuccess(s.requests[1])",
  ],
  [
    "success-row-source",
    `${success}`,
    '!.rows[3].source = "historical"',
    "RequestSuccess(s.requests[1])",
  ],
  [
    "success-request-address",
    `${success}`,
    "!.requests[1].address = 2",
    "RequestSuccess(s.requests[1])",
  ],
  [
    "success-request-actor",
    `${success}`,
    "!.requests[1].actor = 2",
    "RequestSuccess(s.requests[1])",
  ],
  [
    "success-request-chain",
    `${success}`,
    "!.requests[1].chain = 2",
    "RequestSuccess(s.requests[1])",
  ],
  [
    "success-returned-key",
    `${success}`,
    "!.requests[1].returned = 0",
    "RequestSuccess(s.requests[1])",
  ],
  [
    "false-success-row-existence-heals",
    `${success}, !.rows[3].exists = FALSE`,
    "!.rows[3].exists = TRUE",
    "~RequestSuccess(s.requests[1])",
  ],
  [
    "false-success-row-source-heals",
    `${success}, !.rows[3].source = "historical"`,
    '!.rows[3].source = "registry"',
    "~RequestSuccess(s.requests[1])",
  ],
  [
    "false-success-request-address-heals",
    `${success}, !.requests[1].address = 2`,
    "!.requests[1].address = 1",
    "~RequestSuccess(s.requests[1])",
  ],
  [
    "false-success-request-actor-heals",
    `${success}, !.requests[1].actor = 2`,
    "!.requests[1].actor = 1",
    "~RequestSuccess(s.requests[1])",
  ],
  [
    "false-success-request-chain-heals",
    `${success}, !.requests[1].chain = 2`,
    "!.requests[1].chain = 1",
    "~RequestSuccess(s.requests[1])",
  ],
  [
    "dirty-live-success-return",
    `${success}, !.requests[1].phase = "prepare"`,
    "!.requests[1].returned = 0",
    "RequestSuccess(s.requests[1])",
  ],
  [
    "retry-actor",
    "!.requests[1].attempt = 1",
    "!.requests[1].actor = 2",
    "s.requests[1].actor = 1",
  ],
  [
    "retry-chain",
    "!.requests[1].attempt = 1",
    "!.requests[1].chain = 2",
    "s.requests[1].chain = 1",
  ],
  [
    "row-digest-login",
    "!.rows[3] = Good3",
    "!.rows[3].login = 3",
    "row(3).login = 1",
  ],
  [
    "row-digest-stamp",
    "!.rows[3] = Good3",
    "!.rows[3].stamp = 1",
    "row(3).stamp = 0",
  ],
  [
    "helper-reply-return",
    '!.requests[1].phase = "helper-reply", !.requests[1].helperReturned = 3',
    "!.requests[1].helperReturned = 2",
    "s.requests[1].helperReturned = 3",
  ],
  [
    "helper-conflict-class",
    '!.requests[1].phase = "helper-reply"',
    '!.requests[1].helperKind = "conflict"',
    's.requests[1].helperKind # "conflict"',
  ],
  [
    "live-tip-login",
    '!.requests[1].phase = "tip", !.requests[1].login = 1',
    "!.requests[1].login = 3",
    "s.requests[1].login = 1",
  ],
  [
    "live-tip-stamp",
    '!.requests[1].phase = "tip", !.requests[1].stamp = 0',
    "!.requests[1].stamp = 1",
    "s.requests[1].stamp = 0",
  ],
  [
    "live-prepare-login",
    '!.requests[1].phase = "prepare", !.requests[1].login = 1',
    "!.requests[1].login = 3",
    "s.requests[1].login = 1",
  ],
  [
    "live-prepare-stamp",
    '!.requests[1].phase = "prepare", !.requests[1].stamp = 0',
    "!.requests[1].stamp = 1",
    "s.requests[1].stamp = 0",
  ],
  [
    "live-prepare-predecessor",
    '!.requests[1].phase = "prepare", !.requests[1].predecessor = 0',
    "!.requests[1].predecessor = 2",
    "s.requests[1].predecessor = 0",
  ],
  [
    "unknown-returned",
    '!.requests[1].phase = "unknown", !.requests[1].returned = 1',
    "!.requests[1].returned = 2",
    "s.requests[1].returned = 1",
  ],
  [
    "live-helper-attempt",
    '!.requests[1].phase = "helper", !.requests[1].attempt = 1',
    "!.requests[1].attempt = 2",
    "s.requests[1].attempt = 1",
  ],
  [
    "live-helper-actor",
    '!.requests[1].phase = "helper", !.requests[1].actor = 1',
    "!.requests[1].actor = 2",
    "s.requests[1].actor = 1",
  ],
  [
    "live-helper-chain",
    '!.requests[1].phase = "helper", !.requests[1].chain = 1',
    "!.requests[1].chain = 2",
    "s.requests[1].chain = 1",
  ],
  [
    "live-helper-address",
    '!.requests[1].phase = "helper", !.requests[1].address = 1',
    "!.requests[1].address = 2",
    "s.requests[1].address = 1",
  ],
  [
    "live-helper-login",
    '!.requests[1].phase = "helper", !.requests[1].login = 1',
    "!.requests[1].login = 3",
    "s.requests[1].login = 1",
  ],
  [
    "live-helper-stamp",
    '!.requests[1].phase = "helper", !.requests[1].stamp = 0',
    "!.requests[1].stamp = 1",
    "s.requests[1].stamp = 0",
  ],
  [
    "live-helper-predecessor",
    '!.requests[1].phase = "helper", !.requests[1].predecessor = 0',
    "!.requests[1].predecessor = 2",
    "s.requests[1].predecessor = 0",
  ],
  [
    "live-helper-candidate",
    '!.requests[1].phase = "helper", !.requests[1].candidate = 3',
    "!.requests[1].candidate = 4",
    "s.requests[1].candidate = 3",
  ],
];
async function expectWitness(tla: string, name: string, state = 2) {
  const r = await verifyFixture(tla, true, name);
  expect(r.status, r.output).toBe(1);
  expect(r.output).toContain("Invariant q_inv is violated");
  expect(r.output).toContain(`WALLET_REGISTRATION_VIEW_VIOLATION_${name}`);
  expect(r.output).toContain(`State ${state}:`);
  expect(r.output).not.toContain("violated by the initial state");
  expect(r.output).not.toContain("No error has been found");
}
async function expectComplete(
  tla: string,
  name: string,
  states: number,
  viewed = true,
) {
  const r = await verifyFixture(tla, viewed, name);
  expect(r.status, r.output).toBe(0);
  expect(r.output).toContain("No error has been found");
  expect(r.output).toContain(`WALLET_REGISTRATION_VIEW_COMPLETE_${name}`);
  expect(slopTlcTerminalCounts(r.output)).toEqual({
    distinct: states,
    queued: 0,
  });
}
for (const [name, initial, update, property] of controls) {
  test.skipIf(!enabled)(
    `native wallet VIEW retains ${name}`,
    async () => {
      await expectWitness(
        await fixture(initial, `s' = [s EXCEPT ${update}]`, property),
        name,
      );
    },
    125_000,
  );
}

const pairs = [
  [
    "terminal-non200-dead-payload",
    '!.requests[1].attempt = 1, !.requests[1].desired = "error"',
    '!.requests[1].attempt = 1, !.requests[1].desired = "409", !.requests[1].address = 2, !.requests[1].returned = 6, !.requests[1].login = 3, !.requests[1].stamp = 2, !.requests[1].predecessor = 2, !.requests[1].candidate = 4, !.requests[1].helperReturned = 3, !.requests[1].winnerObserved = 2, !.requests[1].response = "lost"',
  ],
  [
    "terminal-false-success",
    `${success}, !.rows[3].source = "historical"`,
    `${success}, !.rows[3].source = "historical", !.requests[1].login = 3, !.requests[1].stamp = 2, !.requests[1].candidate = 6, !.requests[1].helperReturned = 2, !.requests[1].response = "200"`,
  ],
  [
    "prepare-overwritten-candidate",
    '!.requests[1].phase = "prepare", !.requests[1].attempt = 1, !.requests[1].candidate = 3',
    '!.requests[1].phase = "prepare", !.requests[1].attempt = 1, !.requests[1].candidate = 6, !.requests[1].helperReturned = 2, !.requests[1].returned = 4',
  ],
  [
    "conflict-reply-unused-captures",
    '!.requests[1].phase = "helper-reply", !.requests[1].helperKind = "conflict", !.requests[1].helperReturned = 2',
    '!.requests[1].phase = "helper-reply", !.requests[1].helperKind = "conflict", !.requests[1].helperReturned = 6, !.requests[1].login = 3, !.requests[1].stamp = 2, !.requests[1].predecessor = 2, !.requests[1].candidate = 5',
  ],
  [
    "nonconflict-reply-class",
    '!.requests[1].phase = "helper-reply", !.requests[1].helperKind = "created", !.requests[1].helperReturned = 3',
    '!.requests[1].phase = "helper-reply", !.requests[1].helperKind = "existing", !.requests[1].helperReturned = 3, !.requests[1].login = 3, !.requests[1].stamp = 2',
  ],
  [
    "winner-non200-returned",
    '!.requests[1].phase = "winner", !.requests[1].returned = 3',
    '!.requests[1].phase = "winner", !.requests[1].returned = 4',
  ],
  [
    "live-closed-outputs",
    '!.requests[1].phase = "helper", !.requests[1].candidate = 3',
    '!.requests[1].phase = "helper", !.requests[1].candidate = 3, !.requests[1].response = "lost", !.requests[1].winnerObserved = 4',
  ],
] as const;
for (const [name, first, second] of pairs) {
  test.skipIf(!enabled)(
    `native wallet VIEW coalesces ${name} raw2/view1`,
    async () => {
      const tla = await fixture(
        "",
        "s' = s",
        "TRUE",
        `(s = [SlopWalletBase EXCEPT ${first}]) \\/ (s = [SlopWalletBase EXCEPT ${second}])`,
      );
      await expectComplete(tla, name, 2, false);
      await expectComplete(tla, name, 1, true);
    },
    160_000,
  );
}
const tip =
  '!.configured = TRUE, !.requests[1].phase = "tip", !.requests[1].attempt = 1';
const prep =
  '!.configured = TRUE, !.requests[1].phase = "prepare", !.requests[1].attempt = 1';
const helper =
  '!.configured = TRUE, !.requests[1].phase = "helper", !.requests[1].attempt = 1, !.requests[1].candidate = 3, !.requests[1].stamp = 0';
const digestExisting =
  '!.configured = TRUE, !.rows[3] = Good3, !.heads[1] = 3, !.requests[2].phase = "helper", !.requests[2].attempt = 1, !.requests[2].candidate = 5, !.requests[2].stamp = 0';
const reply =
  '!.configured = TRUE, !.rows[3] = Good3, !.heads[1] = 3, !.requests[1].phase = "helper-reply", !.requests[1].attempt = 1, !.requests[1].helperReturned = 3';
const winner =
  '!.configured = TRUE, !.rows[3] = Good3, !.heads[1] = 3, !.requests[1].phase = "winner", !.requests[1].attempt = 1';
const boundaries = [
  [
    "actual-retry-reset",
    '!.configured = TRUE, !.now = 1, !.requests[1].attempt = 1, !.requests[1].desired = "200", !.requests[1].returned = 2, !.requests[1].address = 2, !.rows[2] = [Good2 EXCEPT !.address = 2]',
    "begin(1,1,1,1,3)",
    String.raw`s.requests[1].phase = "tip" /\ s.requests[1].attempt = 2 /\ s.requests[1].actor = 1 /\ s.requests[1].chain = 1 /\ s.requests[1].address = 1 /\ s.requests[1].login = 3 /\ s.requests[1].stamp = 1 /\ s.requests[1].desired # "200" /\ row(2).exists /\ row(2).address = 2`,
  ],
  [
    "actual-tip-noop-ignores-renamed-login",
    `${tip}, !.now = 1, !.rows[2] = Good2, !.heads[1] = 2, !.requests[1].login = 3, !.requests[1].stamp = 1`,
    "readTip(1,TRUE)",
    String.raw`s.requests[1].phase = "response" /\ s.requests[1].desired = "200" /\ s.requests[1].returned = 2 /\ RequestSuccess(s.requests[1]) /\ row(2).login = 1`,
  ],
  [
    "actual-prepare-retains-dirty-live-success-key",
    `${prep}, !.requests[1].candidate = 6, !.requests[1].desired = "200", !.requests[1].returned = 2`,
    "prepare(1,TRUE)",
    String.raw`s.requests[1].phase = "helper" /\ s.requests[1].candidate = 3 /\ s.requests[1].desired = "200" /\ s.requests[1].returned = 2 /\ ~RequestSuccess(s.requests[1])`,
  ],
  [
    "actual-helper-copies-captured-digest-metadata",
    `${helper}, !.now = 2, !.requests[1].login = 3, !.requests[1].address = 2`,
    "helper(1)",
    String.raw`s.requests[1].phase = "helper-reply" /\ s.requests[1].helperKind # "conflict" /\ s.requests[1].helperReturned = 3 /\ row(3).exists /\ row(3).login = 3 /\ row(3).stamp = 0 /\ row(3).address = 2 /\ row(3).predecessor = 0`,
  ],
  [
    "actual-helper-digest-existing-before-head-cas",
    digestExisting,
    "helper(2)",
    String.raw`s.requests[2].phase = "helper-reply" /\ s.requests[2].helperKind # "conflict" /\ s.requests[2].helperReturned = 3 /\ ~row(5).exists /\ s.heads[1] = 3`,
  ],
  [
    "actual-nonconflict-reply-including-none-kind",
    reply,
    "helperReply(1,TRUE)",
    String.raw`s.requests[1].phase = "response" /\ s.requests[1].desired = "200" /\ s.requests[1].returned = 3 /\ RequestSuccess(s.requests[1])`,
  ],
  [
    "actual-conflict-carries-dirty-success-until-winner",
    `${reply}, !.requests[1].helperKind = "conflict", !.requests[1].helperReturned = 6, !.requests[1].desired = "200", !.requests[1].returned = 3`,
    "helperReply(1,TRUE)",
    String.raw`s.requests[1].phase = "winner" /\ s.requests[1].desired = "200" /\ s.requests[1].returned = 3 /\ RequestSuccess(s.requests[1])`,
  ],
  [
    "actual-historical-winner-refuses",
    '!.configured = TRUE, !.rows[1] = [Good3 EXCEPT !.id = 1, !.source = "historical"], !.heads[1] = 1, !.requests[1].phase = "winner", !.requests[1].attempt = 1',
    "readWinner(1,TRUE)",
    String.raw`s.requests[1].phase = "response" /\ s.requests[1].desired # "200" /\ RequestSuccess(s.requests[1])`,
  ],
  [
    "actual-lost-response-keeps-success-binding",
    `${success}, !.configured = TRUE, !.heads[1] = 3, !.requests[1].phase = "response", !.requests[1].attempt = 1`,
    "respond(1,FALSE)",
    String.raw`s.requests[1].phase = "done" /\ s.requests[1].desired = "200" /\ s.requests[1].returned = 3 /\ RequestSuccess(s.requests[1])`,
  ],
] as const;
for (const [name, initial, action, target] of boundaries) {
  test.skipIf(!enabled)(
    `native production wallet boundary ${name}`,
    async () => {
      await expectWitness(await fixture(initial, action, `~(${target})`), name);
    },
    125_000,
  );
}
const dynamic = [
  [
    "configure-heals-success-with-other-false-row",
    '!.requests[1].desired = "200", !.requests[1].returned = 2, !.rows[5] = Bad5',
    'configure("registry")',
    String.raw`s.configured /\ RequestSuccess(s.requests[1]) /\ ~RowSafe(5)`,
  ],
  [
    "configure-breaks-success-with-other-false-row",
    '!.requests[1].desired = "200", !.requests[1].returned = 2, !.rows[2] = Good2, !.rows[5] = Bad5',
    'configure("historical")',
    String.raw`s.configured /\ ~RequestSuccess(s.requests[1]) /\ ~RowSafe(5)`,
  ],
  [
    "dirty-helper-overwrite-heals-success",
    `${success}, !.configured = TRUE, !.rows[3].source = "historical", !.rows[5] = Bad5, !.requests[2].phase = "helper", !.requests[2].attempt = 1, !.requests[2].candidate = 3, !.requests[2].stamp = 0`,
    "helper(2)",
    String.raw`s.requests[2].phase = "helper-reply" /\ RequestSuccess(s.requests[1]) /\ ~RowSafe(5)`,
  ],
  [
    "dirty-helper-overwrite-breaks-success",
    `${success}, !.configured = TRUE, !.rows[5] = Bad5, !.requests[2].phase = "helper", !.requests[2].attempt = 1, !.requests[2].actor = 2, !.requests[2].address = 2, !.requests[2].candidate = 3, !.requests[2].stamp = 0`,
    "helper(2)",
    String.raw`s.requests[2].phase = "helper-reply" /\ row(3).actor = 2 /\ ~RequestSuccess(s.requests[1]) /\ ~RowSafe(5)`,
  ],
  [
    "historical-append-breaks-returned-row",
    '!.configured = TRUE, !.rows[1] = [Good3 EXCEPT !.id = 1], !.requests[1].desired = "200", !.requests[1].returned = 1',
    "historicalAppend(1,1)",
    String.raw`s.historicalUsed /\ ~RequestSuccess(s.requests[1])`,
  ],
] as const;
for (const [name, initial, action, target] of dynamic) {
  test.skipIf(!enabled)(
    `native wallet dynamic binding ${name}`,
    async () => {
      await expectWitness(await fixture(initial, action, `~(${target})`), name);
    },
    125_000,
  );
}
test.skipIf(!enabled)(
  "native former historical winner rule remains a visible counterexample",
  async () => {
    const initial =
      '!.configured = TRUE, !.rows[1] = [Good3 EXCEPT !.id = 1, !.source = "historical"], !.heads[1] = 1, !.requests[1].phase = "winner"';
    await expectWitness(
      await fixture(
        initial,
        "legacyWinnerRead(1)",
        "RequestSuccess(s.requests[1])",
      ),
      "excluded-legacy-historical-winner",
    );
  },
  125_000,
);

const guards = [
  [
    "begin-retry",
    "!.configured = TRUE, !.requests[1].attempt = 1",
    "begin(1,1,1,2,3)",
    2,
  ],
  [
    "begin-attempt-cap",
    "!.configured = TRUE, !.requests[1].attempt = 2",
    "begin(1,1,1,1,1)",
    1,
  ],
  [
    "begin-other-actor-refuses",
    "!.configured = TRUE, !.requests[1].attempt = 1",
    "begin(1,2,1,1,1)",
    1,
  ],
  [
    "begin-other-chain-refuses",
    "!.configured = TRUE, !.requests[1].attempt = 1",
    "begin(1,1,2,1,1)",
    1,
  ],
  [
    "tip-registry-noop",
    `${tip}, !.rows[2] = Good2, !.heads[1] = 2, !.requests[1].login = 3`,
    "readTip(1,TRUE)",
    2,
  ],
  ["tip-error", tip, "readTip(1,FALSE)", 2],
  [
    "prepare-overwrites-candidate",
    `${prep}, !.requests[1].candidate = 6`,
    "prepare(1,TRUE)",
    2,
  ],
  ["helper-creates", helper, "helper(1)", 2],
  ["helper-digest-existing", digestExisting, "helper(2)", 2],
  [
    "helper-login-conflict",
    `${digestExisting}, !.rows[3].login = 3`,
    "helper(2)",
    2,
  ],
  [
    "helper-stamp-conflict",
    `${digestExisting}, !.rows[3].stamp = 1`,
    "helper(2)",
    2,
  ],
  ["reply-none-is-nonconflict", reply, "helperReply(1,TRUE)", 2],
  [
    "reply-conflict",
    `${reply}, !.requests[1].helperKind = "conflict"`,
    "helperReply(1,TRUE)",
    2,
  ],
  ["winner-registry", winner, "readWinner(1,TRUE)", 2],
  [
    "winner-historical",
    `${winner}, !.rows[3].source = "historical"`,
    "readWinner(1,TRUE)",
    2,
  ],
  [
    "response-lost",
    `${success}, !.configured = TRUE, !.heads[1] = 3, !.requests[1].phase = "response"`,
    "respond(1,FALSE)",
    2,
  ],
] as const;
for (const [name, initial, action, states] of guards) {
  test.skipIf(!enabled)(
    `native production wallet queue0 ${name}`,
    async () => {
      await expectComplete(
        await fixture(initial, action, "invariant"),
        name,
        states,
      );
    },
    125_000,
  );
}

function slopTlcTerminalCounts(output: string) {
  const last = [
    ...output.matchAll(
      /^([\d,]+) states? generated, ([\d,]+) distinct states? found, ([\d,]+) states? left on queue\.\r?$/gmu,
    ),
  ].at(-1);
  if (!last) throw new Error("Missing final TLC state counts");
  return {
    distinct: Number(last[2].replaceAll(",", "")),
    queued: Number(last[3].replaceAll(",", "")),
  };
}
test("native evidence requires final counts rather than an earlier progress line", () => {
  expect(
    slopTlcTerminalCounts(
      "1 states generated, 1 distinct state found, 0 states left on queue.\n5 states generated, 4 distinct states found, 0 states left on queue.\n",
    ),
  ).toEqual({ distinct: 4, queued: 0 });
  expect(
    slopTlcTerminalCounts(
      "5,002 states generated, 4,001 distinct states found, 2,003 states left on queue.",
    ),
  ).toEqual({ distinct: 4001, queued: 2003 });
  expect(() =>
    slopTlcTerminalCounts(
      "Progress(1): 2 states generated, 1 distinct state found, 0 states left on queue.",
    ),
  ).toThrow("Missing final TLC state counts");
  expect(() =>
    slopTlcTerminalCounts("2 distinct states found\n0 states left on queue"),
  ).toThrow("Missing final TLC state counts");
  expect(() => slopTlcTerminalCounts("No error has been found")).toThrow(
    "Missing final TLC state counts",
  );
});
