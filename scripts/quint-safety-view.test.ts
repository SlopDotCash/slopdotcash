import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  applySafetyView,
  bindSafetyView,
  patchTlcConfig,
  readSafetyViews,
} from "./quint-safety-view.mjs";
import { runE2ePhase } from "./run-e2e-phase.mjs";

const root = resolve(import.meta.dirname, "..");
const manifest = readSafetyViews(root);
const view = manifest.views[0];
const source = readFileSync(resolve(root, view.model), "utf8");
const require = createRequire(import.meta.url);
const adapter = require.resolve("@informalsystems/quint/dist/src/tlc.js");
const adapterSource = readFileSync(adapter, "utf8");
const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

test("journal view binds the reviewed model bytes and refuses other requests", () => {
  expect(bindSafetyView(manifest, view.id, view.model, source)).toEqual(view);
  expect(() => bindSafetyView(manifest, "unknown", view.model, source)).toThrow(
    "Unknown TLC safety-view request",
  );
  expect(() =>
    bindSafetyView(manifest, view.id, "formal/models/other.qnt", source),
  ).toThrow("Unknown TLC safety-view request");
  expect(() =>
    bindSafetyView(manifest, view.id, view.model, `${source}\n`),
  ).toThrow("model changed");
  const temporal = `${source}\ntemporal newProperty = true\n`;
  const temporalManifest = {
    ...manifest,
    views: [{ ...view, sourceSha256: sha256(temporal) }],
  };
  expect(() =>
    bindSafetyView(temporalManifest, view.id, view.model, temporal),
  ).toThrow("does not authorize temporal properties");
});

test("view insertion preserves the complete TLA body and rejects drift", () => {
  const tlaCode = "---- MODULE direct_bounty_journal ----\nVARIABLE s\n====\n";
  const binding = { ...view, translatedSha256: sha256(tlaCode) };
  const config = {
    moduleName: view.module,
    hasInvariant: true,
    hasTemporal: false,
    tlaCode,
  };
  const result = applySafetyView(binding, config);
  expect(result.tlaCode).toBe(
    tlaCode.replace(
      "====\n",
      `${view.operator} ==\n  <<${view.fields.map((field: string) => `s.${field}`).join(", ")}>>\n\n====\n`,
    ),
  );
  expect(result.slopSafetyView).toBe("SlopJournalSafetyView");
  expect(result.viewEvidence.viewTlaSha256).toBe(sha256(result.tlaCode));
  expect(() =>
    applySafetyView(binding, { ...config, hasTemporal: true }),
  ).toThrow("property differs");
  expect(() =>
    applySafetyView({ ...binding, operator: "Unknown" }, config),
  ).toThrow("property differs");
  expect(() =>
    applySafetyView(binding, { ...config, moduleName: "other" }),
  ).toThrow("property differs");
  expect(() =>
    applySafetyView(binding, { ...config, tlaCode: `${tlaCode}\n` }),
  ).toThrow("generated TLA changed");
});

test("pinned official runner changes only the config VIEW emission", () => {
  const patched = patchTlcConfig(adapterSource, manifest.quintAdapterSha256);
  const inserted =
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Match the exact generated JavaScript statement.
    "    if (config.slopSafetyView) cfg += `VIEW ${config.slopSafetyView}\\n`;\n";
  expect(patched.split(inserted)).toHaveLength(2);
  expect(patched.replace(inserted, "")).toBe(adapterSource);
  expect(() =>
    patchTlcConfig(`${adapterSource}\n`, manifest.quintAdapterSha256),
  ).toThrow("adapter changed");
  expect(() =>
    patchTlcConfig("different module", sha256("different module")),
  ).toThrow("config emitter differs");
});

test("pinned Node loads official runner exports through unchanged dependency resolution", () => {
  const output = execFileSync(
    "node",
    [
      "--input-type=module",
      "-e",
      `import {readSafetyViews,loadSafetyViewTlc} from './scripts/quint-safety-view.mjs';
       const result=loadSafetyViewTlc(${JSON.stringify(adapter)},readSafetyViews(process.cwd()));
       console.log(JSON.stringify({verify:typeof result.verify,adapter:result.adapterSha256,overlay:result.overlaySha256}));`,
    ],
    { cwd: root, encoding: "utf8" },
  );
  expect(JSON.parse(output)).toEqual({
    verify: "function",
    adapter: manifest.quintAdapterSha256,
    overlay: sha256(patchTlcConfig(adapterSource, manifest.quintAdapterSha256)),
  });
});

test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
  "the real TLC view runner still reports a retained-field counterexample",
  async () => {
    // A tiny test-only TLA input exercises the real official runner. It is not
    // added to the production allowlist and proves no application behavior.
    const tla = `---- MODULE direct_bounty_journal ----
EXTENDS Naturals
VARIABLE s
q_init == s = [store |-> 0, memory |-> 0, held |-> 0, used |-> 0,
 mounted |-> 0, before |-> 0, touched |-> 0, observed |-> 0, expected |-> 0,
 wrote |-> 0, warning |-> 0, checked |-> 0, emptyInput |-> 0]
q_step == s' = [s EXCEPT !.store = 1]
q_inv == s.store = 0
====
`;
    const probe = `
      import {readFileSync} from 'node:fs';
      import {createHash} from 'node:crypto';
      import {createRequire} from 'node:module';
      import {applySafetyView,loadSafetyViewTlc,readSafetyViews} from './scripts/quint-safety-view.mjs';
      const require=createRequire(import.meta.url);
      const manifest=readSafetyViews(process.cwd());
      const tla=${JSON.stringify(tla)};
      const view={...manifest.views[0],translatedSha256:createHash('sha256').update(tla).digest('hex')};
      const prepared=applySafetyView(view,{moduleName:view.module,tlaCode:tla,hasInvariant:true,hasTemporal:false});
      const runner=loadSafetyViewTlc(require.resolve('@informalsystems/quint/dist/src/tlc.js'),manifest);
      const result=await runner.verify(prepared,'0.62.4',JSON.parse(readFileSync('formal/tlc.json','utf8')),3);
      if(!result.isLeft()||!result.value.isViolation)process.exit(2);
      console.log('VIEW_COUNTEREXAMPLE_CONFIRMED');
      process.exit(1);
    `;
    let output = "";
    const status = await runE2ePhase({
      label: "tlc-safety-view-counterexample",
      command: "node",
      args: ["--input-type=module", "-e", probe],
      cwd: root,
      env: process.env,
      timeoutMs: 170_000,
      onStdout: (text: string) => {
        output += text;
      },
      onStderr: (text: string) => {
        output += text;
      },
    });
    expect(status).toBe(1);
    expect(output).toContain("Invariant q_inv is violated");
    expect(output).toContain("VIEW_COUNTEREXAMPLE_CONFIRMED");
    expect(output).not.toContain("No error has been found");
  },
  180_000,
);
