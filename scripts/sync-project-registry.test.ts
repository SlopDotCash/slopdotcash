/** Proves the generated project registry is deterministic and browser-safe. */

import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderProjectRegistry } from "./sync-project-registry.mjs";

describe("project registry generator", () => {
  it("embeds validated manifests without JSON import attributes", async () => {
    const rendered = await renderProjectRegistry();
    const encodedModule = Buffer.from(rendered).toString("base64");
    const generated = (await import(
      `data:text/javascript;base64,${encodedModule}`
    )) as {
      RAW_PROJECT_DEFINITIONS: Array<{ id: string }>;
    };

    expect(rendered).toContain(
      "export const RAW_PROJECT_DEFINITIONS = JSON.parse(",
    );
    expect(rendered).not.toContain(" with { type:");
    expect(rendered).not.toMatch(/from ["'][^"']+\.json["']/u);
    expect(
      generated.RAW_PROJECT_DEFINITIONS.map((project) => project.id),
    ).toEqual(
      (
        await readdir(
          resolve(dirname(fileURLToPath(import.meta.url)), "../projects"),
          {
            withFileTypes: true,
          },
        )
      )
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(),
    );
  });
});
