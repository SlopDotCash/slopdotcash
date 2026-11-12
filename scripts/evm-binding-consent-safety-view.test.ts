/** Whole-source-bound controls; native execution is separately scheduled. */
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
const model = "formal/models/payments/evm_binding_consent_api.qnt";
const source = readFileSync(resolve(root, model), "utf8");
const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const manifest = readSafetyViews(root);
const selected = (() => {
  const view = manifest.views.find((entry) => entry.model === model);
  if (!view) throw new Error("Missing reviewed EVM consent VIEW");
  return view;
})();
const enabled = process.env.SLOP_QUINT_TRANSLATOR_TEST === "1";
test("EVM consent VIEW binds the complete unchanged model", () => {
  expect(sha256(source)).toBe(
    "77a1f212e49842ff9698118bd7de9aff3434c30add74e1da73f0a605339bcd19",
  );
  expect(bindSafetyView(manifest, selected.id, model, source)).toBe(selected);
});
test("new terminal readers, row normalization, reuse and output consumers need review", () => {
  for (const [before, after] of [
    [
      's.requests.get(id).phase == "unused",',
      'Set("unused", "done").contains(s.requests.get(id).phase),',
    ],
    [
      'request.phase == "body",',
      'request.phase == "body", request.offset == 601,',
    ],
    [
      'request.phase == "wallet",',
      'request.phase == "wallet", request.response == "none",',
    ],
    [
      'request.phase == "response",',
      'request.phase == "response", request.signature > 0,',
    ],
    [
      "row.version == request.version",
      "row.version == request.version and row.created == request.stamp",
    ],
    [
      "request.inserted implies retained.exists",
      "request.inserted implies request.claim == s.effective and retained.exists",
    ],
    [
      "s.rows.size() <= 3,",
      's.rows.map(row => row.with("signature", 1).with("created", 0)).size() <= 3,',
    ],
    ['if (seed == "none") Set()', 'if (seed == "none") s.rows'],
    [
      '.with("offset", offset)',
      '.with("offset", offset).with("inserted", s.requests.get(id).inserted)',
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
      console.log(${JSON.stringify(`EVM_CONSENT_VIEW_VIOLATION_${name}`)});process.exit(1);
    }
    console.log(${JSON.stringify(`EVM_CONSENT_VIEW_COMPLETE_${name}`)});
  `;
  let output = "";
  const status = await runE2ePhase({
    label: `evm-consent-view-${name}`,
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
      join(tmpdir(), "evm-consent-native-translation-"),
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
        label: "evm-consent-production-translation-only",
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
SlopEvmSeed == [exists |-> TRUE, claim |-> 1, deployment |-> 1, version |-> 0, expiry |-> 601, signature |-> 1, created |-> 0]
C1(r) == r.discoveryCalls <= 1
C2(r) == (r.discoveryCalls = 1 => (r.mode = "challenge" /\ r.suppliedVersion = -1))
C3(r) == (r.verified => (r.mode = "authorize" /\ r.snapshot = r.claim /\ r.expiry > r.stamp + 600 /\ r.expiry <= r.stamp + upper))
C4(r) == (r.desired = "200-challenge" => (~r.inserted /\ r.expiry = r.stamp + lifetime))
D1(r) == LET kept == stored(r) IN (r.inserted => (kept.exists /\ kept.signature > 0))
D2(r) == LET kept == stored(r) IN (r.desired = "200-authorized" => (r.verified /\ kept.exists /\ kept.signature > 0))
RowUnique == \A a \in s.rows: \A b \in s.rows: a = b \/ ~(a.claim = b.claim /\ a.deployment = b.deployment /\ a.version = b.version /\ a.expiry = b.expiry)
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
SlopEvmBase == [${match[1]} EXCEPT !.requests = [id \\in ids |-> [idle EXCEPT !.phase = "done"]]]
q_init == ${alternativeInit ?? `s = ${dirty ? `[SlopEvmBase EXCEPT ${dirty}]` : "SlopEvmBase"}`}
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
const key =
  "!.requests[1].snapshot = 1, !.requests[1].deployment = 1, !.requests[1].version = 0, !.requests[1].expiry = 601";
const valid = `${key}, !.requests[1].mode = "authorize", !.requests[1].claim = 1`;
type Control = readonly [
  name: string,
  initial: string,
  update: string,
  property: string,
];
const controls: Control[] = [
  ["clock-class", "", "!.now = 602", "s.now \\in {0,601,upper+1}"],
  ["effective-domain", "", "!.effective = 3", "s.effective \\in ids"],
  [
    "row-count",
    "!.rows = {SlopEvmSeed, [SlopEvmSeed EXCEPT !.version = 1], [SlopEvmSeed EXCEPT !.expiry = 602]}",
    "!.rows = s.rows \\cup {[SlopEvmSeed EXCEPT !.expiry = 603]}",
    "Cardinality(s.rows) <= 3",
  ],
  [
    "duplicate-key-signature-with-false-local",
    "!.rows = {SlopEvmSeed}, !.requests[1].discoveryCalls = 2",
    "!.rows = s.rows \\cup {[SlopEvmSeed EXCEPT !.signature = 2]}",
    "RowUnique",
  ],
  [
    "duplicate-key-created-with-false-local",
    "!.rows = {SlopEvmSeed}, !.requests[1].discoveryCalls = 2",
    "!.rows = s.rows \\cup {[SlopEvmSeed EXCEPT !.created = 1]}",
    "RowUnique",
  ],
  [
    "discovery-bound",
    "",
    "!.requests[1].discoveryCalls = 2",
    "C1(s.requests[1])",
  ],
  [
    "false-discovery-bound-heals",
    "!.requests[1].discoveryCalls = 2",
    "!.requests[1].discoveryCalls = 1",
    "~C1(s.requests[1])",
  ],
  [
    "discovery-mode",
    "!.requests[1].discoveryCalls = 1",
    '!.requests[1].mode = "authorize"',
    "C2(s.requests[1])",
  ],
  [
    "false-discovery-mode-heals",
    '!.requests[1].discoveryCalls = 1, !.requests[1].mode = "authorize"',
    '!.requests[1].mode = "challenge"',
    "~C2(s.requests[1])",
  ],
  [
    "discovery-version",
    "!.requests[1].discoveryCalls = 1",
    "!.requests[1].suppliedVersion = 0",
    "C2(s.requests[1])",
  ],
  [
    "false-discovery-version-heals",
    "!.requests[1].discoveryCalls = 1, !.requests[1].suppliedVersion = 0",
    "!.requests[1].suppliedVersion = -1",
    "~C2(s.requests[1])",
  ],
  [
    "verified-mode",
    `${valid}, !.requests[1].verified = TRUE`,
    '!.requests[1].mode = "challenge"',
    "C3(s.requests[1])",
  ],
  [
    "false-verified-mode-heals",
    `${valid}, !.requests[1].verified = TRUE, !.requests[1].mode = "challenge"`,
    '!.requests[1].mode = "authorize"',
    "~C3(s.requests[1])",
  ],
  [
    "verified-claim",
    `${valid}, !.requests[1].verified = TRUE`,
    "!.requests[1].claim = 2",
    "C3(s.requests[1])",
  ],
  [
    "false-verified-claim-heals",
    `${valid}, !.requests[1].verified = TRUE, !.requests[1].claim = 2`,
    "!.requests[1].claim = 1",
    "~C3(s.requests[1])",
  ],
  [
    "verified-expiry",
    `${valid}, !.requests[1].verified = TRUE`,
    "!.requests[1].expiry = 600",
    "C3(s.requests[1])",
  ],
  [
    "false-verified-expiry-heals",
    `${valid}, !.requests[1].verified = TRUE, !.requests[1].expiry = 600`,
    "!.requests[1].expiry = 601",
    "~C3(s.requests[1])",
  ],
  [
    "verified-expiry-upper",
    `${valid}, !.requests[1].verified = TRUE`,
    "!.requests[1].expiry = upper+1",
    "C3(s.requests[1])",
  ],
  [
    "false-verified-expiry-upper-heals",
    `${valid}, !.requests[1].verified = TRUE, !.requests[1].expiry = upper+1`,
    "!.requests[1].expiry = 601",
    "~C3(s.requests[1])",
  ],
  [
    "challenge-inserted",
    '!.requests[1].desired = "200-challenge", !.requests[1].expiry = lifetime',
    "!.requests[1].inserted = TRUE",
    "C4(s.requests[1])",
  ],
  [
    "false-challenge-inserted-heals",
    '!.requests[1].desired = "200-challenge", !.requests[1].expiry = lifetime, !.requests[1].inserted = TRUE',
    "!.requests[1].inserted = FALSE",
    "~C4(s.requests[1])",
  ],
  [
    "challenge-expiry",
    '!.requests[1].desired = "200-challenge", !.requests[1].expiry = lifetime',
    "!.requests[1].expiry = 601",
    "C4(s.requests[1])",
  ],
  [
    "false-challenge-expiry-heals",
    '!.requests[1].desired = "200-challenge", !.requests[1].expiry = 601',
    "!.requests[1].expiry = lifetime",
    "~C4(s.requests[1])",
  ],
  [
    "inserted-row-missing",
    `${key}, !.requests[1].inserted = TRUE, !.rows = {SlopEvmSeed}`,
    "!.rows = {}",
    "D1(s.requests[1])",
  ],
  [
    "false-inserted-row-heals",
    `${key}, !.requests[1].inserted = TRUE`,
    "!.rows = {SlopEvmSeed}",
    "~D1(s.requests[1])",
  ],
  [
    "inserted-signature",
    `${key}, !.requests[1].inserted = TRUE, !.rows = {SlopEvmSeed}`,
    "!.rows = {[SlopEvmSeed EXCEPT !.signature = 0]}",
    "D1(s.requests[1])",
  ],
  [
    "false-inserted-signature-heals",
    `${key}, !.requests[1].inserted = TRUE, !.rows = {[SlopEvmSeed EXCEPT !.signature = 0]}`,
    "!.rows = {SlopEvmSeed}",
    "~D1(s.requests[1])",
  ],
  [
    "authorized-verified",
    `${valid}, !.requests[1].desired = "200-authorized", !.requests[1].verified = TRUE, !.rows = {SlopEvmSeed}`,
    "!.requests[1].verified = FALSE",
    "D2(s.requests[1])",
  ],
  [
    "false-authorized-verified-heals",
    `${valid}, !.requests[1].desired = "200-authorized", !.rows = {SlopEvmSeed}`,
    "!.requests[1].verified = TRUE",
    "~D2(s.requests[1])",
  ],
  [
    "authorized-row",
    `${valid}, !.requests[1].desired = "200-authorized", !.requests[1].verified = TRUE, !.rows = {SlopEvmSeed}`,
    "!.rows = {}",
    "D2(s.requests[1])",
  ],
  [
    "false-authorized-row-heals",
    `${valid}, !.requests[1].desired = "200-authorized", !.requests[1].verified = TRUE`,
    "!.rows = {SlopEvmSeed}",
    "~D2(s.requests[1])",
  ],
  [
    "authorized-signature",
    `${valid}, !.requests[1].desired = "200-authorized", !.requests[1].verified = TRUE, !.rows = {SlopEvmSeed}`,
    "!.rows = {[SlopEvmSeed EXCEPT !.signature = 0]}",
    "D2(s.requests[1])",
  ],
  [
    "false-authorized-signature-heals",
    `${valid}, !.requests[1].desired = "200-authorized", !.requests[1].verified = TRUE, !.rows = {[SlopEvmSeed EXCEPT !.signature = 0]}`,
    "!.rows = {SlopEvmSeed}",
    "~D2(s.requests[1])",
  ],
  [
    "verified-flag-even-when-row-obligation-false",
    `${valid}, !.requests[1].desired = "200-authorized", !.requests[1].discoveryCalls = 2`,
    "!.requests[1].verified = TRUE",
    "~s.requests[1].verified",
  ],
  [
    "inserted-flag-when-stored-false",
    `${key}, !.requests[1].desired = "200-authorized"`,
    "!.requests[1].inserted = TRUE",
    "~s.requests[1].inserted",
  ],
  [
    "authorized-bit-with-row-and-false-local",
    `${valid}, !.requests[1].verified = TRUE, !.requests[1].discoveryCalls = 2, !.rows = {SlopEvmSeed}`,
    '!.requests[1].desired = "200-authorized"',
    's.requests[1].desired # "200-authorized"',
  ],
  [
    "terminal-phase",
    '!.requests[1].phase = "response"',
    '!.requests[1].phase = "done"',
    's.requests[1].phase = "response"',
  ],
  [
    "stored-key-snapshot",
    `${key}, !.requests[1].inserted = TRUE, !.requests[1].discoveryCalls = 2, !.rows = {SlopEvmSeed}`,
    "!.requests[1].snapshot = 2",
    "D1(s.requests[1])",
  ],
  [
    "stored-key-deployment",
    `${key}, !.requests[1].inserted = TRUE, !.requests[1].discoveryCalls = 2, !.rows = {SlopEvmSeed}`,
    "!.requests[1].deployment = 2",
    "D1(s.requests[1])",
  ],
  [
    "stored-key-version",
    `${key}, !.requests[1].inserted = TRUE, !.requests[1].discoveryCalls = 2, !.rows = {SlopEvmSeed}`,
    "!.requests[1].version = 1",
    "D1(s.requests[1])",
  ],
  [
    "stored-key-expiry",
    `${key}, !.requests[1].inserted = TRUE, !.requests[1].discoveryCalls = 2, !.rows = {SlopEvmSeed}`,
    "!.requests[1].expiry = 602",
    "D1(s.requests[1])",
  ],
  [
    "live-mode",
    '!.requests[1].phase = "insert", !.requests[1].mode = "challenge"',
    '!.requests[1].mode = "authorize"',
    's.requests[1].mode = "challenge"',
  ],
  [
    "live-claim",
    '!.requests[1].phase = "insert", !.requests[1].claim = 1',
    "!.requests[1].claim = 2",
    "s.requests[1].claim = 1",
  ],
  [
    "live-stamp",
    '!.requests[1].phase = "insert", !.requests[1].stamp = 0',
    "!.requests[1].stamp = 601",
    "s.requests[1].stamp = 0",
  ],
  [
    "live-suppliedVersion",
    '!.requests[1].phase = "insert", !.requests[1].suppliedVersion = -1',
    "!.requests[1].suppliedVersion = 0",
    "s.requests[1].suppliedVersion = -1",
  ],
  [
    "live-version",
    '!.requests[1].phase = "insert", !.requests[1].version = 0',
    "!.requests[1].version = 1",
    "s.requests[1].version = 0",
  ],
  [
    "live-discoveryCalls",
    '!.requests[1].phase = "insert", !.requests[1].discoveryCalls = 0',
    "!.requests[1].discoveryCalls = 1",
    "s.requests[1].discoveryCalls = 0",
  ],
  [
    "live-expiry",
    '!.requests[1].phase = "insert", !.requests[1].expiry = 601',
    "!.requests[1].expiry = 602",
    "s.requests[1].expiry = 601",
  ],
  [
    "live-deployment",
    '!.requests[1].phase = "insert", !.requests[1].deployment = 0',
    "!.requests[1].deployment = 1",
    "s.requests[1].deployment = 0",
  ],
  [
    "live-snapshot",
    '!.requests[1].phase = "insert", !.requests[1].snapshot = 0',
    "!.requests[1].snapshot = 1",
    "s.requests[1].snapshot = 0",
  ],
  [
    "live-verified",
    '!.requests[1].phase = "insert", !.requests[1].verified = FALSE',
    "!.requests[1].verified = TRUE",
    "s.requests[1].verified = FALSE",
  ],
  [
    "live-signature",
    '!.requests[1].phase = "insert", !.requests[1].signature = 0',
    "!.requests[1].signature = 1",
    "s.requests[1].signature = 0",
  ],
  [
    "live-inserted",
    '!.requests[1].phase = "insert", !.requests[1].inserted = FALSE',
    "!.requests[1].inserted = TRUE",
    "s.requests[1].inserted = FALSE",
  ],
  [
    "live-desired",
    '!.requests[1].phase = "insert", !.requests[1].desired = "none"',
    '!.requests[1].desired = "500"',
    's.requests[1].desired = "none"',
  ],
];
for (const [name, initial, update, property] of controls) {
  test.skipIf(!enabled)(
    `native EVM consent VIEW retains ${name}`,
    async () => {
      const tla = await fixture(initial, `s' = [s EXCEPT ${update}]`, property);
      await expectWitness(tla, name);
    },
    125_000,
  );
}
async function expectWitness(tla: string, name: string) {
  const result = await verifyFixture(tla, true, name);
  expect(result.status, result.output).toBe(1);
  expect(result.output).toContain("Invariant q_inv is violated");
  expect(result.output).toContain(`EVM_CONSENT_VIEW_VIOLATION_${name}`);
  expect(result.output).toContain("State 2:");
  expect(result.output).not.toContain("violated by the initial state");
  expect(result.output).not.toContain("No error has been found");
}

const pairs = [
  [
    "active-write-only-output",
    '!.requests[1].phase = "body", !.requests[1].offset = 600',
    '!.requests[1].phase = "body", !.requests[1].offset = upper+1, !.requests[1].response = "lost"',
  ],
  [
    "terminal-dead-payload-and-unneeded-key",
    "",
    '!.requests[1].claim = 2, !.requests[1].stamp = 601, !.requests[1].mode = "authorize", !.requests[1].signature = 2, !.requests[1].suppliedVersion = 0, !.requests[1].snapshot = 2, !.requests[1].deployment = 2, !.requests[1].version = 1, !.requests[1].expiry = upper',
  ],
  [
    "already-false-verified-clause",
    `${key}, !.requests[1].verified = TRUE`,
    "!.requests[1].verified = TRUE, !.requests[1].stamp = upper+1, !.requests[1].claim = 2",
  ],
  [
    "already-false-challenge-and-stored-clause",
    `${key}, !.requests[1].inserted = TRUE, !.requests[1].desired = "200-challenge"`,
    `${key}, !.requests[1].inserted = TRUE, !.requests[1].desired = "200-challenge", !.requests[1].stamp = upper+1`,
  ],
] as const;
for (const [name, first, second] of pairs) {
  test.skipIf(!enabled)(
    `native EVM consent VIEW coalesces ${name} raw2/view1`,
    async () => {
      const firstState = first
        ? `[SlopEvmBase EXCEPT ${first}]`
        : "SlopEvmBase";
      const secondState = second
        ? `[SlopEvmBase EXCEPT ${second}]`
        : "SlopEvmBase";
      const tla = await fixture(
        "",
        "s' = s",
        "TRUE",
        `(s = ${firstState}) \\/ (s = ${secondState})`,
      );
      for (const viewed of [false, true]) {
        const result = await verifyFixture(tla, viewed, name);
        expect(result.status, result.output).toBe(0);
        expect(result.output).toContain("No error has been found");
        expect(result.output).toContain(`EVM_CONSENT_VIEW_COMPLETE_${name}`);
        expect(result.output).toContain(
          `${viewed ? 1 : 2} distinct states found, 0 states left on queue`,
        );
      }
    },
    160_000,
  );
}

const liveConsent =
  '[idle EXCEPT !.mode = "authorize", !.claim = 1, !.snapshot = 1, !.deployment = 1, !.version = 0, !.expiry = 601, !.signature = 1, !.verified = TRUE]';
const productionControls = [
  [
    "actual-begin-full-reset-with-false-local-classes",
    '!.configured = TRUE, !.now = 601, !.rows = {SlopEvmSeed}, !.requests[1] = [idle EXCEPT !.inserted = TRUE, !.verified = TRUE, !.desired = "200-authorized", !.snapshot = 1, !.deployment = 1, !.version = 0, !.expiry = 601, !.discoveryCalls = 2]',
    'begin(1, "authorize", 2, 1, 601)',
    String.raw`s.requests[1].phase = "body" /\ s.requests[1].mode = "authorize" /\ s.requests[1].claim = 2 /\ s.requests[1].stamp = 601 /\ s.requests[1].suppliedVersion = 1 /\ s.requests[1].expiry = 1202 /\ s.requests[1].snapshot = 0 /\ s.requests[1].deployment = 0 /\ s.requests[1].version = -1 /\ ~s.requests[1].inserted /\ ~s.requests[1].verified /\ s.requests[1].desired = "none" /\ s.requests[1].discoveryCalls = 0 /\ C1(s.requests[1]) /\ C2(s.requests[1]) /\ C3(s.requests[1]) /\ C4(s.requests[1]) /\ s.rows = {SlopEvmSeed}`,
  ],
  [
    "actual-insert-same-key-retains-signature-and-created-with-false-local",
    `!.configured = TRUE, !.rows = {SlopEvmSeed}, !.requests[1] = [${liveConsent} EXCEPT !.phase = "insert", !.signature = 2, !.stamp = 601]`,
    "insert(1, TRUE)",
    String.raw`s.requests[1].phase = "write-reply" /\ ~s.requests[1].inserted /\ s.rows = {SlopEvmSeed} /\ (stored(s.requests[1])).signature = 1 /\ (stored(s.requests[1])).created = 0 /\ ~C3(s.requests[1])`,
  ],
  [
    "actual-other-slot-insert-heals-stored-clause-while-local-false",
    `${key}, !.requests[1].inserted = TRUE, !.requests[1].discoveryCalls = 2, !.requests[2] = [${liveConsent} EXCEPT !.phase = "insert"]`,
    "insert(2, TRUE)",
    String.raw`s.requests[2].phase = "write-reply" /\ s.requests[2].inserted /\ s.requests[1].phase = "done" /\ D1(s.requests[1]) /\ ~C1(s.requests[1])`,
  ],
  [
    "actual-readback-authorized-key-and-verified",
    `!.rows = {SlopEvmSeed}, !.requests[1] = [${liveConsent} EXCEPT !.phase = "readback"]`,
    "readback(1, TRUE)",
    String.raw`s.requests[1].phase = "response" /\ s.requests[1].desired = "200-authorized" /\ D2(s.requests[1]) /\ C3(s.requests[1])`,
  ],
  [
    "actual-respond-carries-false-local-and-dynamic-key",
    `${key}, !.rows = {SlopEvmSeed}, !.requests[1].phase = "response", !.requests[1].verified = TRUE, !.requests[1].desired = "200-authorized"`,
    "respond(1, FALSE)",
    String.raw`s.requests[1].phase = "done" /\ s.requests[1].verified /\ s.requests[1].desired = "200-authorized" /\ D2(s.requests[1]) /\ ~C3(s.requests[1])`,
  ],
  [
    "actual-configure-heals-stored-clause-while-local-false",
    `${key}, !.requests[1].inserted = TRUE, !.requests[1].discoveryCalls = 2`,
    'configure("valid")',
    String.raw`s.configured /\ D1(s.requests[1]) /\ ~C1(s.requests[1])`,
  ],
  [
    "actual-configure-breaks-stored-clause-while-local-false",
    `${key}, !.rows = {SlopEvmSeed}, !.requests[1].inserted = TRUE, !.requests[1].discoveryCalls = 2`,
    'configure("none")',
    String.raw`s.configured /\ ~D1(s.requests[1]) /\ ~C1(s.requests[1])`,
  ],
] as const;
for (const [name, initial, action, witness] of productionControls) {
  test.skipIf(!enabled)(
    `native production EVM consent TLA reaches ${name}`,
    async () => {
      const tla = await fixture(initial, action, `~(${witness})`);
      await expectWitness(tla, name);
    },
    125_000,
  );
}
