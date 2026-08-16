/** Proves the generated project registry is deterministic and browser-safe. */

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
    ).toEqual(["asi", "delta-star", "eliza", "heir-elements-sdk"]);
  });
});
