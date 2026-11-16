/** A real Vite shutdown must fence its delayed automatic-backend startup. */
import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import base from "../vite.config";

test.skipIf(process.platform === "win32")(
  "closing Vite while its backend health read is pending never starts an orphan backend",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "slop-vite-close-"));
    const originalFetch = globalThis.fetch;
    const previous = {
      PATH: process.env.PATH,
      SLOP_DEV_BACKEND: process.env.SLOP_DEV_BACKEND,
      SLOP_VITE_CHILD_MARKER: process.env.SLOP_VITE_CHILD_MARKER,
    };
    const marker = join(directory, "started");
    let rejectHealth: ((error: Error) => void) | undefined;
    let observedHealth: (() => void) | undefined;
    const healthStarted = new Promise<void>((resolve) => {
      observedHealth = resolve;
    });
    let server: Awaited<ReturnType<typeof createServer>> | undefined;
    try {
      // A process launch is still real; the executable only records the launch,
      // so this test cannot open a database or start an actual orphan service.
      const executable = join(directory, "bun");
      await writeFile(
        executable,
        '#!/bin/sh\nprintf started > "$SLOP_VITE_CHILD_MARKER"\n',
      );
      await chmod(executable, 0o755);
      process.env.PATH = `${directory}:${previous.PATH}`;
      process.env.SLOP_VITE_CHILD_MARKER = marker;
      delete process.env.SLOP_DEV_BACKEND;
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        if (String(input).endsWith("/__dev/health")) {
          observedHealth?.();
          return new Promise<Response>((_resolve, reject) => {
            rejectHealth = reject;
          });
        }
        return originalFetch(input, init);
      }) as typeof fetch;
      const config = base({
        command: "serve",
        mode: "development",
        isPreview: false,
      });
      server = await createServer({
        ...config,
        // Exercise the actual lifecycle plugin without starting unrelated React
        // dependency prebundling that may outlive this deliberately short server.
        plugins: config.plugins?.filter(
          (plugin) =>
            plugin &&
            !Array.isArray(plugin) &&
            typeof plugin === "object" &&
            "name" in plugin &&
            plugin.name === "local-sign-in",
        ),
        optimizeDeps: { noDiscovery: true, include: [] },
        configFile: false,
        root: directory,
        logLevel: "silent",
        server: { ...config.server, host: "127.0.0.1", port: 0 },
      });
      await server.listen();
      await healthStarted;
      await server.close();
      rejectHealth?.(new Error("Health probe completed after server shutdown"));
      // Keep the executable and cwd alive long enough for native process startup;
      // removing them early can turn the erroneous spawn into ENOENT and hide it.
      await Bun.sleep(3000);
      expect(await readFile(marker, "utf8").catch(() => null)).toBeNull();
    } finally {
      rejectHealth?.(new Error("Fixture cleanup"));
      await server?.close();
      globalThis.fetch = originalFetch;
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
);
