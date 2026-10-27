/**
 * Projects now live in the D1 registry, whose committed snapshot may be empty.
 * Integration tests keep exercising real policy against the frozen fixture registry.
 */
import { mock } from "bun:test";
import { fileURLToPath } from "node:url";
import { RAW_PROJECT_DEFINITIONS } from "./fixtures/project-registry.mjs";

mock.module(
  fileURLToPath(
    new URL("../src/lib/project-registry.generated.mjs", import.meta.url),
  ),
  () => ({ RAW_PROJECT_DEFINITIONS }),
);
