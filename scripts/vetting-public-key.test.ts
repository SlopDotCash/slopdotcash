/** Generated release configuration and real HTTP readback, with disposable keys only. */
import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type PagesMetadata,
  publicScannerKey,
  SCANNER_PUBLIC_KEYS,
  type ScannerPagesConfig,
  scannerPagesConfiguration,
  verifyScannerPublicKey,
} from "./prepare-vetting-public-key";

test("release assembly keeps plaintext settings, excludes signing material and reads back each environment's exact public key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "slop-scanner-public-"));
  const projects = new Map<string, PagesMetadata>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      if (request.method !== "GET") return new Response(null, { status: 405 });
      const value = projects.get(new URL(request.url).pathname);
      return value ? Response.json(value) : new Response(null, { status: 404 });
    },
  });
  try {
    for (const target of ["staging", "production"] as const) {
      const pair = (await crypto.subtle.generateKey("Ed25519", true, [
        "sign",
        "verify",
      ])) as CryptoKeyPair;
      const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
      const key = await publicScannerKey(
        JSON.stringify(privateJwk),
        target,
        "a".repeat(40),
      );
      const config = Bun.TOML.parse(
        await readFile(
          target === "staging" ? "wrangler.staging.toml" : "wrangler.toml",
          "utf8",
        ),
      ) as ScannerPagesConfig;
      const remote: PagesMetadata = {
        production_branch: target === "staging" ? "development" : "main",
        deployment_configs: {
          production: {
            env_vars: {
              PRESERVED_SETTING: {
                type: "plain_text",
                value: "synthetic-owner-setting",
              },
              PRIVATE_SECRET_NAME: { type: "secret_text" },
            },
          },
        },
      };
      const assembled = scannerPagesConfiguration(config, remote, key);
      const path = join(directory, `${target}.jsonc`);
      await writeFile(path, JSON.stringify(assembled));
      const loaded = JSON.parse(
        await readFile(path, "utf8"),
      ) as ScannerPagesConfig;
      expect(loaded.vars?.PUBLIC_SITE_URL).toBe(config.vars?.PUBLIC_SITE_URL);
      expect(loaded.vars?.PRESERVED_SETTING).toBe("synthetic-owner-setting");
      expect(loaded.vars?.[SCANNER_PUBLIC_KEYS]).toBe(key.publicKey);
      expect(loaded.env).toEqual(config.env);
      expect(loaded.services).toEqual(config.services);
      expect(loaded.r2_buckets).toEqual(config.r2_buckets);
      expect(loaded.d1_databases).toEqual(config.d1_databases);
      expect(JSON.stringify(loaded)).not.toContain(privateJwk.d as string);
      expect(loaded.vars?.PRIVATE_SECRET_NAME).toBeUndefined();
      const parsed = JSON.parse(
        execFileSync(
          "node",
          [
            "--input-type=module",
            "-e",
            `import {unstable_readConfig} from 'wrangler'; const c=unstable_readConfig({config:process.argv[1]}); process.stdout.write(JSON.stringify({vars:c.vars,services:c.services,d1:c.d1_databases,r2:c.r2_buckets}));`,
            path,
          ],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              WRANGLER_SEND_METRICS: "false",
              WRANGLER_WRITE_LOGS: "false",
            },
          },
        ),
      );
      expect(parsed.vars).toEqual(loaded.vars);
      expect(parsed.services).toEqual(loaded.services);
      expect(parsed.d1).toEqual(loaded.d1_databases);
      expect(parsed.r2).toEqual(loaded.r2_buckets);
      // A local provider metadata boundary returns the config actually assembled.
      // No Cloudflare credential or hosted API is used by this test.
      const readback: PagesMetadata = {
        ...remote,
        deployment_configs: {
          production: {
            env_vars: {
              ...remote.deployment_configs.production.env_vars,
              ...Object.fromEntries(
                Object.entries(loaded.vars ?? {}).map(([name, value]) => [
                  name,
                  { type: "plain_text", value: String(value) },
                ]),
              ),
            },
          },
        },
      };
      projects.set(`/${target}`, readback);
      const response = await fetch(`${server.url.origin}/${target}`);
      const actual = (await response.json()) as PagesMetadata;
      expect(() => verifyScannerPublicKey(actual, key)).not.toThrow();
      expect(scannerPagesConfiguration(config, actual, key)).toEqual(assembled);
      expect(() =>
        verifyScannerPublicKey(actual, { ...key, publicKey: "different" }),
      ).toThrow();
      expect(() =>
        scannerPagesConfiguration(config, actual, {
          ...key,
          publicKey: "different",
        }),
      ).toThrow("rotation is not authorized");
      expect(() =>
        scannerPagesConfiguration(
          config,
          { ...actual, production_branch: "wrong" },
          key,
        ),
      ).toThrow();
      const encrypted = structuredClone(actual);
      encrypted.deployment_configs.production.env_vars = {
        ...encrypted.deployment_configs.production.env_vars,
        [SCANNER_PUBLIC_KEYS]: { type: "secret_text" },
      };
      expect(() => scannerPagesConfiguration(config, encrypted, key)).toThrow(
        "rotation is not authorized",
      );
    }
    await expect(
      publicScannerKey(
        "synthetic malformed private input",
        "staging",
        "a".repeat(40),
      ),
    ).rejects.toThrow("The scanner signing key is invalid");
  } finally {
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});
